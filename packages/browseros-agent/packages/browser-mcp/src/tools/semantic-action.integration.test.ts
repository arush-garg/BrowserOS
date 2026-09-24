import { afterEach, describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { RefMap } from '@browseros/browser-core/core/snapshot/refs'
import { executeTool } from './framework'
import type { LayaAnswer, LayaQuestions } from './laya-client'
import { setLayaClientForTests } from './laya-client'
import { semantic_action } from './semantic-action'

afterEach(() => setLayaClientForTests(undefined))

function oneHot(ids: string[], winner: string): Record<string, number> {
  const chosen = ids.includes(winner) ? winner : (ids[0] ?? winner)
  return Object.fromEntries(ids.map((id) => [id, id === chosen ? 1 : 0]))
}

type Choice = { operation: string; targetRef?: string }

function installClient(choices: Choice[]): void {
  let call = 0
  const client = {
    predict: async (_state: unknown, questions: LayaQuestions) => {
      const choice = choices[Math.min(call, choices.length - 1)]
      if (!choice) throw new Error('scripted Laya client needs a choice')
      call += 1
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, question]) => {
          const ids = Object.keys(question.criteria)
          const fallback = ids[0]
          if (!fallback) throw new Error(`question ${id} needs criteria`)
          const winner =
            id === 'operation'
              ? choice.operation
              : (choice.targetRef ?? fallback)
          const answer: LayaAnswer = {
            type: 'choice',
            choice: ids.includes(winner) ? winner : fallback,
            probabilities: oneHot(ids, winner),
          }
          return [id, answer]
        }),
      )
      return { answers, usage: { input_tokens: 10, output_tokens: 0 } }
    },
    close: () => {},
  }
  setLayaClientForTests(client as never)
}

interface MockPage {
  text: string
  url: string
  refs: RefMap
}

function twoButtons(): MockPage {
  const refs = new RefMap()
  const first = refs.mint({ backendNodeId: 1, role: 'button', name: 'First' })
  const second = refs.mint({ backendNodeId: 2, role: 'button', name: 'Second' })
  return {
    refs,
    url: 'https://example.com/path?secret=1#fragment',
    text: `- button "First" [ref=${first}]\n- button "Second" [ref=${second}]`,
  }
}

function oneTextbox(): MockPage {
  const refs = new RefMap()
  const box = refs.mint({ backendNodeId: 1, role: 'textbox', name: 'Query' })
  return {
    refs,
    url: 'https://example.com/search',
    text: `- textbox "Query" [ref=${box}]`,
  }
}

function oneSelect(): MockPage {
  const refs = new RefMap()
  const select = refs.mint({
    backendNodeId: 1,
    role: 'combobox',
    name: 'Country',
  })
  return {
    refs,
    url: 'https://example.com/form',
    text: `- combobox "Country" [ref=${select}]`,
  }
}

type Action = [string, ...string[]]

function mockSession(page: MockPage): {
  session: BrowserSession
  actions: Action[]
} {
  const actions: Action[] = []
  const input = {
    click: async (ref: string) => void actions.push(['click', ref]),
    focus: async (ref: string) => void actions.push(['focus', ref]),
    type: async (text: string) => void actions.push(['type', text]),
    selectOption: async (ref: string, value: string) => {
      actions.push(['select', ref, value])
      return value === 'missing' ? null : value
    },
    scroll: async (direction: string) =>
      void actions.push(['scroll', direction]),
  }
  const session = {
    pages: {
      getTabId: () => undefined,
      getSession: async () => ({
        session: {
          Runtime: {
            evaluate: async () => ({ result: { value: 'complete:2' } }),
          },
        },
      }),
    },
    input: () => input,
    observe: () => ({
      snapshot: async () => ({
        text: page.text,
        refs: page.refs,
        url: page.url,
      }),
    }),
  } as unknown as BrowserSession
  return { session, actions }
}

describe('semantic_action MCP handler with Laya', () => {
  it('advises a single decision without acting when execute is false', async () => {
    installClient([{ operation: 'CLICK', targetRef: 'e1' }])
    const { session, actions } = mockSession(twoButtons())
    const result = await executeTool(
      semantic_action,
      { page: 1, goal: 'Click First', execute: false },
      { session, signal: undefined },
    )
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      page: 1,
      url: 'https://example.com/path',
      status: 'ready',
      operation: 'CLICK',
      targetRef: 'e1',
    })
    expect(actions).toEqual([])
  })

  it('autonomously executes until DONE', async () => {
    installClient([
      { operation: 'CLICK', targetRef: 'e1' },
      { operation: 'DONE' },
    ])
    const { session, actions } = mockSession(twoButtons())
    const result = await executeTool(
      semantic_action,
      { page: 1, goal: 'Click First' },
      { session, signal: undefined },
    )
    expect(result.structuredContent).toMatchObject({ status: 'done' })
    expect(actions).toEqual([['click', 'e1']])
  })

  it('fills TYPE_TEXT only from caller-provided text', async () => {
    installClient([
      { operation: 'TYPE_TEXT', targetRef: 'e1' },
      { operation: 'DONE' },
    ])
    const { session, actions } = mockSession(oneTextbox())
    const result = await executeTool(
      semantic_action,
      { page: 1, goal: 'Search for Q-learning', text: 'q-learning algorithm' },
      { session, signal: undefined },
    )
    expect(result.structuredContent).toMatchObject({ status: 'done' })
    expect(actions).toEqual([
      ['focus', 'e1'],
      ['type', 'q-learning algorithm'],
    ])
  })

  it('pauses without mutating the page when TYPE_TEXT lacks text', async () => {
    installClient([{ operation: 'TYPE_TEXT', targetRef: 'e1' }])
    const { session, actions } = mockSession(oneTextbox())
    const result = await executeTool(
      semantic_action,
      { page: 1, goal: 'Search for Q-learning' },
      { session, signal: undefined },
    )
    expect(result.structuredContent).toMatchObject({ status: 'needs_text' })
    expect(actions).toEqual([])
  })

  it('rejects removed generateText input', async () => {
    installClient([{ operation: 'DONE' }])
    const { session } = mockSession(twoButtons())
    const result = await executeTool(
      semantic_action,
      { page: 1, goal: 'Done', generateText: true },
      { session, signal: undefined },
    )
    expect(result.isError).toBe(true)
  })

  it('reports SELECT failure when no matching option exists', async () => {
    installClient([{ operation: 'SELECT', targetRef: 'e1' }])
    const { session } = mockSession(oneSelect())
    const result = await executeTool(
      semantic_action,
      { page: 1, goal: 'Select missing country', text: 'missing' },
      { session, signal: undefined },
    )
    expect(result.structuredContent).toMatchObject({ status: 'error' })
  })

  it('holds on WAIT until the page settles and reports the hold', async () => {
    installClient([{ operation: 'WAIT' }, { operation: 'DONE' }])
    const { session, actions } = mockSession(twoButtons())
    const result = await executeTool(
      semantic_action,
      { page: 1, goal: 'Let the page finish loading' },
      { session, signal: undefined },
    )
    expect(result.structuredContent).toMatchObject({ status: 'done' })
    expect(actions).toEqual([])
    const [first] = (result.structuredContent as { steps: { note: string }[] })
      .steps
    expect(first?.note).toMatch(/^waited \d+ms \(settled\)$/)
  })

  it('stops repeating WAIT once a hold settled on an unchanged page', async () => {
    installClient([{ operation: 'WAIT' }])
    const { session } = mockSession(twoButtons())
    const result = await executeTool(
      semantic_action,
      { page: 1, goal: 'Wait forever', maxSteps: 8 },
      { session, signal: undefined },
    )
    expect(result.structuredContent).toMatchObject({ status: 'no_progress' })
    const steps = (result.structuredContent as { steps: unknown[] }).steps
    expect(steps).toHaveLength(2)
  })

  it('stops when a repeated action leaves the page unchanged', async () => {
    installClient([{ operation: 'CLICK', targetRef: 'e1' }])
    const { session, actions } = mockSession(twoButtons())
    const result = await executeTool(
      semantic_action,
      { page: 1, goal: 'Click First forever', maxSteps: 8 },
      { session, signal: undefined },
    )
    expect(result.structuredContent).toMatchObject({ status: 'no_progress' })
    expect(actions).toEqual([['click', 'e1']])
    const steps = (result.structuredContent as { steps: unknown[] }).steps
    expect(steps).toHaveLength(2)
  })
})
