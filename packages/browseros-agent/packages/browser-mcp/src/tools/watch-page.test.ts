import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { watch_page } from './watch-page'

type Handler = (params: unknown) => void

function mockBrowser() {
  const handlers = new Map<string, Set<Handler>>()
  const on = (domain: string) => (event: string, handler: Handler) => {
    const key = `${domain}.${event}`
    const set = handlers.get(key) ?? new Set<Handler>()
    set.add(handler)
    handlers.set(key, set)
    return () => void set.delete(handler)
  }
  const protocol = {
    Page: { on: on('Page') },
    Target: { on: on('Target') },
  }
  const session = {
    pages: {
      getTabId: () => undefined,
      getSession: async () => ({ session: protocol }),
    },
  } as unknown as BrowserSession
  return {
    session,
    emit: (domain: string, event: string, params: unknown) => {
      for (const handler of handlers.get(`${domain}.${event}`) ?? []) {
        handler(params)
      }
    },
    listenerCount: () =>
      [...handlers.values()].reduce((total, set) => total + set.size, 0),
  }
}

function eventsOf(result: { structuredContent?: unknown }): { type: string }[] {
  return (result.structuredContent as { events: { type: string }[] }).events
}

describe('watch_page', () => {
  it('starts, emits dialog/popup/download/crash events, reads, and stops', async () => {
    const browser = mockBrowser()
    const started = await executeTool(
      watch_page,
      { action: 'start', page: 7 },
      { session: browser.session },
    )
    expect(started.isError).toBeFalsy()
    expect(started.structuredContent).toMatchObject({ page: 7 })
    expect(browser.listenerCount()).toBeGreaterThan(0)

    browser.emit('Page', 'javascriptDialogOpening', {
      message: 'Are you sure?',
      type: 'confirm',
    })
    browser.emit('Page', 'windowOpen', { url: 'https://example.com/pop' })
    browser.emit('Page', 'downloadWillBegin', {
      guid: 'g1',
      suggestedFilename: 'report.pdf',
    })
    browser.emit('Target', 'targetCrashed', {
      targetId: 't1',
      status: 'crashed',
      errorCode: 1,
    })

    const read = await executeTool(
      watch_page,
      { action: 'read', page: 7 },
      { session: browser.session },
    )
    expect(read.isError).toBeFalsy()
    expect(read.structuredContent).toMatchObject({ page: 7, count: 4 })
    expect(eventsOf(read).map((event) => event.type)).toEqual([
      'dialog',
      'popup',
      'download',
      'tab-crash',
    ])

    const stopped = await executeTool(
      watch_page,
      { action: 'stop', page: 7 },
      { session: browser.session },
    )
    expect(stopped.isError).toBeFalsy()
    expect(browser.listenerCount()).toBe(0)

    const afterStop = await executeTool(
      watch_page,
      { action: 'read', page: 7 },
      { session: browser.session },
    )
    expect(afterStop.isError).toBe(true)
  })

  it('requires start before read', async () => {
    const browser = mockBrowser()
    const read = await executeTool(
      watch_page,
      { action: 'read', page: 9 },
      { session: browser.session },
    )
    expect(read.isError).toBe(true)
  })
})
