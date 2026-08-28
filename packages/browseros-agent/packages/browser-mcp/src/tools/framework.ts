import type { BrowserSession } from '@browseros/browser-core/core/session'
import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import {
  type TypeOf,
  type ZodObject,
  type ZodRawShape,
  type ZodTypeAny,
  z,
} from 'zod'
import {
  type ContentItem,
  type ToolResult as ResponseToolResult,
  ToolResponse,
} from '../response'
import { classifyBrowserError } from './browser-errors'

export type ToolInputSchema = ZodObject<ZodRawShape>
export type ToolOutputSchema = ZodObject<ZodRawShape>

export interface ToolContext {
  session: BrowserSession
  defaultWindowId?: number
  defaultTabGroupId?: string
  signal?: AbortSignal
}

export type ContentBlock = ContentItem
export type ToolResult = ResponseToolResult

export interface ToolAnnotations {
  /**
   * Human-readable display name shown in MCP clients (e.g. Claude Desktop's
   * tool call UI). Required for Claude Directory listings.
   */
  title?: string
  readOnlyHint?: boolean
  /**
   * True when the tool may modify or delete state, files, or data.
   * Meaningful only when readOnlyHint is not true. Destructive tools
   * always prompt the user before running in MCP clients that respect the
   * hint.
   */
  destructiveHint?: boolean
  /** True when repeated calls with the same args produce the same effect. */
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  input: ToolInputSchema
  output?: ToolOutputSchema
  annotations?: ToolAnnotations
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
    response: ToolResponse,
  ) => Promise<ToolResult | undefined>
}

export function defineTool<S extends ToolInputSchema>(def: {
  name: string
  description: string
  input: S
  output?: ToolOutputSchema
  annotations?: ToolAnnotations
  handler: (
    args: TypeOf<S>,
    ctx: ToolContext,
    response: ToolResponse,
  ) => Promise<ToolResult | undefined>
}): ToolDefinition {
  return def as unknown as ToolDefinition
}

export function textResult(text: string, structured?: unknown): ToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structured !== undefined && { structuredContent: structured }),
  }
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function clampTimeout(
  value: number | undefined,
  defaultMs: number,
  maxMs: number,
): number {
  if (value === undefined) return defaultMs
  if (!Number.isFinite(value) || value <= 0) return defaultMs
  return Math.min(Math.round(value), maxMs)
}

export function abortableDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      cleanup()
      clearTimeout(timeout)
      reject(abortError(signal?.reason))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason)
}

/** Races tool work against cancellation, including CDP calls that do not accept AbortSignal. */
async function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal)
  if (!signal) return operation

  let cleanup = () => {}
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortError(signal.reason))
    signal.addEventListener('abort', onAbort, { once: true })
    cleanup = () => signal.removeEventListener('abort', onAbort)
  })

  try {
    return await Promise.race([operation, aborted])
  } finally {
    cleanup()
    void operation.catch(() => {})
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason
  const error = new Error(
    reason === undefined ? 'The operation was aborted.' : String(reason),
  )
  error.name = 'AbortError'
  return error
}

/**
 * Model-generated tool calls routinely stringify numeric arguments
 * (`"page": "7"`). Strict `z.number()` rejects those and the model then
 * replays the identical call in a loop, so numeric fields are coerced at the
 * schema boundary instead.
 *
 * Unlike `z.coerce.number()` this rewrites strings only: booleans, null, and
 * arrays still fail validation rather than silently becoming 0 or 1. Blank and
 * non-finite strings are passed through untouched so the inner schema reports
 * the real type error.
 */
function fromNumericString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '') return value
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : value
}

/** Wraps a numeric schema so numeric strings are accepted as numbers. */
export function numeric<T extends ZodTypeAny>(schema: T) {
  return z.preprocess(fromNumericString, schema)
}

/** Page ids, window ids, counts — a coercing `z.number().int()`. */
export function intArg() {
  return numeric(z.number().int())
}

/** Coordinates, scroll amounts, durations — a coercing `z.number()`. */
export function numberArg() {
  return numeric(z.number())
}

/**
 * Reports fields the schema rewrote from a string to a number, so the model
 * sees the correction instead of repeating the mistake on the next call.
 */
export function describeNumericCoercions(
  rawArgs: unknown,
  parsedArgs: Record<string, unknown>,
): string[] {
  if (typeof rawArgs !== 'object' || rawArgs === null) return []
  const notes: string[] = []
  for (const [key, before] of Object.entries(
    rawArgs as Record<string, unknown>,
  )) {
    if (typeof before !== 'string') continue
    const after = parsedArgs[key]
    if (typeof after !== 'number') continue
    notes.push(`note: ${key} was coerced from "${before}" to ${after}`)
  }
  return notes
}

/** Validate args, run the handler, and convert any failure into an instructive error result. */
export async function executeTool(
  def: ToolDefinition,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  throwIfAborted(ctx.signal)
  const parsed = def.input.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    return errorResult(`Invalid arguments for ${def.name}: ${detail}`)
  }

  // Impose a hard deadline so a hung CDP call (crashed/frozen tab) cannot
  // hold the HTTP connection—and the MCP caller's RPC lock—open for the
  // caller's full timeout budget.  The AbortController is combined with the
  // caller-supplied signal so either source can cancel the handler.
  const deadlineAc = new AbortController()
  const deadlineTimer = setTimeout(
    () =>
      deadlineAc.abort(
        new Error(
          `${def.name} timed out after ${TIMEOUTS.TOOL_HANDLER_DEADLINE}ms`,
        ),
      ),
    TIMEOUTS.TOOL_HANDLER_DEADLINE,
  )
  const signals: AbortSignal[] = [deadlineAc.signal]
  if (ctx.signal) signals.unshift(ctx.signal)
  const effectiveSignal =
    signals.length > 1 ? AbortSignal.any(signals) : signals[0]
  const handlerCtx: ToolContext = { ...ctx, signal: effectiveSignal }

  const response = new ToolResponse()
  try {
    const result = await abortable(
      def.handler(parsed.data as Record<string, unknown>, handlerCtx, response),
      effectiveSignal,
    )
    if (result) response.appendResult(result)
    throwIfAborted(effectiveSignal)
  } catch (err) {
    // Client-side abort (HTTP connection closed): re-throw so the MCP layer
    // skips send() — there is nothing to respond to.  Distinguish from our
    // own deadline by checking the *original* ctx.signal first.
    if (
      ctx.signal?.aborted ||
      (isAbortError(err) && !deadlineAc.signal.aborted)
    ) {
      throw err
    }
    const message = err instanceof Error ? err.message : String(err)
    if (deadlineAc.signal.aborted) {
      // Handler deadline fired: surface an actionable error immediately so
      // the caller's RPC lock is freed without waiting for the full client
      // timeout budget.
      response.error(
        `${def.name} timed out after ${TIMEOUTS.TOOL_HANDLER_DEADLINE}ms — ` +
          'the browser may be unresponsive. Run snapshot to check page state.',
      )
    } else {
      const classified = classifyBrowserError(err)
      if (classified) {
        const { code, recovery } = classified
        response.error(
          `${def.name} failed [${code}]: ${message}\nrecovery: ${recovery}`,
        )
        response.data({ error: message, code, recovery })
      } else {
        response.error(`${def.name} failed: ${message}`)
      }
    }
  } finally {
    clearTimeout(deadlineTimer)
  }

  throwIfAborted(ctx.signal)
  const result = await abortable(
    response.buildForSession(ctx.session),
    ctx.signal,
  )
  throwIfAborted(ctx.signal)

  const pageId = (parsed.data as Record<string, unknown>).page
  if (typeof pageId === 'number') {
    const tabId = (
      ctx.session.pages as { getTabId?: (pageId: number) => number | undefined }
    ).getTabId?.(pageId)
    if (tabId !== undefined) {
      result.metadata = { ...result.metadata, tabId }
    }
  }

  return result
}
