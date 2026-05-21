/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Retry/fallback middleware for LanguageModelV3.
 *
 * Implements a 3-tier retry policy:
 *   Tier 1: retry once on the same model with no delay
 *   Tier 2: retry once on the same model after a fixed 1s delay
 *   Tier 3: retry once on a fallback provider (no backoff)
 *
 * Fallback selection is random and sticky for the session.
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider'
import { APICallError } from '@ai-sdk/provider'
import type { ResolvedAgentConfig } from './types'

export interface GatewayProviderConfig {
  name: string
  model: string
  apiKey?: string
  baseUrl?: string
  providerType: string
}

export interface RetryLogger {
  info: (msg: string, data?: Record<string, unknown>) => void
  warn: (msg: string, data?: Record<string, unknown>) => void
  debug: (msg: string, data?: Record<string, unknown>) => void
}

export interface CreateRetryingLanguageModelOptions {
  resolvedConfig: ResolvedAgentConfig
  initialModel: LanguageModelV3
  createModel: (config: {
    gatewayProviderName: string
    model: string
    apiKey?: string
    baseUrl?: string
    providerType: string
  }) => LanguageModelV3
  fixedBackoffMs?: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  logger?: RetryLogger
}

/**
 * Classifies whether an error is retryable.
 *
 * Retryable if:
 * - APICallError with isRetryable === true
 * - Status code 408, 429, or 5xx
 * - Network fetch failure (e.g. "fetch failed", "Failed to fetch")
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof APICallError) {
    if (error.isRetryable) return true
    if (
      error.statusCode === 408 ||
      error.statusCode === 429 ||
      (error.statusCode != null &&
        error.statusCode >= 500 &&
        error.statusCode < 600)
    ) {
      return true
    }
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes('fetch failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('network error') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound')
    ) {
      return true
    }
  }

  return false
}

/**
 * Picks a random fallback provider from the pool, excluding the current one.
 * Returns undefined if no fallback is available.
 */
function pickFallbackProvider(
  gatewayProviders: GatewayProviderConfig[],
  currentName: string,
  random: () => number,
): GatewayProviderConfig | undefined {
  const candidates = gatewayProviders.filter((p) => p.name !== currentName)
  if (candidates.length === 0) return undefined
  const idx = Math.floor(random() * candidates.length)
  return candidates[idx]
}

/**
 * Wraps a LanguageModelV3 with 3-tier retry and fallback logic.
 *
 * The returned model delegates doGenerate/doStream to the current model,
 * retrying on retryable errors according to the tier policy. Once a
 * fallback provider is selected, it becomes sticky for subsequent calls.
 */
export function createRetryingLanguageModel(
  options: CreateRetryingLanguageModelOptions,
): LanguageModelV3 {
  const {
    resolvedConfig,
    initialModel,
    createModel,
    fixedBackoffMs = 1000,
    sleep = async () => {},
    random = Math.random,
    logger,
  } = options

  const gatewayProviders: GatewayProviderConfig[] =
    ((resolvedConfig as unknown as Record<string, unknown>).gatewayProviders as
      | GatewayProviderConfig[]
      | undefined) ?? []

  // Sticky fallback state
  let currentModel: LanguageModelV3 = initialModel
  let currentProviderName: string =
    ((resolvedConfig as unknown as Record<string, unknown>)
      .gatewayProviderName as string | undefined) ?? 'default'

  const log = (
    level: 'info' | 'warn' | 'debug',
    msg: string,
    data?: Record<string, unknown>,
  ) => {
    logger?.[level]?.(msg, data)
  }

  async function executeWithRetry<T>(
    operation: (model: LanguageModelV3) => PromiseLike<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: unknown

    // Tier 1: same model, no delay
    try {
      log('debug', `[retry] ${operationName} tier 1 attempt`, {
        provider: currentProviderName,
        model: currentModel.modelId,
      })
      return await operation(currentModel)
    } catch (err) {
      if (!isRetryableError(err)) throw err
      lastError = err
      log('warn', `[retry] ${operationName} tier 1 failed`, {
        provider: currentProviderName,
        model: currentModel.modelId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Tier 2: same model, fixed delay
    await sleep(fixedBackoffMs)
    try {
      log(
        'debug',
        `[retry] ${operationName} tier 2 attempt (after ${fixedBackoffMs}ms)`,
        {
          provider: currentProviderName,
          model: currentModel.modelId,
        },
      )
      return await operation(currentModel)
    } catch (err) {
      if (!isRetryableError(err)) throw err
      lastError = err
      log('warn', `[retry] ${operationName} tier 2 failed`, {
        provider: currentProviderName,
        model: currentModel.modelId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Tier 3: fallback provider
    const fallback = pickFallbackProvider(
      gatewayProviders,
      currentProviderName,
      random,
    )

    if (!fallback) {
      log('warn', `[retry] ${operationName} no fallback providers available`, {
        currentProvider: currentProviderName,
        poolSize: gatewayProviders.length,
      })
      const finalError =
        lastError instanceof Error ? lastError : new Error(String(lastError))
      // Append "No backup providers configured" to the message
      throw new Error(`${finalError.message}. No backup providers configured`, {
        cause: finalError,
      })
    }

    const fallbackModel = createModel({
      gatewayProviderName: fallback.name,
      model: fallback.model,
      apiKey: fallback.apiKey,
      baseUrl: fallback.baseUrl,
      providerType: fallback.providerType,
    })

    log('info', `[retry] ${operationName} switching to fallback provider`, {
      fromProvider: currentProviderName,
      toProvider: fallback.name,
      toModel: fallback.model,
    })

    try {
      const result = await operation(fallbackModel)
      // Sticky: update current model for subsequent requests
      currentModel = fallbackModel
      currentProviderName = fallback.name
      log('info', `[retry] ${operationName} fallback succeeded, now sticky`, {
        provider: fallback.name,
        model: fallback.model,
      })
      return result
    } catch (err) {
      lastError = err
      log('warn', `[retry] ${operationName} fallback also failed`, {
        provider: fallback.name,
        model: fallback.model,
        error: err instanceof Error ? err.message : String(err),
      })
      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError))
    }
  }

  return {
    specificationVersion: 'v3' as const,
    provider: initialModel.provider,
    modelId: initialModel.modelId,
    supportedUrls: initialModel.supportedUrls,

    async doGenerate(
      options: LanguageModelV3CallOptions,
    ): Promise<LanguageModelV3GenerateResult> {
      return executeWithRetry(
        (model) => model.doGenerate(options),
        'doGenerate',
      )
    },

    async doStream(
      options: LanguageModelV3CallOptions,
    ): Promise<LanguageModelV3StreamResult> {
      return executeWithRetry((model) => model.doStream(options), 'doStream')
    },
  }
}
