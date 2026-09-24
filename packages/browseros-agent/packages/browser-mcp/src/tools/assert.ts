import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { z } from 'zod/v4'
import { clampTimeout, defineTool, errorResult, textResult } from './framework'
import {
  awaitPredicate,
  describePredicate,
  PredicateError,
  predicateSchema,
} from './predicate'
import { wrapUntrusted } from './trust-boundary'

const DEFAULT_ASSERT_TIMEOUT_MS = 5_000
const MAX_ASSERT_TIMEOUT_MS = 60_000
const FAILURE_EXCERPT_CHARS = 600

export const assert = defineTool({
  name: 'assert',
  description:
    'Check that a condition holds on the page, waiting up to `timeout` for it. Returns an error when the condition never holds, so a wrong click fails loudly instead of the automation carrying on against the wrong page. Use it after a step whose success is not obvious from the diff — an order confirmed, a row removed, a redirect landed. `that` takes the same conditions as act kind="hold": text, selector, gone, url, stable, js.',
  input: z
    .object({
      page: z.number().int().describe('Page id from `tabs`.'),
      that: predicateSchema.describe('The condition that must hold.'),
      message: z
        .string()
        .optional()
        .describe(
          'What this check is protecting, included in the failure so the reason is legible, e.g. "order should be confirmed before continuing".',
        ),
      timeout: z
        .number()
        .optional()
        .describe(
          `How long to wait for the condition, in ms (default ${DEFAULT_ASSERT_TIMEOUT_MS}, max ${MAX_ASSERT_TIMEOUT_MS}).`,
        ),
    })
    .strict(),
  annotations: { title: 'Assert page condition', readOnlyHint: true },
  handler: async (args, ctx) => {
    const timeout = clampTimeout(
      args.timeout,
      DEFAULT_ASSERT_TIMEOUT_MS,
      MAX_ASSERT_TIMEOUT_MS,
    )
    const { session } = await ctx.session.pages.getSession(args.page)

    let outcome: Awaited<ReturnType<typeof awaitPredicate>>
    try {
      outcome = await awaitPredicate(session, args.that, {
        timeout,
        signal: ctx.signal,
      })
    } catch (error) {
      if (error instanceof PredicateError) return errorResult(error.message)
      throw error
    }

    const description = describePredicate(args.that)
    if (outcome.matched) {
      return textResult(
        `assert passed: ${description} (${outcome.waitedMs}ms)`,
        {
          page: args.page,
          passed: true,
          waitedMs: outcome.waitedMs,
        },
      )
    }

    // The excerpt saves a round-trip: the model can usually see why the check failed
    // without calling read or snapshot again.
    const excerpt = await pageExcerpt(session)
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    return errorResult(
      [
        `assert FAILED: ${description} did not hold within ${timeout}ms.`,
        ...(args.message ? [`Expectation: ${args.message}`] : []),
        'Page text at the time of failure:',
        wrapUntrusted(excerpt, origin),
      ].join('\n'),
    )
  },
})

async function pageExcerpt(session: ProtocolApi): Promise<string> {
  try {
    const result = await session.Runtime.evaluate({
      expression: `(document.body?.innerText ?? '').slice(0, ${FAILURE_EXCERPT_CHARS})`,
      returnByValue: true,
    })
    const value = result.result?.value
    return typeof value === 'string' && value.trim() !== ''
      ? value
      : '(no page text)'
  } catch {
    return '(page text unavailable)'
  }
}
