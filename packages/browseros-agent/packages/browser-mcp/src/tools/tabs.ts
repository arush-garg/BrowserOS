import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'
import { acquirePageLease, getPageLease, releasePageLease } from './page-lease'

export const tabs = defineTool({
  name: 'tabs',
  description:
    'Manage browser tabs. `list` returns every open page, `active` shows the current front page, `new` opens a background page without changing focus, and `close` closes a page. Use `windowId` with `new` to create a page in a specific window, even if it is not focused. Use the returned page id for subsequent actions.',
  input: z
    .object({
      action: z
        .enum([
          'list',
          'active',
          'new',
          'close',
          'match',
          'acquire',
          'release',
          'lease',
        ])
        .default('list'),
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
      page: z
        .number()
        .int()
        .optional()
        .describe('Page id for close/acquire/release/lease.'),
      owner: z
        .string()
        .min(1)
        .optional()
        .describe('Lease owner id for acquire/release.'),
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
            windowId: p.windowId,
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
        const url = args.url?.trim()
        if (!url) {
          return errorResult(
            'tabs new: url is required. Pass the page URL to open instead of opening about:blank.',
          )
        }
        const page = await ctx.session.pages.newPage(url, {
          background: true,
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
      case 'acquire': {
        if (args.page === undefined || !args.owner)
          return errorResult('tabs acquire: page and owner are required.')
        const lease = acquirePageLease(args.page, args.owner)
        return lease.ok
          ? textResult(`leased page ${args.page} to ${args.owner}`, {
              page: args.page,
              lease,
            })
          : errorResult(
              `tabs acquire: page ${args.page} is already leased by ${lease.owner}.`,
            )
      }
      case 'release': {
        if (args.page === undefined || !args.owner)
          return errorResult('tabs release: page and owner are required.')
        return releasePageLease(args.page, args.owner)
          ? textResult(`released page ${args.page}`, {
              page: args.page,
              owner: args.owner,
            })
          : errorResult(
              `tabs release: ${args.owner} does not own page ${args.page}.`,
            )
      }
      case 'lease': {
        if (args.page === undefined)
          return errorResult('tabs lease: page is required.')
        const lease = getPageLease(args.page)
        return textResult(
          lease
            ? `page ${args.page} leased by ${lease.owner}`
            : `page ${args.page} is unleased`,
          { page: args.page, lease: lease ?? null },
        )
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
            windowId: p.windowId,
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
