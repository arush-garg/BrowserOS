import { z } from 'zod'
import { defineTool, errorResult, intArg } from './framework'
import { expandMacro, SEARCH_MACROS } from './navigate-macros'

const MACRO_DESCRIPTION = `Search macro. Alternative to 'url' for common searches. Supported: ${SEARCH_MACROS.join(', ')}. Pair with 'query'.`

export const navigate = defineTool({
  name: 'navigate',
  description:
    'Navigate a page: load a url, or go back/forward/reload. Returns a fresh snapshot of the resulting page (navigation invalidates refs, so old [ref=eN] handles no longer apply). For common searches, pass `macro` + `query` instead of `url` to expand to the provider search URL (avoids URL hallucination).',
  input: z.object({
    page: intArg().describe('Page id from `tabs`.'),
    action: z.enum(['url', 'back', 'forward', 'reload']).default('url'),
    url: z
      .string()
      .optional()
      .describe(
        'Required when action is "url" and no macro is provided. Ignored when macro is set.',
      ),
    macro: z.enum(SEARCH_MACROS).optional().describe(MACRO_DESCRIPTION),
    query: z
      .string()
      .optional()
      .describe(
        'Search query string. Required when macro is set (defaults to empty string).',
      ),
    snapshot: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Include a fresh snapshot in the response (default true). Pass false when you will snapshot separately or don't need refs — saves significant context on navigation-heavy tasks.",
      ),
  }),
  annotations: {
    title: 'Navigate page',
    destructiveHint: true,
  },
  handler: async (args, ctx, response) => {
    const nav = ctx.session.nav(args.page)
    switch (args.action) {
      case 'url': {
        let targetUrl: string | undefined
        if (args.macro) {
          targetUrl = expandMacro(args.macro, args.query ?? '')
        } else if (args.url) {
          targetUrl = args.url
        }
        if (!targetUrl)
          return errorResult(
            'navigate: provide either `url` or `macro`+`query` for action="url".',
          )
        await nav.goto(targetUrl)
        break
      }
      case 'back':
        if (args.macro || args.url)
          return errorResult(
            'navigate: macro/url are only valid for action="url".',
          )
        await nav.back()
        break
      case 'forward':
        if (args.macro || args.url)
          return errorResult(
            'navigate: macro/url are only valid for action="url".',
          )
        await nav.forward()
        break
      case 'reload':
        if (args.macro || args.url)
          return errorResult(
            'navigate: macro/url are only valid for action="url".',
          )
        await nav.reload()
        break
    }

    const refreshed = await ctx.session.pages.refresh(args.page)
    const origin =
      refreshed?.url ?? ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    response.text(`navigated (${args.action}) -> ${origin}`)
    response.data({ page: args.page, url: origin })
    if (args.snapshot !== false) {
      response.includeSnapshot(args.page)
    }
    return undefined
  },
})
