/* biome-disable suspicious/noExplicitAny style/noNonNullAssertion */
/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { createWebFetchTool } from '../web-fetch'

/**
 * Creates a mock Browser that simulates the search → fetch → extract flow.
 */
function createMockBrowser() {
  const calls: Record<string, unknown[][]> = {
    newPage: [],
    evaluate: [],
    goto: [],
    contentAsMarkdown: [],
    closePage: [],
  }

  return {
    calls,
    browser: {
      async newPage(url: string, opts?: Record<string, unknown>) {
        calls.newPage.push([url, opts])
        return 42
      },
      async evaluate(pageId: number, script: string) {
        calls.evaluate.push([pageId, script])
        return {
          value: [
            {
              title: 'BrowserOS Agent Docs',
              url: 'https://docs.browseros.ai/agent',
              snippet: 'The official BrowserOS agent documentation',
            },
            {
              title: 'BrowserOS GitHub',
              url: 'https://github.com/browseros/browseros',
              snippet: 'Open source browser automation',
            },
            {
              title: 'BrowserOS Blog',
              url: 'https://blog.browseros.ai',
              snippet: 'Latest updates from BrowserOS',
            },
          ],
          error: undefined,
        }
      },
      async goto(pageId: number, url: string) {
        calls.goto.push([pageId, url])
      },
      async contentAsMarkdown(pageId: number, opts?: Record<string, unknown>) {
        calls.contentAsMarkdown.push([pageId, opts])
        return '# Example Page\n\nThis is the fetched content from the search result.\n\nMore details here.'
      },
      async closePage(pageId: number) {
        calls.closePage.push([pageId])
      },
    } as unknown,
  }
}

describe('Web Fetch Tool', () => {
  it('exports a tool with description and schema', () => {
    const { browser } = createMockBrowser()
    const tool = createWebFetchTool(browser as any)

    expect(tool.description).toBeTruthy()
    expect(tool.inputSchema).toBeTruthy()
    const exec = (tool as unknown as { execute?: unknown }).execute
    expect(typeof exec).toBe('function')
  })

  it('fetches search results and returns formatted text', async () => {
    const { browser, calls } = createMockBrowser()
    const tool = createWebFetchTool(browser as any)

    const result = (await (
      tool as unknown as {
        execute?: (params: unknown, ctx?: unknown) => Promise<unknown>
      }
    ).execute(
      { query: 'browseros agent', n: 2, engine: 'brave' },
      {} as unknown,
    )) as {
      text: string
      isError: boolean
    }

    expect(result).toBeDefined()
    expect(typeof result.text).toBe('string')
    expect(result.isError).toBe(false)

    expect(result.text).toContain('Found 2 result')
    expect(result.text).toContain('BrowserOS Agent Docs')
    expect(result.text).toContain('BrowserOS GitHub')
    expect(result.text).toContain('https://docs.browseros.ai/agent')
    expect(result.text).toContain('https://github.com/browseros/browseros')

    expect(calls.newPage.length).toBe(1)
    expect(calls.newPage[0][0]).toContain('search.brave.com/search?q=')
    expect(calls.evaluate.length).toBe(1)
    expect(calls.evaluate[0][0]).toBe(42)
    expect(calls.goto.length).toBe(2)
    expect(calls.goto[0][1]).toBe('https://docs.browseros.ai/agent')
    expect(calls.goto[1][1]).toBe('https://github.com/browseros/browseros')
    expect(calls.contentAsMarkdown.length).toBe(2)
    expect(calls.closePage.length).toBeGreaterThanOrEqual(1)
  })

  it('returns error when evaluate fails', async () => {
    const errorBrowser = {
      async newPage(_url: string, _opts?: Record<string, unknown>) {
        return 42
      },
      async evaluate(_pageId: number, _script: string) {
        return { value: undefined, error: 'Script execution failed' }
      },
      async goto() {},
      async contentAsMarkdown() {
        return ''
      },
      async closePage() {},
    } as unknown

    const tool = createWebFetchTool(errorBrowser as any)
    const result = (await (
      tool as unknown as {
        execute?: (params: unknown, ctx?: unknown) => Promise<unknown>
      }
    ).execute({ query: 'test', n: 1, engine: 'google' }, {} as unknown)) as {
      text: string
      isError: boolean
    }

    expect(result.isError).toBe(true)
    expect(result.text).toContain('Failed to extract search results')
  })

  it('returns message when no search results found', async () => {
    const emptyBrowser = {
      async newPage(_url: string, _opts?: Record<string, unknown>) {
        return 42
      },
      async evaluate(_pageId: number, _script: string) {
        return { value: [], error: undefined }
      },
      async goto() {},
      async contentAsMarkdown() {
        return ''
      },
      async closePage() {},
    } as unknown

    const tool = createWebFetchTool(emptyBrowser as any)
    const result = (await (
      tool as unknown as {
        execute?: (params: unknown, ctx?: unknown) => Promise<unknown>
      }
    ).execute(
      { query: 'obscure query with no results', n: 3, engine: 'duckduckgo' },
      {} as unknown,
    )) as { text: string; isError: boolean }

    expect(result.isError).toBe(false)
    expect(result.text).toContain('No search results found')
  })

  it('uses the correct search engine URL', async () => {
    // Test Google
    const googleMock = createMockBrowser()
    const googleTool = createWebFetchTool(googleMock.browser as any)
    await (
      googleTool as unknown as {
        execute?: (params: unknown, ctx?: unknown) => Promise<unknown>
      }
    ).execute({ query: 'test', engine: 'google' }, {} as unknown)
    expect(googleMock.calls.newPage[0][0]).toContain('google.com/search?q=')

    // Test DuckDuckGo
    const ddgMock = createMockBrowser()
    const ddgTool = createWebFetchTool(ddgMock.browser as any)
    await (
      ddgTool as unknown as {
        execute?: (params: unknown, ctx?: unknown) => Promise<unknown>
      }
    ).execute({ query: 'test', engine: 'duckduckgo' }, {} as unknown)
    expect(ddgMock.calls.newPage[0][0]).toContain('duckduckgo.com/?q=')

    // Test Brave (default)
    const braveMock = createMockBrowser()
    const braveTool = createWebFetchTool(braveMock.browser as any)
    await (
      braveTool as unknown as {
        execute?: (params: unknown, ctx?: unknown) => Promise<unknown>
      }
    ).execute({ query: 'test', engine: 'brave' }, {} as unknown)
    expect(braveMock.calls.newPage[0][0]).toContain(
      'search.brave.com/search?q=',
    )
  }, 20000)
})
