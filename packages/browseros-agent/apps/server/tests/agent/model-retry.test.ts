/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider'
import { APICallError } from '@ai-sdk/provider'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { createRetryingLanguageModel } from '../../src/agent/model-retry'
import type { ResolvedAgentConfig } from '../../src/agent/types'

const basePrompt: LanguageModelV3CallOptions = {
  prompt: [
    {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    },
  ],
}

function makeUsage(): LanguageModelV3GenerateResult['usage'] {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  }
}

function makeGenerateResult(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: makeUsage(),
    warnings: [],
  }
}

function makeStreamResult(): LanguageModelV3StreamResult {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.close()
      },
    }),
  }
}

type Outcome<T> = { type: 'result'; value: T } | { type: 'error'; error: Error }

function createMockModel(
  name: string,
  generateOutcomes: Array<Outcome<LanguageModelV3GenerateResult>>,
  streamOutcomes?: Array<Outcome<LanguageModelV3StreamResult>>,
) {
  const state = {
    generateCalls: 0,
    streamCalls: 0,
  }

  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: name,
    supportedUrls: {},
    async doGenerate() {
      state.generateCalls += 1
      const outcome = generateOutcomes.shift()
      if (!outcome) {
        throw new Error('No generate outcome configured')
      }
      if (outcome.type === 'error') throw outcome.error
      return outcome.value
    },
    async doStream() {
      state.streamCalls += 1
      const outcome = streamOutcomes?.shift()
      if (!outcome) return makeStreamResult()
      if (outcome.type === 'error') throw outcome.error
      return outcome.value
    },
  }

  return { model, state }
}

const retryableError = new APICallError({
  message: 'Too Many Requests',
  url: 'https://example.com',
  requestBodyValues: {},
  statusCode: 429,
  isRetryable: false,
})

function makeResolvedConfig(): ResolvedAgentConfig {
  return {
    conversationId: 'conv-1',
    provider: LLM_PROVIDERS.BROWSEROS,
    model: 'model-a',
    apiKey: 'key-a',
    baseUrl: 'https://api-a',
    upstreamProvider: 'openrouter',
    gatewayProviderName: 'default',
    gatewayProviders: [
      {
        name: 'default',
        model: 'model-a',
        apiKey: 'key-a',
        baseUrl: 'https://api-a',
        providerType: 'openrouter',
      },
      {
        name: 'backup',
        model: 'model-b',
        apiKey: 'key-b',
        baseUrl: 'https://api-b',
        providerType: 'openrouter',
      },
    ],
  }
}

describe('createRetryingLanguageModel', () => {
  it('retries same model, waits, then falls back', async () => {
    const first = createMockModel('model-a', [
      { type: 'error', error: retryableError },
      { type: 'error', error: retryableError },
    ])
    const fallback = createMockModel('model-b', [
      { type: 'result', value: makeGenerateResult('ok') },
    ])

    const sleepCalls: number[] = []

    const model = createRetryingLanguageModel({
      resolvedConfig: makeResolvedConfig(),
      initialModel: first.model,
      createModel: (config) =>
        config.gatewayProviderName === 'backup' ? fallback.model : first.model,
      fixedBackoffMs: 1000,
      sleep: async (ms) => {
        sleepCalls.push(ms)
      },
      random: () => 0,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    })

    const result = await model.doGenerate(basePrompt)
    expect(result.content[0]?.type).toBe('text')
    expect(first.state.generateCalls).toBe(2)
    expect(fallback.state.generateCalls).toBe(1)
    expect(sleepCalls).toEqual([1000])
  })

  it('throws with no backup providers configured', async () => {
    const first = createMockModel('model-a', [
      { type: 'error', error: retryableError },
      { type: 'error', error: retryableError },
    ])

    const config = makeResolvedConfig()
    config.gatewayProviders = [config.gatewayProviders?.[0]].filter(Boolean)

    const model = createRetryingLanguageModel({
      resolvedConfig: config,
      initialModel: first.model,
      createModel: () => first.model,
      fixedBackoffMs: 1000,
      sleep: async () => {},
      random: () => 0,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    })

    let error: Error | undefined
    try {
      await model.doGenerate(basePrompt)
    } catch (err) {
      error = err as Error
    }

    expect(error).toBeDefined()
    expect(error?.message).toContain('Too Many Requests')
    expect(error?.message).toContain('No backup providers configured')
  })

  it('sticks to fallback for subsequent requests', async () => {
    const first = createMockModel('model-a', [
      { type: 'error', error: retryableError },
      { type: 'error', error: retryableError },
    ])
    const fallback = createMockModel('model-b', [
      { type: 'result', value: makeGenerateResult('ok') },
      { type: 'result', value: makeGenerateResult('ok-again') },
    ])

    const model = createRetryingLanguageModel({
      resolvedConfig: makeResolvedConfig(),
      initialModel: first.model,
      createModel: (config) =>
        config.gatewayProviderName === 'backup' ? fallback.model : first.model,
      fixedBackoffMs: 1000,
      sleep: async () => {},
      random: () => 0,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    })

    await model.doGenerate(basePrompt)
    await model.doGenerate(basePrompt)

    expect(first.state.generateCalls).toBe(2)
    expect(fallback.state.generateCalls).toBe(2)
  })
})
