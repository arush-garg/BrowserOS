import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { act } from './act'
import { executeTool } from './framework'

function mockInput() {
  const calls: { kind: string; args: unknown[] }[] = []
  return {
    input: {
      click: async (...args: unknown[]) => {
        calls.push({ kind: 'click', args })
      },
      clickBackendNode: async (...args: unknown[]) => {
        calls.push({ kind: 'clickBackendNode', args })
      },
      hover: async (...args: unknown[]) => {
        calls.push({ kind: 'hover', args })
      },
      hoverBackendNode: async (...args: unknown[]) => {
        calls.push({ kind: 'hoverBackendNode', args })
      },
      fill: async (...args: unknown[]) => {
        calls.push({ kind: 'fill', args })
      },
      fillBackendNode: async (...args: unknown[]) => {
        calls.push({ kind: 'fillBackendNode', args })
      },
      focus: async (...args: unknown[]) => {
        calls.push({ kind: 'focus', args })
      },
      focusBackendNode: async (...args: unknown[]) => {
        calls.push({ kind: 'focusBackendNode', args })
      },
      type: async (...args: unknown[]) => {
        calls.push({ kind: 'type', args })
      },
      press: async (...args: unknown[]) => {
        calls.push({ kind: 'press', args })
      },
      selectOption: async (...args: unknown[]) => {
        calls.push({ kind: 'selectOption', args })
      },
      scroll: async (...args: unknown[]) => {
        calls.push({ kind: 'scroll', args })
      },
      drag: async (...args: unknown[]) => {
        calls.push({ kind: 'drag', args })
      },
      clickAt: async (...args: unknown[]) => {
        calls.push({ kind: 'clickAt', args })
      },
      hoverAt: async (...args: unknown[]) => {
        calls.push({ kind: 'hoverAt', args })
      },
      typeAt: async (...args: unknown[]) => {
        calls.push({ kind: 'typeAt', args })
      },
      dragAt: async (...args: unknown[]) => {
        calls.push({ kind: 'dragAt', args })
      },
      check: async (...args: unknown[]) => {
        calls.push({ kind: 'check', args })
      },
      uncheck: async (...args: unknown[]) => {
        calls.push({ kind: 'uncheck', args })
      },
    },
    calls,
  }
}

function mockSessionWithSelector(backendNodeId = 42) {
  const { input, calls } = mockInput()
  let clickBackendNodeError = false
  // Override clickBackendNode to simulate stale error on first call if needed
  const originalClickBackendNode = input.clickBackendNode
  input.clickBackendNode = async (...args: unknown[]) => {
    if (!clickBackendNodeError) {
      clickBackendNodeError = true
      throw new Error('Element detached')
    }
    return originalClickBackendNode(...args)
  }

  return {
    session: {
      input: () => input,
      pages: {
        getSession: async () => ({
          session: {
            DOM: {
              getDocument: async () => ({
                root: { nodeId: 1 },
              }),
              querySelector: async () => ({
                nodeId: 7,
              }),
              describeNode: async () => ({
                node: { backendNodeId },
              }),
            },
          },
        }),
      },
      observe: () => ({
        diff: async () => ({
          changed: false,
          before: '',
          after: '',
          beforeUrl: '',
          afterUrl: '',
        }),
        // Snapshot is a no‑op for tests – just resolves
        snapshot: async () => {},
      }),
    } as unknown as BrowserSession,
    calls,
  }
}

function mockSessionWithNoMatch() {
  const { input, calls } = mockInput()
  return {
    session: {
      input: () => input,
      pages: {
        getSession: async () => ({
          session: {
            DOM: {
              getDocument: async () => ({
                root: { nodeId: 1 },
              }),
              querySelector: async () => ({
                nodeId: 0,
              }),
              describeNode: async () => ({
                node: { backendNodeId: 0 },
              }),
            },
          },
        }),
      },
      observe: () => ({
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

describe('act selector resolution', () => {
  it('resolves selector and calls clickBackendNode', async () => {
    const { session, calls } = mockSessionWithSelector(42)
    const result = await executeTool(
      act,
      { page: 1, kind: 'click', selector: '#my-button' },
      { session },
    )
    expect(result.isError).toBeFalsy()
    expect(calls).toContainEqual({
      kind: 'clickBackendNode',
      args: [42, {}],
    })
    expect(textOf(result)).toContain('ok (click)')
  })

  it('resolves selector and calls hoverBackendNode', async () => {
    const { session, calls } = mockSessionWithSelector(99)
    const result = await executeTool(
      act,
      { page: 1, kind: 'hover', selector: '.tooltip' },
      { session },
    )
    expect(result.isError).toBeFalsy()
    expect(calls).toContainEqual({
      kind: 'hoverBackendNode',
      args: [99],
    })
  })

  it('resolves selector and calls fillBackendNode with value', async () => {
    const { session, calls } = mockSessionWithSelector(55)
    const result = await executeTool(
      act,
      { page: 1, kind: 'fill', selector: 'input[name=q]', value: 'test' },
      { session },
    )
    expect(result.isError).toBeFalsy()
    expect(calls).toContainEqual({
      kind: 'fillBackendNode',
      args: [55, 'test', { clear: undefined }],
    })
  })

  it('returns error when both ref and selector are provided', async () => {
    const { session } = mockSessionWithSelector()
    const result = await executeTool(
      act,
      { page: 1, kind: 'click', ref: 'e1', selector: '#btn' },
      { session },
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('provide either ref or selector, not both')
  })

  it('returns error when selector matches no elements', async () => {
    const { session } = mockSessionWithNoMatch()
    const result = await executeTool(
      act,
      { page: 1, kind: 'click', selector: '#nonexistent' },
      { session },
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('matched no elements')
  })
})

describe('act retry logic', () => {
  it('retries selector-based click on stale refs error', async () => {
    const { session, calls } = mockSessionWithSelector(42)
    const result = await executeTool(
      act,
      { page: 1, kind: 'click', selector: '#my-button' },
      { session },
    )
    // Should succeed on second attempt
    expect(result.isError).toBeFalsy()
    // First call throws error, second succeeds
    const clickCalls = calls.filter((call) => call.kind === 'clickBackendNode')
    expect(clickCalls).toHaveLength(1) // Only the successful retry is recorded in our mock
  })

  it('retries selector-based fill on navigation race error', async () => {
    const { session } = mockSessionWithSelector(55)
    // Mock to throw navigation race on first fill attempt
    let fillAttempts = 0
    const originalFillBackendNode = session.input(1).fillBackendNode
    session.input(1).fillBackendNode = async (
      backendNodeId: number,
      value: string,
      opts: { clear?: boolean } = {},
    ) => {
      fillAttempts++
      if (fillAttempts === 1) {
        throw new Error('Navigating frame was detached')
      }
      return originalFillBackendNode(backendNodeId, value, opts)
    }

    const result = await executeTool(
      act,
      { page: 1, kind: 'fill', selector: 'input[name=q]', value: 'test' },
      { session },
    )
    expect(result.isError).toBeFalsy()
    // Should have retried and succeeded
    expect(fillAttempts).toBe(2)
  })

  it('returns clear error for ref-based actions after snapshot refresh', async () => {
    const { session } = mockSessionWithSelector()
    // Mock to always throw stale refs error for ref actions
    session.input(1).click = async () => {
      throw new Error('Element detached')
    }

    const result = await executeTool(
      act,
      { page: 1, kind: 'click', ref: 'e12' },
      { session },
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('stale reference for ref "e12"')
    expect(textOf(result)).toContain(
      'please refresh the snapshot and retry with a fresh ref',
    )
  })

  it('does not retry non-retryable errors', async () => {
    const { session, calls } = mockSessionWithSelector(42)
    // Mock to throw a non-retryable error on clickBackendNode (selector-based)
    session.input(1).clickBackendNode = async () => {
      throw new Error('Element not visible')
    }

    const result = await executeTool(
      act,
      { page: 1, kind: 'click', selector: '#my-button' },
      { session },
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Element not visible')
    // Should not retry - only one attempt
    const clickCalls = calls.filter((call) => call.kind === 'clickBackendNode')
    expect(clickCalls).toHaveLength(0) // No successful calls
  })

  it('gives up after max attempts for selector actions', async () => {
    const { session } = mockSessionWithSelector(42)
    // Mock to always throw stale refs error
    let attemptCount = 0
    session.input(1).clickBackendNode = async () => {
      attemptCount++
      throw new Error('Element detached')
    }

    const result = await executeTool(
      act,
      { page: 1, kind: 'click', selector: '#my-button' },
      { session },
    )
    expect(result.isError).toBe(true)
    // Should have tried maxAttempts times (2)
    expect(attemptCount).toBe(2)
  })
})

// --- hold + recover -------------------------------------------------------

interface HoldHarnessOptions {
  evaluate?: () => unknown
  clickFailures?: number
  clickError?: string
}

function mockHoldSession(options: HoldHarnessOptions = {}) {
  const calls: { kind: string; args: unknown[] }[] = []
  const strategies: string[] = []
  let remainingClickFailures = options.clickFailures ?? 0

  const input = {
    click: async (...args: unknown[]) => {
      if (remainingClickFailures > 0) {
        remainingClickFailures -= 1
        throw new Error(options.clickError ?? 'Element detached')
      }
      calls.push({ kind: 'click', args })
    },
    type: async (...args: unknown[]) => {
      calls.push({ kind: 'type', args })
    },
    scroll: async (...args: unknown[]) => {
      strategies.push('scroll')
      calls.push({ kind: 'scroll', args })
    },
    // Run the waiter exactly as the real implementation does, so a timing-out
    // predicate still reaches the release path.
    hold: async (ref: unknown, hold: () => Promise<void>, opts: unknown) => {
      calls.push({ kind: 'hold', args: [ref, opts] })
      try {
        await hold()
      } finally {
        calls.push({ kind: 'release', args: [ref] })
      }
    },
    holdAt: async (
      x: unknown,
      y: unknown,
      hold: () => Promise<void>,
      opts: unknown,
    ) => {
      calls.push({ kind: 'holdAt', args: [x, y, opts] })
      try {
        await hold()
      } finally {
        calls.push({ kind: 'release', args: [x, y] })
      }
    },
  }

  const session = {
    input: () => input,
    pages: {
      getSession: async () => ({
        session: {
          Runtime: {
            evaluate: async () => ({
              result: { value: options.evaluate?.() ?? false },
            }),
          },
        },
      }),
    },
    observe: () => ({
      diff: async () => ({
        changed: false,
        before: '',
        after: '',
        beforeUrl: '',
        afterUrl: '',
      }),
      snapshot: async () => {
        strategies.push('resnapshot')
      },
    }),
  } as unknown as BrowserSession

  return { session, calls, strategies }
}

function noteOf(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return ''
  const first = result.content[0] as { text?: string } | undefined
  return first?.text ?? ''
}

describe('act hold', () => {
  it('presses, waits the requested time, and releases', async () => {
    // Arrange
    const { session, calls } = mockHoldSession()

    // Act
    const result = await executeTool(
      act,
      { page: 1, kind: 'hold', ref: 'e5', until: { kind: 'time', ms: 20 } },
      { session },
    )

    // Assert
    expect(result.isError).toBeFalsy()
    expect(calls.map((c) => c.kind)).toEqual(['hold', 'release'])
    expect(calls[0]?.args[0]).toBe('e5')
    expect(noteOf(result)).toContain('released on paused 20ms')
  })

  it('defaults to a fixed-duration hold when no condition is given', async () => {
    const { session, calls } = mockHoldSession()

    const result = await executeTool(
      act,
      { page: 1, kind: 'hold', ref: 'e5', holdTimeout: 50 },
      { session },
    )

    expect(result.isError).toBeFalsy()
    expect(calls.map((c) => c.kind)).toEqual(['hold', 'release'])
    // The default 1000ms press is clamped by the 50ms timeout, not ignored.
    expect(noteOf(result)).toContain('released on paused 50ms')
  })

  it('releases as soon as the condition is satisfied', async () => {
    const { session } = mockHoldSession({ evaluate: () => true })

    const result = await executeTool(
      act,
      {
        page: 1,
        kind: 'hold',
        ref: 'e5',
        until: { kind: 'selector', value: '#confirmed' },
        holdTimeout: 2_000,
      },
      { session },
    )

    expect(result.isError).toBeFalsy()
    expect(noteOf(result)).toContain('released on')
    expect(result.structuredContent).toMatchObject({
      held: true,
      matched: true,
    })
  })

  it('still releases, and says so, when the condition never matches', async () => {
    const { session, calls } = mockHoldSession({ evaluate: () => false })

    const result = await executeTool(
      act,
      {
        page: 1,
        kind: 'hold',
        ref: 'e5',
        until: { kind: 'selector', value: '#never' },
        holdTimeout: 60,
      },
      { session },
    )

    expect(result.isError).toBeFalsy()
    expect(calls.map((c) => c.kind)).toEqual(['hold', 'release'])
    expect(noteOf(result)).toContain('never matched')
    expect(result.structuredContent).toMatchObject({
      held: true,
      matched: false,
    })
  })

  it('rejects an invalid condition without pressing the button', async () => {
    const { session, calls } = mockHoldSession()

    const result = await executeTool(
      act,
      {
        page: 1,
        kind: 'hold',
        ref: 'e5',
        until: { kind: 'selector' },
        holdTimeout: 60,
      },
      { session },
    )

    expect(result.isError).toBe(true)
    expect(calls).toEqual([])
  })

  it('requires a ref', async () => {
    const { session } = mockHoldSession()

    const result = await executeTool(
      act,
      { page: 1, kind: 'hold' },
      { session },
    )

    expect(result.isError).toBe(true)
    expect(noteOf(result)).toContain('ref is required')
  })

  it('holds at coordinates when there is no ref', async () => {
    const { session, calls } = mockHoldSession()

    const result = await executeTool(
      act,
      {
        page: 1,
        kind: 'hold_at',
        x: 120,
        y: 45,
        until: { kind: 'time', ms: 10 },
      },
      { session },
    )

    expect(result.isError).toBeFalsy()
    expect(calls[0]).toMatchObject({ kind: 'holdAt' })
    expect(calls[0]?.args.slice(0, 2)).toEqual([120, 45])
    expect(calls[1]?.kind).toBe('release')
  })
})

describe('act recover', () => {
  it('retries a click that lost its element and reports the recovery', async () => {
    const { session, calls, strategies } = mockHoldSession({
      clickFailures: 1,
    })

    const result = await executeTool(
      act,
      {
        page: 1,
        kind: 'click',
        ref: 'e5',
        recover: { attempts: 2, strategy: ['resnapshot'] },
      },
      { session },
    )

    expect(result.isError).toBeFalsy()
    expect(strategies).toEqual(['resnapshot'])
    expect(calls.filter((c) => c.kind === 'click')).toHaveLength(1)
    expect(result.structuredContent).toMatchObject({
      recovered: true,
      attempts: 2,
    })
  })

  it('gives up with the stale-ref message once attempts run out', async () => {
    const { session } = mockHoldSession({ clickFailures: 5 })

    const result = await executeTool(
      act,
      {
        page: 1,
        kind: 'click',
        ref: 'e5',
        recover: { attempts: 1, strategy: ['settle'] },
      },
      { session },
    )

    expect(result.isError).toBe(true)
    expect(noteOf(result)).toContain('stale reference')
  })

  it('does not retry errors that prove the click reached the page', async () => {
    const { session } = mockHoldSession({
      clickFailures: 1,
      clickError: 'navigation blocked by the page',
    })

    const result = await executeTool(
      act,
      {
        page: 1,
        kind: 'click',
        ref: 'e5',
        recover: { attempts: 2, strategy: ['resnapshot'] },
      },
      { session },
    )

    expect(result.isError).toBe(true)
    expect(noteOf(result)).toContain('navigation blocked by the page')
  })

  it('refuses to recover kinds whose partial effect may already have landed', async () => {
    const { session, calls } = mockHoldSession()

    const result = await executeTool(
      act,
      {
        page: 1,
        kind: 'type',
        text: 'hello',
        recover: { attempts: 1, strategy: ['resnapshot'] },
      },
      { session },
    )

    expect(result.isError).toBe(true)
    expect(noteOf(result)).toContain('recover is not supported')
    expect(calls).toEqual([])
  })
})
