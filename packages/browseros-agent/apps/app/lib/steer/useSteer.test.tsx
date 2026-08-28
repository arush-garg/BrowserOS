/**
 * @license
 * Copyright 2025 BrowserOS
 *
 * useSteer — Test Suite
 *
 * Tests for the steer hook that sends mid-turn guidance to the agent.
 */

import { describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { Window } from 'happy-dom'

// happy-dom v20 no longer ships GlobalRegistrator — install the globals
// @testing-library/react needs by hand.
const domWindow = new Window()
const globalScope = globalThis as unknown as Record<string, unknown>
for (const key of ['document', 'window', 'navigator']) {
  globalScope[key] = (domWindow as unknown as Record<string, unknown>)[key]
}
// React 19 requires this for act() to flush state updates.
globalScope.IS_REACT_ACT_ENVIRONMENT = true

mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl: async () => MOCK_URL,
}))

const { useSteer } = await import('./useSteer')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_URL = 'http://localhost:9105'
const CONVERSATION_ID = 'test-conversation-id'

function mockFetch() {
  return mock((_url: unknown, _init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          steerId: 'sid-1',
          status: 'queued_active_turn',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  )
}

function setupFetchMock() {
  global.fetch = mockFetch() as unknown as typeof fetch
}

function renderUseSteer(conversationId = CONVERSATION_ID) {
  return renderHook(() => useSteer({ conversationId }))
}

// ---------------------------------------------------------------------------
// sendSteer — happy path
// ---------------------------------------------------------------------------

describe('sendSteer', () => {
  it('transitions status from idle → sending → queued_active_turn', async () => {
    setupFetchMock()
    const { result } = renderUseSteer()

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeNull()

    await act(async () => {
      result.current.sendSteer('turn left')
    })

    // Microtask — wait for fetch to resolve
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(result.current.status).toBe('queued_active_turn')
    expect(result.current.error).toBeNull()
    expect(result.current.lastSentText).toBe('turn left')
  })

  it('POSTs to the correct URL with conversationId and message', async () => {
    setupFetchMock()
    const { result } = renderUseSteer()

    await act(async () => {
      result.current.sendSteer('turn left')
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] =
      (global.fetch as unknown as ReturnType<typeof mockFetch>).mock.calls.at(
        0,
      ) ?? []
    expect(url).toBe(`${MOCK_URL}/chat/${CONVERSATION_ID}/steer`)
    expect(JSON.parse(init?.body as string)).toEqual({
      conversationId: CONVERSATION_ID,
      message: 'turn left',
    })
  })
})

// ---------------------------------------------------------------------------
// sendSteer — error paths
// ---------------------------------------------------------------------------

describe('sendSteer errors', () => {
  it('sets status to error when fetch throws', async () => {
    global.fetch = mock(() =>
      Promise.reject(new Error('network down')),
    ) as unknown as typeof fetch

    const { result } = renderUseSteer()

    await act(async () => {
      result.current.sendSteer('go')
    })

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('network down')
  })

  it('sets status to error when server returns non-200', async () => {
    global.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'rate limited' }), {
          status: 500,
        }),
      ),
    ) as unknown as typeof fetch

    const { result } = renderUseSteer()

    await act(async () => {
      result.current.sendSteer('go')
    })

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('rate limited')
  })
})

// ---------------------------------------------------------------------------
// sendSteer — empty text is ignored
// ---------------------------------------------------------------------------

describe('sendSteer empty text', () => {
  it('does not send when text is empty', async () => {
    setupFetchMock()
    const { result } = renderUseSteer()

    await act(async () => {
      result.current.sendSteer('')
    })

    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 0))

    expect(global.fetch).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(result.current.lastSentText).toBe('')
  })

  it('does not send when text is whitespace only', async () => {
    setupFetchMock()
    const { result } = renderUseSteer()

    await act(async () => {
      result.current.sendSteer('   ')
    })

    await new Promise((r) => setTimeout(r, 0))

    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// abort
// ---------------------------------------------------------------------------

describe('abort', () => {
  it('resets status to idle and clears pending text', async () => {
    setupFetchMock()
    const { result } = renderUseSteer()

    result.current.sendSteer('go')
    result.current.abort()

    expect(result.current.status).toBe('idle')
    expect(result.current.lastSentText).toBe('')
  })

  it('aborts in-flight fetch when called', async () => {
    let resolveFetch: ((v: Response) => void) | undefined
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    // Honor the abort signal like real fetch — otherwise the aborted
    // request still resolves and the hook overwrites state from its
    // response.
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    global.fetch = mock(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          // Signal may already be aborted when fetch is called (abort()
          // runs before the async getAgentServerUrl() resolves).
          if (init?.signal?.aborted) {
            reject(abortError)
            return
          }
          init?.signal?.addEventListener('abort', () => {
            reject(abortError)
          })
          fetchPromise.then(resolve, reject)
        }),
    ) as unknown as typeof fetch

    const { result } = renderUseSteer()

    await act(async () => {
      result.current.sendSteer('go')
      result.current.abort()
    })

    // The fetch should have been aborted — resolve it with a response
    // that would have been ignored
    resolveFetch?.(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    )

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    // Status should remain idle because abort error is swallowed
    expect(result.current.status).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// clearPendingText
// ---------------------------------------------------------------------------

describe('clearPendingText', () => {
  it('clears lastSentText without changing status', async () => {
    setupFetchMock()
    const { result } = renderUseSteer()

    await act(async () => {
      result.current.sendSteer('go')
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(result.current.lastSentText).toBe('go')

    act(() => {
      result.current.clearPendingText()
    })
    expect(result.current.lastSentText).toBe('')
    // Status unchanged
    expect(result.current.status).toBe('queued_active_turn')
  })
})

// ---------------------------------------------------------------------------
// toggleExpanded / closeExpanded
// ---------------------------------------------------------------------------

describe('expand state', () => {
  it('starts collapsed', () => {
    const { result } = renderUseSteer()
    expect(result.current.isExpanded).toBe(false)
  })

  it('toggles expanded state', () => {
    const { result } = renderUseSteer()
    act(() => result.current.toggleExpanded())
    expect(result.current.isExpanded).toBe(true)
    act(() => result.current.toggleExpanded())
    expect(result.current.isExpanded).toBe(false)
  })

  it('closeExpanded collapses', () => {
    const { result } = renderUseSteer()
    act(() => result.current.toggleExpanded())
    act(() => result.current.closeExpanded())
    expect(result.current.isExpanded).toBe(false)
  })
})
