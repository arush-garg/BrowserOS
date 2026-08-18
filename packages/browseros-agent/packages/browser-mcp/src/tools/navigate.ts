import { z } from 'zod'
import { defineTool, errorResult, intArg } from './framework'

export const navigate = defineTool({
  name: 'navigate',
  description:
    'Navigate a page: load a url, or go back/forward/reload. Returns a fresh snapshot of the resulting page (navigation invalidates refs, so old [ref=eN] handles no longer apply).',
  input: z.object({
    page: intArg().describe('Page id from `tabs`.'),
    action: z.enum(['url', 'back', 'forward', 'reload']).default('url'),
    url: z.string().optional().describe('Required when action is "url".'),
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
      case 'url':
        if (!args.url)
          return errorResult('navigate: url is required for action="url".')
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
