import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { RefMap } from '@browseros/browser-core/core/snapshot/refs'
import { executeTool } from './framework'
import type {
  OpenJevPredictOptions,
  OpenJevQuestions,
  OpenJevResponse,
} from './openjev-client'
import { setOpenJevClientForTests } from './openjev-client'
import { semantic_action } from './semantic-action'

afterEach(() => {
  setOpenJevClientForTests(undefined)
  mock.restore()
})

type Choice = { operation: string; targetRef?: string }
function installClient(
  choices: Choice[],
  override?: (
    question: string,
    probabilities: Record<string, number>,
  ) => Record<string, number>,
) {
  let call = 0
  const options: OpenJevPredictOptions[] = []
  const client = {
    predict: async (
      _state: unknown,
      questions: OpenJevQuestions,
      opts: OpenJevPredictOptions = {},
    ): Promise<OpenJevResponse> => {
      options.push(opts)
      const choice = choices[Math.min(call++, choices.length - 1)]!
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, q]) => {
          const keys = Object.keys(q.criteria)
          const winner =
            id === 'operation'
              ? choice.operation
              : id === `${choice.operation.toLowerCase()}_target`
                ? choice.targetRef
                : keys[0]
          const probabilities = Object.fromEntries(
            keys.map((k) => [k, k === winner ? 1 : 0]),
          )
          return [
            id,
            {
              type: 'choice' as const,
              choice: winner ?? keys[0],
              probabilities: override?.(id, probabilities) ?? probabilities,
            },
          ]
        }),
      )
      return {
        answers,
        backend: opts.image ? 'cloudflare' : 'local',
        model: 'test-model',
        image: opts.image ? { used: true } : undefined,
      }
    },
    close: () => {},
  }
  setOpenJevClientForTests(client)
  return options
}

function browser(
  kind: 'button' | 'textbox' = 'button',
  opts: {
    stale?: boolean
    noChange?: boolean
    wrongValue?: boolean
    doneEvidence?: boolean
    screenshotFails?: boolean
  } = {},
) {
  const refs = new RefMap()
  refs.mint({
    backendNodeId: 1,
    role: kind,
    name: kind === 'button' ? 'Settings' : 'Search',
  })
  const actions: string[] = []
  let text =
    kind === 'button'
      ? '- button "Settings" [ref=e1]'
      : '- textbox "Search" [ref=e1]'
  let value = ''
  let snapshots = 0
  let fillAttempts = 0
  const cdp = {
    DOM: { resolveNode: async () => ({ object: { objectId: 'field-1' } }) },
    Runtime: {
      callFunctionOn: async () => ({ result: { value } }),
      evaluate: async () => ({ result: { value: true } }),
    },
    Page: {
      getLayoutMetrics: async () => ({
        cssLayoutViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: 800,
          clientHeight: 600,
        },
      }),
    },
  }
  const input = {
    click: async (ref: string) => {
      actions.push(`click:${ref}`)
      if (!opts.noChange)
        text = '- heading "Settings"\n- button "Settings" [ref=e1]'
    },
    focus: async (ref: string) => {
      actions.push(`focus:${ref}`)
    },
    press: async (key: string) => {
      actions.push(`press:${key}`)
    },
    type: async (val: string) => {
      actions.push(`type:${val}`)
      value = opts.wrongValue ? 'wrong' : val
      text += `\n- text "${value}"`
    },
    fill: async (ref: string, val: string) => {
      actions.push(`fill:${ref}:${val}`)
      fillAttempts++
      value = opts.wrongValue && fillAttempts > 1 ? 'wrong' : val
      text += `\n- text "${value}"`
    },
    selectOption: async (_ref: string, val: string) => val,
    scroll: async () => {
      actions.push('scroll')
    },
  }
  const session = {
    input: () => input,
    observe: () => ({
      snapshot: async () => {
        snapshots++
        if (opts.stale && snapshots === 2) text += '\n- heading "Changed"'
        return {
          text: opts.doneEvidence ? '- heading "Settings"' : text,
          url: 'https://example.com/home',
          refs,
        }
      },
      resolveRef: async () => ({ session: cdp, backendNodeId: 1 }),
    }),
    pages: {
      getTabId: () => undefined,
      getSession: async () => ({ session: cdp }),
    },
    screenshot: async () => {
      if (opts.screenshotFails) throw new Error('capture failed')
      return { data: 'c2NyZWVu', mimeType: 'image/jpeg', annotations: [] }
    },
  } as unknown as BrowserSession
  return {
    session,
    actions,
    cdp,
    get snapshots() {
      return snapshots
    },
  }
}
const run = (session: BrowserSession, args: Record<string, unknown>) =>
  executeTool(
    semantic_action,
    { page: 1, ...args },
    { session, signal: undefined },
  )

describe('semantic_action execution guards', () => {
  it('advises once and reports the actual backend without acting', async () => {
    installClient([{ operation: 'CLICK', targetRef: 'e1' }])
    const { session, actions } = browser()
    const result = await run(session, { goal: 'Open Settings', execute: false })
    expect(result.structuredContent).toMatchObject({
      status: 'ready',
      operation: 'CLICK',
      targetRef: 'e1',
      backend: 'local',
      model: 'test-model',
    })
    expect(actions).toEqual([])
  })
  it('does not act for an invalid distribution (wrong sum or non-argmax)', async () => {
    for (const corruption of [
      (id: string, p: Record<string, number>) =>
        id === 'operation' ? { ...p, CLICK: 0.5 } : p,
      (id: string, p: Record<string, number>) =>
        id === 'operation' ? { ...p, CLICK: 0, DONE: 1 } : p,
    ]) {
      installClient([{ operation: 'CLICK', targetRef: 'e1' }], corruption)
      const { session, actions } = browser()
      const result = await run(session, { goal: 'Open Settings' })
      expect(result.isError).toBe(true)
      expect(actions).toEqual([])
    }
  })
  it('re-snapshots a stale decision without clicking', async () => {
    installClient([
      { operation: 'CLICK', targetRef: 'e1' },
      { operation: 'BLOCKED' },
    ])
    const { session, actions } = browser('button', { stale: true })
    const result = await run(session, { goal: 'Open Settings', maxSteps: 2 })
    expect(actions).toEqual([])
    expect(result.structuredContent).toMatchObject({ status: 'blocked' })
    expect(
      (result.structuredContent as { steps: { note: string }[] }).steps[0]
        ?.note,
    ).toContain('stale decision')
  })
  it('reports click without a semantic change as failure unless explicitly allowed', async () => {
    installClient([{ operation: 'CLICK', targetRef: 'e1' }])
    const { session, actions } = browser('button', { noChange: true })
    const result = await run(session, { goal: 'Open Settings', maxSteps: 1 })
    expect(result.structuredContent).toMatchObject({
      status: 'error',
      backend: 'local',
    })
    expect(actions).toEqual(['click:e1'])
    const allowed = browser('button', { noChange: true })
    const resultAllowed = await run(allowed.session, {
      goal: 'Open Settings',
      noChangeExpected: true,
      maxSteps: 1,
    })
    expect(resultAllowed.structuredContent).toMatchObject({
      status: 'max_steps',
    })
  })
  it('uses macOS select-all and retries a field read-back mismatch with fill', async () => {
    installClient([{ operation: 'TYPE_TEXT', targetRef: 'e1' }])
    const { session, actions } = browser('textbox', { wrongValue: true })
    const result = await run(session, {
      goal: 'Search for flights',
      text: 'flights',
      maxSteps: 1,
    })
    expect(result.structuredContent).toMatchObject({ status: 'max_steps' })
    expect(actions).toEqual([
      'focus:e1',
      'press:Meta+a',
      'type:flights',
      'fill:e1:flights',
    ])
  })
  it('fails if the read-back still mismatches after one fill retry', async () => {
    installClient([{ operation: 'TYPE_TEXT', targetRef: 'e1' }])
    const { session, actions, cdp } = browser('textbox', { wrongValue: true })
    cdp.Runtime.callFunctionOn = async () => ({ result: { value: 'wrong' } })
    const result = await run(session, {
      goal: 'Search for flights',
      text: 'flights',
      maxSteps: 1,
    })
    expect(result.structuredContent).toMatchObject({ status: 'error' })
    expect(actions.filter((a) => a.startsWith('fill:'))).toHaveLength(1)
  })
  it('generates a field-specific value through the router without loading local weights', async () => {
    installClient([{ operation: 'TYPE_TEXT', targetRef: 'e1' }])
    const calls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push(String(init?.body))
      expect(String(url)).toBe('http://127.0.0.1:11435/v1/text-helper')
      return Response.json({ text: 'flights' })
    }) as typeof fetch
    try {
      const { session, actions } = browser('textbox')
      const result = await run(session, {
        goal: 'Search for flights',
        maxSteps: 1,
      })
      expect(result.structuredContent).toMatchObject({ status: 'max_steps' })
      expect(actions).toContain('type:flights')
      expect(JSON.parse(calls[0] ?? '{}')).toMatchObject({
        field: { label: 'Search', role: 'textbox' },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
  it('does not accept DONE without refreshed goal evidence', async () => {
    installClient([{ operation: 'DONE' }])
    const blank = browser()
    const rejected = await run(blank.session, { goal: 'Open Account Settings' })
    expect(rejected.structuredContent).toMatchObject({
      status: 'assertion_failed',
    })
    const accepted = browser('button', { doneEvidence: true })
    const done = await run(accepted.session, { goal: 'Open Settings' })
    expect(done.structuredContent).toMatchObject({
      status: 'done',
      backend: 'local',
    })
  })
  it('blocks after three consecutive non-WAIT actions with no semantic change', async () => {
    installClient([
      { operation: 'SCROLL_DOWN' },
      { operation: 'SCROLL_UP' },
      { operation: 'SCROLL_DOWN' },
    ])
    const { session, actions } = browser()
    const result = await run(session, { goal: 'Find Settings', maxSteps: 3 })
    expect(result.structuredContent).toMatchObject({ status: 'blocked' })
    expect(actions).toEqual(['scroll', 'scroll', 'scroll'])
  })
  it('does not act when vision fallback cannot use the screenshot', async () => {
    installClient([{ operation: 'SCROLL_DOWN' }], (id, p) =>
      id === 'operation'
        ? {
            ...Object.fromEntries(
              Object.keys(p).map((key) => [
                key,
                key === 'SCROLL_DOWN'
                  ? 0.35
                  : key === 'WAIT'
                    ? 0.3
                    : key === 'BLOCKED'
                      ? 0.2
                      : key === 'DONE'
                        ? 0.15
                        : 0,
              ]),
            ),
          }
        : p,
    )
    const { session, actions } = browser('button', { screenshotFails: true })
    const result = await run(session, { goal: 'Find Settings', maxSteps: 1 })
    expect(result.structuredContent).toMatchObject({
      status: 'uncertain',
      screenshot: { used: false },
    })
    expect(actions).toEqual([])
  })
})
