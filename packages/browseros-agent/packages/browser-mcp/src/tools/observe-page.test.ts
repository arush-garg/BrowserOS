import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { observe_page } from './observe-page'

function sessionWithSnapshot(
  text: string,
  screenshot?: { data: string; mimeType: string; annotations: unknown[] },
): { session: BrowserSession; screenshotCalls: number } {
  let screenshotCalls = 0
  const session = {
    observe: () => ({ snapshot: async () => ({ text }) }),
    screenshot: async () => {
      screenshotCalls += 1
      return (
        screenshot ?? { data: 'aGVsbG8=', mimeType: 'image/jpeg', annotations: [] }
      )
    },
    pages: { getInfo: () => ({ url: 'https://example.com' }) },
  } as unknown as BrowserSession
  return {
    session,
    get screenshotCalls() {
      return screenshotCalls
    },
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

describe('observe_page', () => {
  it('returns the AX tree without a screenshot by default', async () => {
    const browser = sessionWithSnapshot('- button "Save" [ref=e1]')
    const result = await executeTool(
      observe_page,
      { page: 1 },
      { session: browser.session },
    )
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ mode: 'ax', truncated: false })
    expect(browser.screenshotCalls).toBe(0)
    expect(textOf(result)).toContain('Save')
  })

  it('reports truncation with dropped refs and takes no screenshot', async () => {
    const browser = sessionWithSnapshot(
      '- button "Save" [ref=e1]\n- link "Home" [ref=e2]\n- button "Delete" [ref=e3]',
    )
    const result = await executeTool(
      observe_page,
      { page: 1, maxLines: 2 },
      { session: browser.session },
    )
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({
      mode: 'ax',
      truncated: true,
      droppedRefs: ['e3'],
    })
    expect(textOf(result)).toContain('snapshot truncated')
    expect(textOf(result)).toContain('e3')
    expect(browser.screenshotCalls).toBe(0)
  })

  it('adds an annotated screenshot for visual verification', async () => {
    const browser = sessionWithSnapshot('- canvas "Chart"')
    const result = await executeTool(
      observe_page,
      { page: 1, visualVerification: true },
      { session: browser.session },
    )
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ mode: 'ax+screenshot' })
    expect(browser.screenshotCalls).toBe(1)
    expect(Array.isArray(result.content)).toBe(true)
    expect(
      (result.content as Array<{ type: string }>).some(
        (item) => item.type === 'image',
      ),
    ).toBe(true)
  })

  it('falls back to a screenshot when the snapshot is empty', async () => {
    const browser = sessionWithSnapshot('   ')
    const result = await executeTool(
      observe_page,
      { page: 1 },
      { session: browser.session },
    )
    expect(result.isError).toBeFalsy()
    // Empty tree adds nothing, so the fallback is screenshot-only.
    expect(result.structuredContent).toMatchObject({ mode: 'screenshot' })
    expect(browser.screenshotCalls).toBe(1)
  })
})
