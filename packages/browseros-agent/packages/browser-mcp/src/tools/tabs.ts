import type { PageInfo } from '@browseros/browser-core/core/pages'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { z } from 'zod'
import { defineTool, errorResult, intArg, textResult } from './framework'

type MatchField = 'title' | 'url' | 'content'

async function pageMatchesContent(
  session: BrowserSession,
  page: PageInfo,
  normalizedQuery: string,
): Promise<boolean> {
  const info = session.pages.getInfo(page.pageId)
  if (!info) {
    return false
  }
  try {
    const { session: pageSession } = await session.pages.getSession(page.pageId)
    const result = await pageSession.Runtime.evaluate({
      expression: '(document.body?.innerText ?? "")',
      returnByValue: true,
    })
    const text = String(result.result?.value ?? '')
    return text.toLowerCase().includes(normalizedQuery)
  } catch {
    return false
  }
}

async function pageMatches(
  session: BrowserSession,
  page: PageInfo,
  field: MatchField,
  normalizedQuery: string,
): Promise<boolean> {
  switch (field) {
    case 'title':
      return Boolean(page.title?.toLowerCase().includes(normalizedQuery))
    case 'url':
      return page.url.toLowerCase().includes(normalizedQuery)
    case 'content':
      return await pageMatchesContent(session, page, normalizedQuery)
    default:
      return false
  }
}

async function findMatchingPages(
  session: BrowserSession,
  field: MatchField,
  normalizedQuery: string,
  firstOnly = false,
): Promise<PageInfo[]> {
  const pages = await session.pages.list()
  const matches: PageInfo[] = []
  for (const page of pages) {
    if (await pageMatches(session, page, field, normalizedQuery)) {
      matches.push(page)
      if (firstOnly) break
    }
  }
  return matches
}

export const tabs = defineTool({
  name: 'tabs',
  description:
    "Manage browser tabs. `list` returns every open page grouped by ownership: `Your tabs` (pages you opened via `tabs new`), `User's tabs` (pages the operator opened), and `Other agents' tabs` (pages another AI agent opened). You can act freely on your own tabs. Page-targeted tools (snapshot, act, navigate, close, etc.) reject dispatches on pages you do not own with an error asking you to call `tabs new`. `active` shows the current front page; `new` opens a fresh page; `close` closes one of yours.",
  input: z.object({
    action: z
      .enum(['list', 'active', 'new', 'close', 'match', 'activate', 'switch'])
      .default('list'),
    url: z
      .string()
      .optional()
      .describe('URL for action="new" (defaults to about:blank).'),
    background: z
      .boolean()
      .default(true)
      .describe('Open without stealing focus for action="new".'),
    page: intArg()
      .optional()
      .describe('Page id for action="close" or "activate".'),
    field: z
      .enum(['title', 'url', 'content'])
      .optional()
      .describe(
        'Match field. Defaults to title and URL; content searches page text.',
      ),
    query: z
      .string()
      .optional()
      .describe('Partial or fuzzy tab title/URL, or content text.'),
  }),
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
          pages: pages.map((p) => ({
            page: p.pageId,
            url: p.url,
            title: p.title,
          })),
          matchableFields: ['title', 'url', 'content'],
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
      case 'activate': {
        if (args.page === undefined) {
          return errorResult('tabs activate: page is required.')
        }
        const info = ctx.session.pages.getInfo(args.page)
        if (!info) {
          return errorResult(
            `tabs activate: unknown page ${args.page}. Use tabs action="list" first.`,
          )
        }
        await ctx.session.protocol.Browser.activateTab({ tabId: info.tabId })
        return textResult(`activated page ${args.page}`, {
          action: 'activate',
          page: args.page,
          tabId: info.tabId,
        })
      }
      case 'match': {
        if (args.field === undefined || args.query === undefined) {
          return errorResult('tabs match: field and query are required.')
        }
        const normalizedQuery = args.query.trim().toLowerCase()
        if (!normalizedQuery) {
          return errorResult('tabs match: query must not be empty.')
        }

        const matches = await findMatchingPages(
          ctx.session,
          args.field,
          normalizedQuery,
        )
        const lines = matches.map(formatPageLine)
        return textResult(lines.join('\n') || '(no open pages)', {
          pages: matches.map((p) => ({
            page: p.pageId,
            url: p.url,
            title: p.title,
          })),
        })
      }
      case 'switch': {
        let targetPageId: number | undefined
        if (args.page !== undefined) {
          targetPageId = args.page
        } else if (args.field !== undefined && args.query !== undefined) {
          const normalizedQuery = args.query.trim().toLowerCase()
          if (!normalizedQuery) {
            return errorResult('tabs switch: query must not be empty.')
          }
          const [firstMatch] = await findMatchingPages(
            ctx.session,
            args.field,
            normalizedQuery,
            true,
          )
          if (!firstMatch) {
            return errorResult(
              `tabs switch: no pages matched "${args.query}" on field "${args.field}".`,
            )
          }
          targetPageId = firstMatch.pageId
        } else {
          return errorResult(
            'tabs switch: provide either page id or field+query to switch to a tab.',
          )
        }

        const info = ctx.session.pages.getInfo(targetPageId)
        if (!info) {
          return errorResult(
            `tabs switch: unknown page ${targetPageId}. Use tabs action="list" first.`,
          )
        }
        await ctx.session.protocol.Browser.activateTab({ tabId: info.tabId })
        return textResult(`switched to page ${targetPageId}`, {
          action: 'switch',
          page: targetPageId,
          tabId: info.tabId,
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
