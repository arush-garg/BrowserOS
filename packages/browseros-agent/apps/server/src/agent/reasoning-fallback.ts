/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Reasoning-fallback middleware for LanguageModelV3.
 *
 * Some models (e.g. reasoning-heavy ones served through the BrowserOS
 * gateway) finish a turn having emitted only `reasoning_content` and no
 * visible `content`. The turn then surfaces to the user as an empty answer
 * — often with finishReason `content-filter` — even though the model
 * produced a coherent response in its reasoning channel.
 *
 * This middleware detects that case (a turn that produced reasoning, no
 * visible text, and no tool calls) and surfaces the reasoning text as the
 * answer, normalizing a `content-filter` finish to `stop`. Turns that emit
 * real text or call tools pass through untouched.
 */

import type {
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider'

const FALLBACK_TEXT_ID = 'reasoning-fallback-text'

/**
 * Shown when the upstream provider blocks a request outright (finish reason
 * `content-filter` with no generated content at all). Observed with the
 * BrowserOS gateway intermittently returning "ResponsibleAI result indicated
 * block action" for ordinary requests — without this, the turn ends silently.
 */
const CONTENT_FILTER_MESSAGE =
  'The model provider blocked this request (upstream content filter). ' +
  'This is usually a temporary provider issue — please try sending your message again.'

export interface ReasoningFallbackLogger {
  info: (msg: string, data?: Record<string, unknown>) => void
}

/**
 * Text to surface for an empty-text turn, or null to pass through untouched.
 * Tool-call turns legitimately produce no text, so they are excluded.
 * Reasoning, when present, becomes the answer; a blocked turn (content-filter
 * with nothing generated) becomes a visible error instead of silence.
 */
function fallbackText(options: {
  hasText: boolean
  hasToolCall: boolean
  reasoning: string
  finishReason: LanguageModelV3FinishReason
}): string | null {
  if (options.hasText || options.hasToolCall) return null
  if (options.reasoning.trim().length > 0) return options.reasoning
  if (options.finishReason.unified === 'content-filter') {
    return CONTENT_FILTER_MESSAGE
  }
  return null
}

function normalizeFinishReason(
  finishReason: LanguageModelV3FinishReason,
): LanguageModelV3FinishReason {
  return finishReason.unified === 'content-filter'
    ? { ...finishReason, unified: 'stop' }
    : finishReason
}

export function createReasoningFallbackMiddleware(
  logger?: ReasoningFallbackLogger,
): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',

    async wrapGenerate({ doGenerate }) {
      const result = await doGenerate()

      const hasText = result.content.some(
        (part) => part.type === 'text' && part.text.trim().length > 0,
      )
      const hasToolCall = result.content.some(
        (part) => part.type === 'tool-call',
      )
      const reasoning = result.content
        .filter(
          (
            part,
          ): part is Extract<LanguageModelV3Content, { type: 'reasoning' }> =>
            part.type === 'reasoning',
        )
        .map((part) => part.text)
        .join('')

      const text = fallbackText({
        hasText,
        hasToolCall,
        reasoning,
        finishReason: result.finishReason,
      })
      if (text === null) {
        return result
      }

      logger?.info('Surfacing fallback text (empty content turn)', {
        finishReason: result.finishReason,
        reasoningLength: reasoning.length,
      })

      const content: LanguageModelV3Content[] = [
        ...result.content,
        { type: 'text', text },
      ]
      return {
        ...result,
        content,
        finishReason: normalizeFinishReason(result.finishReason),
      } satisfies LanguageModelV3GenerateResult
    },

    async wrapStream({ doStream }) {
      const { stream, ...rest } = await doStream()

      let hasText = false
      let hasToolCall = false
      let reasoning = ''

      const transformed = stream.pipeThrough(
        new TransformStream<
          LanguageModelV3StreamPart,
          LanguageModelV3StreamPart
        >({
          transform(part, controller) {
            if (part.type === 'text-delta' && part.delta.trim().length > 0) {
              hasText = true
            } else if (part.type === 'reasoning-delta') {
              reasoning += part.delta
            } else if (part.type === 'tool-call') {
              hasToolCall = true
            }

            if (part.type === 'finish') {
              const text = fallbackText({
                hasText,
                hasToolCall,
                reasoning,
                finishReason: part.finishReason,
              })
              if (text !== null) {
                logger?.info('Surfacing fallback text (empty content turn)', {
                  finishReason: part.finishReason,
                  reasoningLength: reasoning.length,
                })
                controller.enqueue({ type: 'text-start', id: FALLBACK_TEXT_ID })
                controller.enqueue({
                  type: 'text-delta',
                  id: FALLBACK_TEXT_ID,
                  delta: text,
                })
                controller.enqueue({ type: 'text-end', id: FALLBACK_TEXT_ID })
                controller.enqueue({
                  ...part,
                  finishReason: normalizeFinishReason(part.finishReason),
                })
                return
              }
            }

            controller.enqueue(part)
          },
        }),
      )

      return {
        stream: transformed,
        ...rest,
      } satisfies LanguageModelV3StreamResult
    },
  }
}
