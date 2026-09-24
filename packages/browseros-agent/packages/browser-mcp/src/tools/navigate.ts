import { z } from 'zod/v4'
import { defineTool, errorResult } from './framework'
import { expandMacro, SEARCH_MACROS } from './navigate-macros'

export const navigate = defineTool({
  name: 'navigate',
  description:
    'Navigate a page: load a url, or go back/forward/reload. Returns a fresh snapshot of the resulting page (navigation invalidates refs, so old [ref=eN] handles no longer apply).',
  input: z
    .object({
      page: z.number().int().describe('Page id from `tabs`.'),
      action: z.enum(['url', 'back', 'forward', 'reload']).default('url'),
      url: z.string().optional().describe('Required when action is "url".'),
      snapshot: z
        .boolean()
        .default(true)
        .describe('Append a page snapshot after navigating (default true).'),
      macro: z
        .enum(SEARCH_MACROS)
        .optional()
        .describe(
          'Search-site shortcut expanded with `query` (action="url" only).',
        ),
      query: z
        .string()
        .optional()
        .describe('Search text for `macro` (URL-encoded automatically).'),
    })
    .strict(),
  annotations: {
    title: 'Navigate page',
    destructiveHint: true,
  },
  handler: async (args, ctx, response) => {
    const nav = ctx.session.nav(args.page)

    if (args.macro) {
      if (args.action !== 'url')
        return errorResult(
          `navigate: macro is only valid with action="url", not "${args.action}".`,
        )
      await nav.goto(expandMacro(args.macro, args.query ?? ''))
    } else {
      switch (args.action) {
        case 'url':
          if (!args.url)
            return errorResult(
              'navigate: url or macro is required for action="url".',
            )
          await nav.goto(args.url)
          break
        case 'back':
          await nav.back()
          break
        case 'forward':
          await nav.forward()
          break
        case 'reload':
          await nav.reload()
          break
      }
    }

    const refreshed = await ctx.session.pages.refresh(args.page)
    const origin =
      refreshed?.url ?? ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    response.text(`navigated (${args.action}) -> ${origin}`)
    response.data({ page: args.page, url: origin })
    if (args.snapshot !== false) response.includeSnapshot(args.page)
    return undefined
  },
})
