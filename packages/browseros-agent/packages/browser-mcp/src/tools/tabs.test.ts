import { beforeEach, describe, expect, it } from 'bun:test'
import type { PageInfo, PageSession } from '@browseros/browser-core/core/pages'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { tabs } from './tabs'

function createMockSession(): BrowserSession {
  return {
    pages: {
      list: () => Promise.resolve([]),
      getActive: () => Promise.resolve(null),
      newPage: () => Promise.resolve({}),
      close: () => Promise.resolve(),
      getInfo: () => Promise.resolve(undefined),
      resolveTabIds: () => Promise.resolve([]),
    },
    cdp: () => Promise.resolve({}),
    defaultWindowId: 1,
    defaultTabGroupId: '1',
  } as unknown as BrowserSession
}

function textOf(result: { content?: unknown } | undefined): string {
  if (!Array.isArray(result?.content)) return ''
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'text' &&
        'text' in item &&
        typeof item.text === 'string',
    )
    .map((item) => item.text)
    .join('\n')
}

describe('tabs tool', () => {
  let mockSession: BrowserSession

  beforeEach(() => {
    mockSession = createMockSession()
  })

  describe('match action', () => {
    it('should match tabs by title', async () => {
      const pages: PageInfo[] = [
        {
          pageId: 1,
          url: 'https://example.com',
          title: 'Example Domain',
          targetId: '1',
          tabId: 1,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
        {
          pageId: 2,
          url: 'https://google.com',
          title: 'Google',
          targetId: '2',
          tabId: 2,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
        {
          pageId: 3,
          url: 'https://github.com',
          title: 'GitHub',
          targetId: '3',
          tabId: 3,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
      ]
      mockSession.pages.list = () => Promise.resolve(pages)

      const result = await executeTool(
        tabs,
        { action: 'match', field: 'title', query: 'example' },
        { session: mockSession },
      )

      expect(result.isError).toBeFalsy()
      const output = textOf(result)
      expect(output).toContain('[1] https://example.com (Example Domain)')
      expect(output).not.toContain('[2] https://google.com')
      expect(output).not.toContain('[3] https://github.com')
    })

    it('should match tabs by url', async () => {
      const pages: PageInfo[] = [
        {
          pageId: 1,
          url: 'https://example.com',
          title: 'Example Domain',
          targetId: '1',
          tabId: 1,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
        {
          pageId: 2,
          url: 'https://google.com',
          title: 'Google',
          targetId: '2',
          tabId: 2,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
        {
          pageId: 3,
          url: 'https://github.com',
          title: 'GitHub',
          targetId: '3',
          tabId: 3,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
      ]
      mockSession.pages.list = () => Promise.resolve(pages)

      const result = await executeTool(
        tabs,
        { action: 'match', field: 'url', query: 'github' },
        { session: mockSession },
      )

      expect(result.isError).toBeFalsy()
      const output = textOf(result)
      expect(output).toContain('[3] https://github.com (GitHub)')
      expect(output).not.toContain('[1] https://example.com')
      expect(output).not.toContain('[2] https://google.com')
    })

    it('should match tabs by content', async () => {
      const pages: PageInfo[] = [
        {
          pageId: 1,
          url: 'https://example.com',
          title: 'Example Domain',
          targetId: '1',
          tabId: 1,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
        {
          pageId: 2,
          url: 'https://google.com',
          title: 'Google',
          targetId: '2',
          tabId: 2,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
      ]
      mockSession.pages.list = () => Promise.resolve(pages)

      // Mock the getInfo to return proper PageInfo (getInfo is synchronous)
      mockSession.pages.getInfo = (pageId: number) =>
        pages.find((p) => p.pageId === pageId)

      // Mock the per-page CDP session used for content evaluation
      mockSession.pages.getSession = (pageId: number) =>
        Promise.resolve({
          targetId: String(pageId),
          sessionId: `session-${pageId}`,
          url: pages.find((p) => p.pageId === pageId)?.url ?? '',
          session: {
            Runtime: {
              evaluate: async () => {
                if (pageId === 1) {
                  return { result: { value: 'This is an example page.' } }
                }
                if (pageId === 2) {
                  return { result: { value: 'Google search page' } }
                }
                return { result: { value: '' } }
              },
            },
          },
        } as unknown as PageSession)

      const result = await executeTool(
        tabs,
        { action: 'match', field: 'content', query: 'example' },
        { session: mockSession },
      )

      expect(result.isError).toBeFalsy()
      const output = textOf(result)
      expect(output).toContain('[1] https://example.com (Example Domain)')
      expect(output).not.toContain('[2] https://google.com (Google)')
    })

    it('should return no matches when query not found', async () => {
      const pages: PageInfo[] = [
        {
          pageId: 1,
          url: 'https://example.com',
          title: 'Example Domain',
          targetId: '1',
          tabId: 1,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
        {
          pageId: 2,
          url: 'https://google.com',
          title: 'Google',
          targetId: '2',
          tabId: 2,
          isActive: false,
          isLoading: false,
          loadProgress: 100,
          isPinned: false,
        },
      ]
      mockSession.pages.list = () => Promise.resolve(pages)

      const result = await executeTool(
        tabs,
        { action: 'match', field: 'title', query: 'nonexistent' },
        { session: mockSession },
      )

      expect(result.isError).toBeFalsy()
      const output = textOf(result)
      expect(output).toBe('(no open pages)')
    })
  })
})
