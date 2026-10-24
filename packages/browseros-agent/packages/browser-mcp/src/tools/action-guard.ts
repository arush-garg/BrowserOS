import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'
import { StaleDomError } from './observation-policy'
import { getStaleGuard, invalidateStaleGuard } from './stale-guard'

/**
 * Queue guard for multi-action sequences.
 *
 * - `enqueue`: mint a token for a queued action (valid only at the
 *   current snapshot generation for this page).
 * - `assert`: check a token before executing a queued action; a stale
 *   token is an error, not a silent click on a dead DOM.
 * - `invalidate`: terminate queued actions for a page (navigation,
 *   search, back, forward, reload, or tab switch) — navigation tools
 *   also invalidate automatically, so this is for explicit termination.
 * A stale token always means: take a fresh snapshot and re-queue.
 */
export const action_guard = defineTool({
  name: 'action_guard',
  description:
    'Guard queued multi-actions against stale DOM: enqueue mints a token for the current snapshot generation, assert checks it before acting, and invalidate (also called automatically by navigate) terminates queued actions after navigation/search/back/forward/reload/tab-switch. A stale token means take a fresh snapshot and re-queue.',
  input: z
    .object({
      page: z.number().int(),
      action: z.enum(['enqueue', 'assert', 'invalidate']),
      generation: z
        .number()
        .int()
        .optional()
        .describe('Token generation to check, for action="assert".'),
      reason: z
        .string()
        .optional()
        .describe('Why queued actions are terminated, for action="invalidate".'),
    })
    .strict(),
  annotations: { title: 'Guard queued actions', readOnlyHint: true },
  handler: async (args, ctx) => {
    const guard = getStaleGuard(ctx.session, args.page)
    switch (args.action) {
      case 'enqueue': {
        const token = guard.enqueue()
        return textResult(
          `queued action token for page ${args.page}: generation ${token.generation}`,
          { page: args.page, generation: token.generation, current: true },
        )
      }
      case 'assert': {
        if (args.generation === undefined) {
          return errorResult(
            'action_guard assert: generation is required',
          )
        }
        try {
          guard.assertCurrent({ generation: args.generation })
        } catch (err) {
          if (err instanceof StaleDomError) {
            return errorResult(err.message)
          }
          throw err
        }
        return textResult(
          `token generation ${args.generation} is current for page ${args.page}`,
          {
            page: args.page,
            generation: args.generation,
            current: true,
          },
        )
      }
      case 'invalidate': {
        invalidateStaleGuard(
          ctx.session,
          args.page,
          args.reason ?? 'explicit invalidation',
        )
        return textResult(
          `queued actions for page ${args.page} terminated (${args.reason ?? 'explicit invalidation'}); new generation ${guard.currentGeneration()}`,
          {
            page: args.page,
            generation: guard.currentGeneration(),
            current: false,
          },
        )
      }
    }
  },
})
