import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { monitor } from './monitor'

type Handler = (params: unknown) => void

interface MockBrowser {
  session: BrowserSession
  /** Delivers one CDP event to every handler registered for it. */
  emit: (domain: string, event: string, params: unknown) => void
  listenerCount: () => number
}

function mockBrowser(): MockBrowser {
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
    Runtime: { on: on('Runtime') },
    DOM: { on: on('DOM') },
  }
  const session = {
    pages: {
      getTabId: () => undefined,
      getSession: async () => ({ session: protocol }),
    },
  } as unknown as BrowserSession
  return {
    session,
    emit: (domain, event, params) => {
      for (const handler of handlers.get(`${domain}.${event}`) ?? []) {
        handler(params)
      }
    },
    listenerCount: () =>
      [...handlers.values()].reduce((total, set) => total + set.size, 0),
  }
}

function eventsOf(result: { structuredContent?: unknown }): {
  type: string
  details: Record<string, unknown>
}[] {
  return (result.structuredContent as { events: never[] }).events
}

describe('monitor tool', () => {
  it('starts, collects events, and stops for a page', async () => {
    const browser = mockBrowser()
    const started = await executeTool(
      monitor,
      { action: 'start', page: 1 },
      { session: browser.session },
    )
    expect(started.isError).toBeFalsy()
    expect(started.structuredContent).toMatchObject({
      page: 1,
      eventTypes: ['navigation', 'loading', 'error', 'dom_change'],
    })
    expect(browser.listenerCount()).toBeGreaterThan(0)

    browser.emit('Page', 'frameNavigated', {
      frame: { id: 'frame-1', url: 'https://example.com/next' },
    })
    browser.emit('Page', 'frameStoppedLoading', { frameId: 'frame-1' })

    const read = await executeTool(
      monitor,
      { action: 'read', page: 1 },
      { session: browser.session },
    )
    expect(read.structuredContent).toMatchObject({ page: 1, count: 2 })
    expect(eventsOf(read).map((event) => event.type)).toEqual([
      'navigation',
      'loading',
    ])
    expect(eventsOf(read)[0]?.details).toMatchObject({
      frameId: 'frame-1',
      url: 'https://example.com/next',
    })

    // The queue is drained by the read, so a second read sees nothing new.
    const drained = await executeTool(
      monitor,
      { action: 'read', page: 1 },
      { session: browser.session },
    )
    expect(drained.structuredContent).toMatchObject({ count: 0 })

    const stopped = await executeTool(
      monitor,
      { action: 'stop', page: 1 },
      { session: browser.session },
    )
    expect(stopped.isError).toBeFalsy()
    expect(stopped.structuredContent).toMatchObject({ page: 1 })
    expect(browser.listenerCount()).toBe(0)
  })

  it('reports an already-running subscription instead of double-subscribing', async () => {
    const browser = mockBrowser()
    await executeTool(
      monitor,
      { action: 'start', page: 1 },
      { session: browser.session },
    )
    const listeners = browser.listenerCount()
    const again = await executeTool(
      monitor,
      { action: 'start', page: 1 },
      { session: browser.session },
    )
    expect(again.isError).toBeFalsy()
    expect(browser.listenerCount()).toBe(listeners)

    browser.emit('Page', 'frameStartedLoading', { frameId: 'frame-1' })
    const read = await executeTool(
      monitor,
      { action: 'read', page: 1 },
      { session: browser.session },
    )
    expect(read.structuredContent).toMatchObject({ count: 1 })
  })

  it('subscribes only to the requested event types', async () => {
    const browser = mockBrowser()
    const started = await executeTool(
      monitor,
      { action: 'start', page: 1, eventTypes: ['error'] },
      { session: browser.session },
    )
    expect(started.structuredContent).toMatchObject({ eventTypes: ['error'] })

    browser.emit('Page', 'frameNavigated', {
      frame: { id: 'frame-1', url: 'https://example.com' },
    })
    browser.emit('Runtime', 'exceptionThrown', {
      exceptionDetails: { text: 'Uncaught TypeError', url: 'https://x/app.js' },
    })

    const read = await executeTool(
      monitor,
      { action: 'read', page: 1 },
      { session: browser.session },
    )
    expect(eventsOf(read).map((event) => event.type)).toEqual(['error'])
    expect(eventsOf(read)[0]?.details).toMatchObject({
      text: 'Uncaught TypeError',
    })
  })

  it('caps the queue at 100 events, dropping the oldest', async () => {
    const browser = mockBrowser()
    await executeTool(
      monitor,
      { action: 'start', page: 1, eventTypes: ['dom_change'] },
      { session: browser.session },
    )
    for (let index = 0; index < 120; index++) {
      browser.emit('DOM', 'characterDataModified', {
        nodeId: index,
        characterData: `text-${index}`,
      })
    }
    const read = await executeTool(
      monitor,
      { action: 'read', page: 1 },
      { session: browser.session },
    )
    const events = eventsOf(read)
    expect(read.structuredContent).toMatchObject({ count: 100, dropped: 20 })
    expect(events).toHaveLength(100)
    expect(events[0]?.details).toMatchObject({ characterData: 'text-20' })
    expect(events[99]?.details).toMatchObject({ characterData: 'text-119' })
  })

  it('errors on read and stop for a page with no subscription', async () => {
    const browser = mockBrowser()
    const read = await executeTool(
      monitor,
      { action: 'read', page: 9 },
      { session: browser.session },
    )
    expect(read.isError).toBe(true)
    const stop = await executeTool(
      monitor,
      { action: 'stop', page: 9 },
      { session: browser.session },
    )
    expect(stop.isError).toBe(true)
  })
})
