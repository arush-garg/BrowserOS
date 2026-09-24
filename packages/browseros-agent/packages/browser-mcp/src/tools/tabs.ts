import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'

export const tabs = defineTool({
  name: 'tabs',
  description:
    'Manage browser tabs. `list` returns every open page, `active` shows the current front page, `new` opens a fresh page, and `close` closes a page. When a task would disrupt a tab the user is actively using, prefer cloning it: copy its URL from `list` into `tabs new`, then work in the new page.',
  input: z
    .object({
      action: z
        .enum(['list', 'active', 'new', 'close', 'match'])
        .default('list'),
      url: z
        .string()
        .optional()
        .describe('URL for action="new" (defaults to about:blank).'),
      background: z
        .boolean()
        .default(true)
        .describe('Open without stealing focus for action="new".'),
      page: z.number().int().optional().describe('Page id for action="close".'),
      field: z
        .enum(['title', 'url', 'content'])
        .optional()
        .describe('Field to match against for action="match".'),
      query: z
        .string()
        .optional()
        .describe('Case-insensitive substring to match for action="match".'),
    })
    .strict(),
  annotations: {
    title: 'Manage tabs',
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (args, ctx) => {
    switch (args.action) {
      case 'list': {
        const pages = await ctx.session.pages.list()
        const lines = pages.map(formatPageLine)
        return textResult(lines.join('\n') || '(no open pages)', {
          matchableFields: ['title', 'url', 'content'],
          pages: pages.map((p) => ({
            page: p.pageId,
            url: p.url,
            title: p.title,
          })),
        })
      }
      case 'active': {
        const page = await ctx.session.pages.getActive()
        if (!page) {
          return errorResult('tabs active: no active page found.')
        }
        return textResult(`Active page: ${formatPageLine(page)}`, {
          action: 'active',
          page,
        })
      }
      case 'new': {
        const page = await ctx.session.pages.newPage(
          args.url ?? 'about:blank',
          {
            background: args.background,
            windowId: ctx.defaultWindowId,
            tabGroupId: ctx.defaultTabGroupId,
          },
        )
        return textResult(`opened page ${page}`, { page })
      }
      case 'close': {
        if (args.page === undefined) {
          return errorResult('tabs close: page is required.')
        }
        await ctx.session.pages.close(args.page)
        return textResult(`closed page ${args.page}`, { page: args.page })
      }
      case 'match': {
        const field = args.field ?? 'title'
        const query = (args.query ?? '').toLowerCase()
        const pages = await ctx.session.pages.list()

        const matched: typeof pages = []
        for (const page of pages) {
          let haystack = ''
          if (field === 'title') {
            haystack = page.title ?? ''
          } else if (field === 'url') {
            haystack = page.url ?? ''
          } else {
            const { session } = await ctx.session.pages.getSession(page.pageId)
            const evaluated = await session.Runtime.evaluate({
              expression: 'document.body.innerText',
              returnByValue: true,
            })
            haystack = String(evaluated?.result?.value ?? '')
          }
          if (haystack.toLowerCase().includes(query)) {
            matched.push(page)
          }
        }

        const lines = matched.map(formatPageLine)
        return textResult(lines.join('\n') || '(no open pages)', {
          action: 'match',
          field,
          query: args.query,
          pages: matched.map((p) => ({
            page: p.pageId,
            url: p.url,
            title: p.title,
          })),
        })
      }
      default:
        return errorResult('tabs: unsupported action.')
    }
  },
})

function formatPageLine(page: { pageId: number; url: string; title?: string }) {
  return `[${page.pageId}] ${page.url}${page.title ? ` (${page.title})` : ''}`
}
