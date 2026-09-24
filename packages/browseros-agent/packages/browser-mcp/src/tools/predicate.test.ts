import { describe, expect, it } from 'bun:test'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import {
  awaitPredicate,
  compilePredicate,
  describePredicate,
  PredicateError,
} from './predicate'

/** A page whose evaluate() returns each scripted value in turn, repeating the last one. */
function scriptedPage(values: unknown[]): {
  session: ProtocolApi
  expressions: string[]
} {
  const expressions: string[] = []
  let index = 0
  const session = {
    Runtime: {
      evaluate: async ({ expression }: { expression: string }) => {
        expressions.push(expression)
        const value = values[Math.min(index, values.length - 1)]
        index++
        return { result: { value } }
      },
    },
  } as unknown as ProtocolApi
  return { session, expressions }
}

const fast = { timeout: 500, poll: 1 }

describe('compilePredicate', () => {
  it('matches a substring for kind=url', () => {
    expect(compilePredicate({ kind: 'url', value: '/checkout' })).toContain(
      'location.href.includes',
    )
  })

  it('treats a /pattern/flags value as a regex for kind=url', () => {
    const expression = compilePredicate({
      kind: 'url',
      value: '/order\\/\\d+/i',
    })
    expect(expression).toContain('new RegExp')
    expect(expression).toContain('"i"')
  })

  it('inverts the selector check for kind=gone', () => {
    expect(compilePredicate({ kind: 'gone', value: '.spinner' })).toBe(
      '!document.querySelector(".spinner")',
    )
  })

  it('throws a usage error when value is missing', () => {
    expect(() => compilePredicate({ kind: 'selector' })).toThrow(PredicateError)
    expect(() => compilePredicate({ kind: 'selector' })).toThrow(
      /"value" is required.*CSS selector/,
    )
  })
})

describe('awaitPredicate', () => {
  it('pauses for kind=time without touching the page', async () => {
    const { session, expressions } = scriptedPage([])
    const outcome = await awaitPredicate(session, { kind: 'time', ms: 5 }, fast)
    expect(outcome.matched).toBe(true)
    expect(expressions).toHaveLength(0)
  })

  it('clamps a kind=time pause to the timeout', async () => {
    const { session } = scriptedPage([])
    const outcome = await awaitPredicate(
      session,
      { kind: 'time', ms: 60_000 },
      { timeout: 20, poll: 1 },
    )
    expect(outcome.waitedMs).toBeLessThan(500)
  })

  it('resolves as soon as a polled predicate is true', async () => {
    const { session } = scriptedPage([false, false, true])
    const outcome = await awaitPredicate(
      session,
      { kind: 'selector', value: '#done' },
      fast,
    )
    expect(outcome).toMatchObject({ matched: true, reason: 'matched' })
    expect(outcome.detail).toContain('#done')
  })

  it('reports a timeout with the predicate description', async () => {
    const { session } = scriptedPage([false])
    const outcome = await awaitPredicate(
      session,
      { kind: 'text', value: 'Confirmed' },
      { timeout: 25, poll: 1 },
    )
    expect(outcome.matched).toBe(false)
    expect(outcome.reason).toBe('timeout')
    expect(outcome.detail).toContain('Confirmed')
  })

  it('treats a changing fingerprint as unsettled for kind=stable', async () => {
    const { session } = scriptedPage(['loading:1', 'loading:2', 'complete:3'])
    const outcome = await awaitPredicate(
      session,
      { kind: 'stable', quietMs: 15 },
      { timeout: 500, poll: 1 },
    )
    expect(outcome.matched).toBe(true)
    expect(outcome.detail).toContain('stable')
  })

  it('times out for kind=stable when the DOM never settles', async () => {
    let n = 0
    const session = {
      Runtime: {
        evaluate: async () => ({ result: { value: `complete:${n++}` } }),
      },
    } as unknown as ProtocolApi
    const outcome = await awaitPredicate(
      session,
      { kind: 'stable', quietMs: 50 },
      { timeout: 30, poll: 1 },
    )
    expect(outcome.matched).toBe(false)
  })

  it('surfaces a page-side exception as a usage error', async () => {
    const session = {
      Runtime: {
        evaluate: async () => ({
          exceptionDetails: { text: 'ReferenceError: nope is not defined' },
        }),
      },
    } as unknown as ProtocolApi
    await expect(
      awaitPredicate(session, { kind: 'js', value: 'nope' }, fast),
    ).rejects.toThrow(PredicateError)
  })

  it('aborts a pause when the signal fires', async () => {
    const { session } = scriptedPage([])
    const controller = new AbortController()
    const pending = awaitPredicate(
      session,
      { kind: 'time', ms: 5_000 },
      { timeout: 5_000, poll: 1, signal: controller.signal },
    )
    controller.abort()
    await expect(pending).rejects.toThrow()
  })
})

describe('describePredicate', () => {
  it('describes each kind in one line', () => {
    expect(describePredicate({ kind: 'time', ms: 250 })).toBe('time 250ms')
    expect(describePredicate({ kind: 'stable', quietMs: 400 })).toContain(
      '400ms',
    )
    expect(describePredicate({ kind: 'text', value: 'hi' })).toBe('text "hi"')
  })
})
