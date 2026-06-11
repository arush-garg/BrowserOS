/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import type {
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider'
import { createReasoningFallbackMiddleware } from '../../src/agent/reasoning-fallback'

function makeUsage(): LanguageModelV3GenerateResult['usage'] {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 0, reasoning: 1 },
  }
}

function finish(
  unified: LanguageModelV3FinishReason['unified'],
): LanguageModelV3FinishReason {
  return { unified, raw: unified }
}

function makeGenerateResult(
  content: LanguageModelV3Content[],
  unified: LanguageModelV3FinishReason['unified'],
): LanguageModelV3GenerateResult {
  return {
    content,
    finishReason: finish(unified),
    usage: makeUsage(),
    warnings: [],
  }
}

function streamFrom(
  parts: LanguageModelV3StreamPart[],
): LanguageModelV3StreamResult {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      },
    }),
  }
}

async function collect(
  result: LanguageModelV3StreamResult,
): Promise<LanguageModelV3StreamPart[]> {
  const parts: LanguageModelV3StreamPart[] = []
  const reader = result.stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

describe('createReasoningFallbackMiddleware', () => {
  describe('wrapGenerate', () => {
    it('surfaces reasoning as text when content is empty and normalizes content-filter', async () => {
      const middleware = createReasoningFallbackMiddleware()
      const result = await middleware.wrapGenerate?.({
        doGenerate: async () =>
          makeGenerateResult(
            [{ type: 'reasoning', text: 'the answer is 42' }],
            'content-filter',
          ),
        doStream: async () => streamFrom([]),
        params: {} as never,
        model: {} as never,
      })

      const text = result.content.find((p) => p.type === 'text')
      expect(text).toBeDefined()
      expect((text as { text: string }).text).toBe('the answer is 42')
      expect(result.finishReason.unified).toBe('stop')
    })

    it('leaves turns with real text untouched', async () => {
      const middleware = createReasoningFallbackMiddleware()
      const original = makeGenerateResult(
        [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'visible answer' },
        ],
        'stop',
      )
      const result = await middleware.wrapGenerate?.({
        doGenerate: async () => original,
        doStream: async () => streamFrom([]),
        params: {} as never,
        model: {} as never,
      })

      expect(result.content).toEqual(original.content)
      expect(result.content.filter((p) => p.type === 'text').length).toBe(1)
    })

    it('leaves tool-call turns untouched', async () => {
      const middleware = createReasoningFallbackMiddleware()
      const original = makeGenerateResult(
        [
          { type: 'reasoning', text: 'I should call a tool' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'browser_click',
            input: '{}',
          },
        ],
        'tool-calls',
      )
      const result = await middleware.wrapGenerate?.({
        doGenerate: async () => original,
        doStream: async () => streamFrom([]),
        params: {} as never,
        model: {} as never,
      })

      expect(result.content.some((p) => p.type === 'text')).toBe(false)
      expect(result.finishReason.unified).toBe('tool-calls')
    })

    it('surfaces a visible error message when content-filter turn has no reasoning', async () => {
      const middleware = createReasoningFallbackMiddleware()
      const result = await middleware.wrapGenerate?.({
        doGenerate: async () => makeGenerateResult([], 'content-filter'),
        doStream: async () => streamFrom([]),
        params: {} as never,
        model: {} as never,
      })

      const text = result.content.find((p) => p.type === 'text')
      expect(text).toBeDefined()
      expect((text as { text: string }).text).toContain('blocked')
      expect(result.finishReason.unified).toBe('stop')
    })

    it('leaves empty non-content-filter turns untouched', async () => {
      const middleware = createReasoningFallbackMiddleware()
      const result = await middleware.wrapGenerate?.({
        doGenerate: async () => makeGenerateResult([], 'stop'),
        doStream: async () => streamFrom([]),
        params: {} as never,
        model: {} as never,
      })

      expect(result.content.some((p) => p.type === 'text')).toBe(false)
      expect(result.finishReason.unified).toBe('stop')
    })
  })

  describe('wrapStream', () => {
    it('injects reasoning text parts on an empty-content finish', async () => {
      const middleware = createReasoningFallbackMiddleware()
      const result = await middleware.wrapStream?.({
        doGenerate: async () => makeGenerateResult([], 'stop'),
        doStream: async () =>
          streamFrom([
            { type: 'reasoning-start', id: 'r1' },
            { type: 'reasoning-delta', id: 'r1', delta: 'final ' },
            { type: 'reasoning-delta', id: 'r1', delta: 'answer' },
            { type: 'reasoning-end', id: 'r1' },
            {
              type: 'finish',
              usage: makeUsage(),
              finishReason: finish('content-filter'),
            },
          ]),
        params: {} as never,
        model: {} as never,
      })

      const parts = await collect(result)
      const textDeltas = parts.filter((p) => p.type === 'text-delta')
      expect(textDeltas.length).toBe(1)
      expect((textDeltas[0] as { delta: string }).delta).toBe('final answer')
      const finishPart = parts.find((p) => p.type === 'finish')
      expect(
        (finishPart as { finishReason: LanguageModelV3FinishReason })
          .finishReason.unified,
      ).toBe('stop')
    })

    it('injects a visible error message on a content-filter finish with no reasoning', async () => {
      const middleware = createReasoningFallbackMiddleware()
      const result = await middleware.wrapStream?.({
        doGenerate: async () => makeGenerateResult([], 'stop'),
        doStream: async () =>
          streamFrom([
            {
              type: 'finish',
              usage: makeUsage(),
              finishReason: finish('content-filter'),
            },
          ]),
        params: {} as never,
        model: {} as never,
      })

      const parts = await collect(result)
      const textDeltas = parts.filter((p) => p.type === 'text-delta')
      expect(textDeltas.length).toBe(1)
      expect((textDeltas[0] as { delta: string }).delta).toContain('blocked')
      const finishPart = parts.find((p) => p.type === 'finish')
      expect(
        (finishPart as { finishReason: LanguageModelV3FinishReason })
          .finishReason.unified,
      ).toBe('stop')
    })

    it('passes through a turn that emits visible text', async () => {
      const middleware = createReasoningFallbackMiddleware()
      const result = await middleware.wrapStream?.({
        doGenerate: async () => makeGenerateResult([], 'stop'),
        doStream: async () =>
          streamFrom([
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: 'hello' },
            { type: 'text-end', id: 't1' },
            {
              type: 'finish',
              usage: makeUsage(),
              finishReason: finish('stop'),
            },
          ]),
        params: {} as never,
        model: {} as never,
      })

      const parts = await collect(result)
      const textDeltas = parts.filter((p) => p.type === 'text-delta')
      expect(textDeltas.length).toBe(1)
      expect((textDeltas[0] as { delta: string }).delta).toBe('hello')
    })
  })
})
