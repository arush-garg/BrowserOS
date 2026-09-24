import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { z } from 'zod/v4'
import { abortableDelay, throwIfAborted } from './framework'

export const DEFAULT_POLL_MS = 250
export const DEFAULT_QUIET_MS = 500
export const DEFAULT_TIME_MS = 1_000

export const PREDICATE_KINDS = [
  'time',
  'text',
  'selector',
  'gone',
  'url',
  'stable',
  'js',
] as const

export type PredicateKind = (typeof PREDICATE_KINDS)[number]

// Flat, not a discriminated union: some providers reject nested anyOf JSON Schema (see act.ts).
// Which fields a kind needs is enforced in compilePredicate instead.
export const predicateSchema = z
  .object({
    kind: z
      .enum(PREDICATE_KINDS)
      .describe(
        [
          'time: pause for `ms`.',
          'text: page text contains `value`.',
          'selector: `value` matches an element.',
          'gone: `value` matches nothing (a spinner disappearing).',
          'url: the page URL contains `value`, or matches it as /regex/.',
          'stable: the DOM stops changing for `quietMs`.',
          'js: `value` is a JavaScript expression that evaluates truthy.',
        ].join(' '),
      ),
    value: z
      .string()
      .optional()
      .describe(
        'The text, CSS selector, URL pattern, or JS expression — required for every kind except time and stable.',
      ),
    ms: z
      .number()
      .optional()
      .describe(`Pause length for kind=time (default ${DEFAULT_TIME_MS}).`),
    quietMs: z
      .number()
      .optional()
      .describe(
        `How long the DOM must stay unchanged for kind=stable (default ${DEFAULT_QUIET_MS}).`,
      ),
  })
  .strict()

export type Predicate = z.infer<typeof predicateSchema>

export interface PredicateOutcome {
  matched: boolean
  reason: 'matched' | 'timeout'
  waitedMs: number
  detail: string
}

/** Raised for a predicate that can never be evaluated, so callers report it as a usage error. */
export class PredicateError extends Error {}

/** A one-line description used in timeout messages and tool notes. */
export function describePredicate(p: Predicate): string {
  switch (p.kind) {
    case 'time':
      return `time ${p.ms ?? DEFAULT_TIME_MS}ms`
    case 'stable':
      return `DOM stable for ${p.quietMs ?? DEFAULT_QUIET_MS}ms`
    default:
      return `${p.kind} ${JSON.stringify(p.value ?? '')}`
  }
}

function requireValue(p: Predicate): string {
  if (p.value === undefined || p.value === '') {
    throw new PredicateError(
      `predicate ${p.kind}: "value" is required (the ${valueNoun(p.kind)} to match).`,
    )
  }
  return p.value
}

function valueNoun(kind: PredicateKind): string {
  if (kind === 'selector' || kind === 'gone') return 'CSS selector'
  if (kind === 'url') return 'URL substring or /regex/'
  if (kind === 'js') return 'JavaScript expression'
  return 'text'
}

/** Builds the boolean JS expression a polled predicate evaluates in the page. */
export function compilePredicate(p: Predicate): string {
  switch (p.kind) {
    case 'text':
      return `(document.body?.innerText ?? '').includes(${JSON.stringify(requireValue(p))})`
    case 'selector':
      return `!!document.querySelector(${JSON.stringify(requireValue(p))})`
    case 'gone':
      return `!document.querySelector(${JSON.stringify(requireValue(p))})`
    case 'url':
      return compileUrl(requireValue(p))
    case 'js':
      return `!!(${requireValue(p)})`
    default:
      throw new PredicateError(
        `predicate ${p.kind} is not evaluated by polling`,
      )
  }
}

// A /pattern/flags value is treated as a regex; anything else is a plain substring.
function compileUrl(value: string): string {
  const match = /^\/(.+)\/([gimsuy]*)$/.exec(value)
  if (!match) {
    return `location.href.includes(${JSON.stringify(value)})`
  }
  return `new RegExp(${JSON.stringify(match[1])}, ${JSON.stringify(match[2])}).test(location.href)`
}

// readyState alone misses in-place rendering and serializing the DOM is too costly to poll,
// so the fingerprint pairs it with the element count.
const FINGERPRINT_EXPRESSION =
  "document.readyState + ':' + document.getElementsByTagName('*').length"

async function evaluateString(
  session: ProtocolApi,
  expression: string,
): Promise<unknown> {
  const result = await session.Runtime.evaluate({
    expression,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new PredicateError(
      `predicate expression failed: ${result.exceptionDetails.text ?? 'evaluation error'}`,
    )
  }
  return result.result?.value
}

/**
 * Throws if the predicate is missing the field its kind needs.
 *
 * Callers that arm something before waiting (a long-press holds the mouse button down) must
 * validate first, so a malformed condition fails before the page is touched.
 */
export function validatePredicate(p: Predicate): void {
  if (p.kind === 'time' || p.kind === 'stable') return
  compilePredicate(p)
}

/**
 * Waits for `p` to hold, or until `timeout` elapses.
 *
 * Every kind runs through one poll loop — including `stable`, which polls a DOM fingerprint
 * rather than subscribing to CDP mutation events. Polling keeps all kinds on a single code
 * path and cannot leak a subscription when a hold is aborted mid-flight.
 */
export async function awaitPredicate(
  session: ProtocolApi,
  p: Predicate,
  opts: { timeout: number; poll?: number; signal?: AbortSignal },
): Promise<PredicateOutcome> {
  const started = Date.now()
  const deadline = started + opts.timeout
  const pollMs = Math.max(1, opts.poll ?? DEFAULT_POLL_MS)
  const since = () => Date.now() - started

  if (p.kind === 'time') {
    const ms = Math.min(Math.max(0, p.ms ?? DEFAULT_TIME_MS), opts.timeout)
    await abortableDelay(ms, opts.signal)
    return {
      matched: true,
      reason: 'matched',
      waitedMs: since(),
      detail: `paused ${ms}ms`,
    }
  }

  if (p.kind === 'stable') {
    const quietMs = Math.max(0, p.quietMs ?? DEFAULT_QUIET_MS)
    let fingerprint = await evaluateString(session, FINGERPRINT_EXPRESSION)
    let quietSince = Date.now()
    while (Date.now() < deadline) {
      throwIfAborted(opts.signal)
      await abortableDelay(
        Math.min(pollMs, Math.max(0, deadline - Date.now())),
        opts.signal,
      )
      const next = await evaluateString(session, FINGERPRINT_EXPRESSION)
      if (next !== fingerprint) {
        fingerprint = next
        quietSince = Date.now()
        continue
      }
      if (Date.now() - quietSince >= quietMs) {
        return {
          matched: true,
          reason: 'matched',
          waitedMs: since(),
          detail: `DOM stable for ${quietMs}ms`,
        }
      }
    }
    return timedOut(p, since())
  }

  const expression = compilePredicate(p)
  while (Date.now() < deadline) {
    throwIfAborted(opts.signal)
    if ((await evaluateString(session, expression)) === true) {
      return {
        matched: true,
        reason: 'matched',
        waitedMs: since(),
        detail: `matched ${describePredicate(p)}`,
      }
    }
    await abortableDelay(
      Math.min(pollMs, Math.max(0, deadline - Date.now())),
      opts.signal,
    )
  }
  return timedOut(p, since())
}

function timedOut(p: Predicate, waitedMs: number): PredicateOutcome {
  return {
    matched: false,
    reason: 'timeout',
    waitedMs,
    detail: `timed out after ${waitedMs}ms waiting for ${describePredicate(p)}`,
  }
}
