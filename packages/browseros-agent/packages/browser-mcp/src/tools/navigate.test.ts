import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { navigate } from './navigate'

interface NavigateCalls {
  goto: number
  snapshot: number
  lastGotoUrl: string
}

function mockSession() {
  const calls: NavigateCalls = { goto: 0, snapshot: 0, lastGotoUrl: '' }
  return {
    session: {
      nav: (_page: number) => ({
        goto: async (url: string) => {
          calls.goto++
          calls.lastGotoUrl = url
        },
        back: async () => {},
        forward: async () => {},
        reload: async () => {},
      }),
      pages: {
        refresh: async (_page: number) => ({ url: 'https://example.com/nav' }),
        getInfo: (_page: number) => ({ url: 'https://example.com/nav' }),
      },
      observe: (_page: number) => ({
        snapshot: async () => {
          calls.snapshot++
          return { text: '[snapshot content]' }
        },
        diff: async () => ({
          changed: false,
          before: '',
          after: '',
          beforeUrl: '',
          afterUrl: '',
        }),
      }),
    } as unknown as BrowserSession,
    calls,
  }
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

describe('navigate tool schema', () => {
  it('defaults snapshot to true', () => {
    const parsed = navigate.input.parse({
      page: 1,
      action: 'url',
      url: 'https://example.com',
    })
    expect(parsed.snapshot).toBe(true)
  })

  it('accepts snapshot: false', () => {
    const parsed = navigate.input.parse({
      page: 1,
      action: 'url',
      url: 'https://example.com',
      snapshot: false,
    })
    expect(parsed.snapshot).toBe(false)
  })

  it('accepts macro without url', () => {
    const parsed = navigate.input.parse({
      page: 1,
      macro: '@google_search',
      query: 'hello world',
    })
    expect(parsed.macro).toBe('@google_search')
    expect(parsed.query).toBe('hello world')
  })
})

describe('navigate handler', () => {
  it('calls goto and returns navigation result', async () => {
    const { session, calls } = mockSession()
    const result = await executeTool(
      navigate,
      { page: 1, action: 'url', url: 'https://example.com' },
      { session },
    )
    expect(result.isError).toBeFalsy()
    expect(calls.goto).toBe(1)
    expect(textOf(result)).toContain('navigated (url)')
    expect(textOf(result)).toContain('https://example.com/nav')
  })

  it('includes snapshot when snapshot is true (default)', async () => {
    const { session, calls } = mockSession()
    const result = await executeTool(
      navigate,
      { page: 1, action: 'url', url: 'https://example.com' },
      { session },
    )
    expect(calls.snapshot).toBeGreaterThanOrEqual(1)
    expect(textOf(result)).toContain('[Page 1 snapshot]')
  })

  it('suppresses snapshot when snapshot is false', async () => {
    const { session, calls } = mockSession()
    const result = await executeTool(
      navigate,
      { page: 1, action: 'url', url: 'https://example.com', snapshot: false },
      { session },
    )
    expect(calls.snapshot).toBe(0)
    expect(textOf(result)).not.toContain('[Page 1 snapshot]')
  })
})

describe('navigate macro expansion', () => {
  it('navigates to google search URL when macro is @google_search', async () => {
    const { session, calls } = mockSession()
    const result = await executeTool(
      navigate,
      { page: 1, macro: '@google_search', query: 'hello world' },
      { session },
    )
    expect(result.isError).toBeFalsy()
    expect(calls.goto).toBe(1)
    expect(calls.lastGotoUrl).toContain('google.com/search')
    expect(calls.lastGotoUrl).toContain('hello%20world')
  })

  it('expands every supported macro to the right base URL', async () => {
    const cases: Array<{ macro: string; contains: string }> = [
      { macro: '@youtube_search', contains: 'youtube.com/results' },
      { macro: '@amazon_search', contains: 'amazon.com/s' },
      { macro: '@reddit_search', contains: 'reddit.com/search' },
      { macro: '@wikipedia_search', contains: 'wikipedia.org/w/index.php' },
      { macro: '@twitter_search', contains: 'twitter.com/search' },
      { macro: '@yelp_search', contains: 'yelp.com/search' },
      { macro: '@spotify_search', contains: 'open.spotify.com/search' },
      { macro: '@netflix_search', contains: 'netflix.com/search' },
      { macro: '@linkedin_search', contains: 'linkedin.com/search' },
      { macro: '@instagram_search', contains: 'instagram.com/explore' },
      { macro: '@tiktok_search', contains: 'tiktok.com/search' },
      { macro: '@twitch_search', contains: 'twitch.tv/search' },
    ]
    for (const { macro, contains } of cases) {
      const { session, calls } = mockSession()
      const result = await executeTool(
        navigate,
        { page: 1, macro, query: 'cat videos' },
        { session },
      )
      expect(result.isError).toBeFalsy()
      expect(calls.lastGotoUrl).toContain(contains)
      expect(calls.lastGotoUrl).toContain('cat%20videos')
    }
  })

  it('url-encodes the query string', async () => {
    const { session, calls } = mockSession()
    await executeTool(
      navigate,
      { page: 1, macro: '@youtube_search', query: 'a&b/c d' },
      { session },
    )
    expect(calls.lastGotoUrl).not.toContain('a&b/c d')
    expect(calls.lastGotoUrl).toContain(encodeURIComponent('a&b/c d'))
  })

  it('uses empty query when query is omitted with macro', async () => {
    const { session, calls } = mockSession()
    await executeTool(
      navigate,
      { page: 1, macro: '@google_search' },
      { session },
    )
    expect(calls.lastGotoUrl).toContain('google.com/search?q=')
  })

  it('returns error when macro set with action=back', async () => {
    const { session } = mockSession()
    const result = await executeTool(
      navigate,
      { page: 1, action: 'back', macro: '@google_search' },
      { session },
    )
    expect(result.isError).toBe(true)
  })

  it('returns error when neither url nor macro provided', async () => {
    const { session } = mockSession()
    const result = await executeTool(
      navigate,
      { page: 1, action: 'url' },
      { session },
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('macro')
  })
})
