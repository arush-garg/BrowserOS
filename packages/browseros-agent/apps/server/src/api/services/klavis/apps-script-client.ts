/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import { EXTERNAL_URLS } from '@browseros/shared/constants/urls'
import { logger } from '../../../lib/logger'

export interface AppsScriptPayload {
  app: 'docs' | 'sheets' | 'slides'
  script: string
  scriptParams?: unknown
  runAs?: string
}

export interface AppsScriptResponse {
  result?: unknown
  error?: {
    code: number
    message: string
    details?: unknown[]
  }
}

interface RetryConfig {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export class AppsScriptClient {
  private baseUrl: string
  private retryConfig: RetryConfig

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || EXTERNAL_URLS.KLAVIS_PROXY
    this.retryConfig = {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attemptNumber: number): number {
    const exponentialDelay =
      this.retryConfig.baseDelayMs * 2 ** (attemptNumber - 1)
    const delayWithJitter = exponentialDelay * (0.5 + Math.random() * 0.5)
    return Math.min(delayWithJitter, this.retryConfig.maxDelayMs)
  }

  /**
   * Sleep utility for retry delays
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Make an HTTP request with exponential retry
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        TIMEOUTS.KLAVIS_FETCH,
      )

      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        if (!response.ok) {
          const errorText = await response.text()
          const error = new Error(
            `AppsScript error: ${response.status} ${response.statusText} - ${errorText}`,
          )

          if (
            response.status >= 500 &&
            attempt < this.retryConfig.maxAttempts
          ) {
            lastError = error
            const delay = this.calculateBackoffDelay(attempt)
            logger.debug(
              `AppsScript request attempt ${attempt} failed, retrying in ${delay}ms`,
              {
                path,
                status: response.status,
              },
            )
            await this.sleep(delay)
            continue
          }

          throw error
        }

        clearTimeout(timeoutId)
        return response.json()
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(
            `AppsScript request timed out after ${TIMEOUTS.KLAVIS_FETCH}ms`,
          )

          if (attempt < this.retryConfig.maxAttempts) {
            const delay = this.calculateBackoffDelay(attempt)
            logger.debug(`AppsScript request timeout, retrying in ${delay}ms`, {
              path,
            })
            await this.sleep(delay)
            continue
          }

          throw lastError
        }

        lastError = error as Error

        if (attempt < this.retryConfig.maxAttempts) {
          const delay = this.calculateBackoffDelay(attempt)
          logger.debug(
            `AppsScript request attempt ${attempt} failed, retrying in ${delay}ms`,
            {
              path,
              error: error instanceof Error ? error.message : String(error),
            },
          )
          await this.sleep(delay)
          continue
        }

        throw error
      } finally {
        clearTimeout(timeoutId)
      }
    }

    throw (
      lastError ||
      new Error('AppsScript request failed after all retry attempts')
    )
  }

  /**
   * Run a Google Apps Script with exponential retry
   */
  async runAppsScript(
    userId: string,
    payload: AppsScriptPayload,
  ): Promise<AppsScriptResponse> {
    return this.request<AppsScriptResponse>('POST', '/apps-script/run', {
      userId,
      payload,
    })
  }
}
