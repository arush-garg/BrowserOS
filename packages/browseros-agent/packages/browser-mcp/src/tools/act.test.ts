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
