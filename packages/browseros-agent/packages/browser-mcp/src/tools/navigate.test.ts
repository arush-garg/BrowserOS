import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { navigate } from './navigate'

function mockSession() {
  const calls = { goto: 0, snapshot: 0 }
  return {
    session: {
      nav: (_page: number) => ({
        goto: async () => {
          calls.goto++
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
