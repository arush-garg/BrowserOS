import { z } from 'zod'
import { defineTool, errorResult, textResult } from './framework'

export const tabs = defineTool({
  name: 'tabs',
  description:
    'Manage browser tabs: list open pages, open a background page without changing focus, or close one. Use windowId with new to target an unfocused window. Use the returned page id with snapshot/act/navigate.',
  input: z.object({
    action: z.enum(['list', 'new', 'close']).default('list'),
    url: z
      .string()
      .optional()
      .describe(
        'URL for action="new" (required; calls without a URL are rejected so no about:blank tabs are leaked).',
      ),
    background: z
      .boolean()
      .optional()
      .describe(
        'Deprecated for action="new"; tabs always open in the background.',
      ),
    windowId: z
      .number()
      .int()
      .optional()
      .describe(
        'Window id for action="new"; use windows list to select an unfocused window.',
      ),
    hidden: z
      .boolean()
      .default(false)
      .describe('Create in a hidden window for action="new".'),
    page: z.number().int().optional().describe('Page id for action="close".'),
  }),
  annotations: { openWorldHint: true },
  handler: async (args, ctx) => {
    switch (args.action) {
      case 'list': {
        const pages = await ctx.session.pages.list()
        const lines = pages.map(
          (p) => `[${p.pageId}] ${p.url}${p.title ? ` (${p.title})` : ''}`,
        )
        return textResult(lines.join('\n') || '(no open pages)', {
          pages: pages.map((p) => ({
            page: p.pageId,
            url: p.url,
            title: p.title,
            windowId: p.windowId,
          })),
        })
      }
      case 'new': {
        const url = args.url?.trim()
        if (!url) {
          return errorResult(
            'tabs new: url is required. Pass the page URL to open instead of opening about:blank.',
          )
        }
        const page = await ctx.session.pages.newPage(url, {
          background: true,
          hidden: args.hidden,
          windowId: args.windowId ?? ctx.defaultWindowId,
          tabGroupId:
            args.windowId === undefined ? ctx.defaultTabGroupId : undefined,
        })
        return textResult(`opened page ${page}`, { page })
      }
      case 'close': {
        if (args.page === undefined) {
          return errorResult('tabs close: page is required.')
        }
        await ctx.session.pages.close(args.page)
        return textResult(`closed page ${args.page}`, { page: args.page })
      }
      default:
        return errorResult('tabs: unsupported action.')
    }
  },
})
