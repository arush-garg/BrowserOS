import { TOOL_LIMITS } from '@browseros/shared/constants/limits'
import { z } from 'zod'
import { clampTimeout, defineTool, errorResult, textResult } from './framework'
import { writeTempToolOutputFile } from './output-file'
import { wrapUntrusted } from './trust-boundary'

const DEFAULT_TIMEOUT_MS = 30_000
// CDP Runtime.evaluate enforces a hard 60_000ms wall; stay safely under it.
const MAX_TIMEOUT_MS = 55_000

const DESCRIPTION = `Evaluate JavaScript in a page context through CDP Runtime.evaluate. Use this for page-state reads or small DOM scripts that are awkward with read/grep. Return a value to read it back.`

export const evaluate = defineTool({
  name: 'evaluate',
  description: DESCRIPTION,
  input: z.object({
    page: z.number().int().describe('Page id from `tabs`.'),
    code: z
      .string()
      .describe(
        'Async-capable JS body evaluated inside the page. Use `return` to read a value.',
      ),
    timeout: z
      .number()
      .optional()
      .describe('Max evaluation time in ms (default 30000).'),
  }),
  annotations: {
    title: 'Run JavaScript in page',
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (args, ctx) => {
    const { session } = await ctx.session.pages.getSession(args.page)
    const timeout = clampTimeout(
      args.timeout,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    )
    const requestedTimeout = args.timeout
    const timeoutWasClamped =
      requestedTimeout !== undefined &&
      Number.isFinite(requestedTimeout) &&
      requestedTimeout > MAX_TIMEOUT_MS
    const requestedTimeoutMs =
      timeoutWasClamped && requestedTimeout !== undefined
        ? Math.round(requestedTimeout)
        : undefined
    const result = await session.Runtime.evaluate({
      expression: wrapAsAsyncIife(args.code),
      returnByValue: true,
      awaitPromise: true,
      timeout,
      userGesture: true,
    })

    if (result.exceptionDetails) {
      return errorResult(
        `evaluate: ${
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
        }`,
      )
    }

    const value = result.result?.value ?? result.result?.description
    const text = value === undefined ? 'undefined' : safeStringify(value)
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    const clampNote =
      requestedTimeoutMs !== undefined
        ? `(note: requested timeout ${requestedTimeoutMs}ms was clamped to ${MAX_TIMEOUT_MS}ms max)`
        : null
    if (text.length > TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS) {
      const excerpt = text.slice(0, TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS)
      const wrappedText = wrapUntrusted(text, origin)
      const contentLength = wrappedText.length
      try {
        const path = await writeTempToolOutputFile({
          toolName: 'evaluate',
          extension: 'txt',
          content: wrappedText,
        })
        const sections = [
          `Full evaluate result saved to: ${path}`,
          `(${contentLength} chars; truncated at ${TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS} chars inline)`,
          clampNote,
          `Excerpt:`,
          wrapUntrusted(excerpt, origin),
        ].filter((section): section is string => section !== null)
        return textResult(sections.join('\n\n'), {
          page: args.page,
          contentLength,
          writtenToFile: true,
          path,
          ...(requestedTimeoutMs !== undefined && {
            requestedTimeoutMs,
            appliedTimeoutMs: timeout,
          }),
        })
      } catch (error) {
        const saveError = error instanceof Error ? error.message : String(error)
        const sections = [
          `Failed to save full evaluate result to a BrowserOS output file: ${saveError}`,
          `(${contentLength} chars; truncated at ${TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS} chars inline)`,
          clampNote,
          `Excerpt:`,
          wrapUntrusted(excerpt, origin),
        ].filter((section): section is string => section !== null)
        return textResult(sections.join('\n\n'), {
          page: args.page,
          contentLength,
          writtenToFile: false,
          outputWriteFailed: true,
          error: saveError,
          ...(requestedTimeoutMs !== undefined && {
            requestedTimeoutMs,
            appliedTimeoutMs: timeout,
          }),
        })
      }
    }

    const inlineSections = [wrapUntrusted(text, origin), clampNote].filter(
      (section): section is string => section !== null,
    )
    return textResult(inlineSections.join('\n\n'), {
      page: args.page,
      value,
      ...(requestedTimeoutMs !== undefined && {
        requestedTimeoutMs,
        appliedTimeoutMs: timeout,
      }),
    })
  },
})

function wrapAsAsyncIife(code: string): string {
  return `(async () => {\n${code}\n})()`
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
