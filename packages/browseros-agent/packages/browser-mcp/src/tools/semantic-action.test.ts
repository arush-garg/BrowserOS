import { describe, expect, it } from 'bun:test'
import { RefMap } from '@browseros/browser-core/core/snapshot/refs'
import type { LayaAnswer } from './laya-client'
import {
  buildLayaRequest,
  candidatesFromSnapshot,
  decide,
} from './semantic-action'

function candidateSnapshot() {
  const refs = new RefMap()
  const button = refs.mint({ backendNodeId: 1, role: 'button', name: 'Search' })
  const textbox = refs.mint({
    backendNodeId: 2,
    role: 'textbox',
    name: 'Where to?',
  })
  const secondTextbox = refs.mint({
    backendNodeId: 3,
    role: 'searchbox',
    name: 'Where from?',
  })
  return {
    refs,
    button,
    textbox,
    secondTextbox,
    text: [
      `- button "Search" [ref=${button}]`,
      `- textbox "Where to?" [ref=${textbox}]`,
      `- searchbox "Where from?" [ref=${secondTextbox}]`,
    ].join('\n'),
  }
}

describe('semantic action Laya request construction', () => {
  it('derives typed candidates from current snapshot refs', () => {
    const snapshot = candidateSnapshot()
    const candidates = candidatesFromSnapshot(
      snapshot.text,
      snapshot.refs.byRef,
    )
    expect(candidates).toEqual([
      {
        ref: snapshot.button,
        role: 'button',
        name: 'Search',
        description: `button "Search" — - button "Search" [ref=${snapshot.button}]`,
      },
      {
        ref: snapshot.textbox,
        role: 'textbox',
        name: 'Where to?',
        description: `textbox "Where to?" — - textbox "Where to?" [ref=${snapshot.textbox}]`,
      },
      {
        ref: snapshot.secondTextbox,
        role: 'searchbox',
        name: 'Where from?',
        description: `searchbox "Where from?" — - searchbox "Where from?" [ref=${snapshot.secondTextbox}]`,
      },
    ])
  })

  it('builds shared compact state and Laya choice questions', () => {
    const snapshot = candidateSnapshot()
    const request = buildLayaRequest(
      'Search flights from SFO to LHR',
      'https://example.com/flights?injected=true#fragment',
      snapshot.text,
      candidatesFromSnapshot(snapshot.text, snapshot.refs.byRef),
      [],
    )

    expect(Object.keys(request.questions)).toEqual([
      'operation',
      'click_target',
      'type_text_target',
    ])
    expect(Object.keys(request.questions.operation?.criteria)).toEqual([
      'CLICK',
      'TYPE_TEXT',
      'SCROLL_UP',
      'SCROLL_DOWN',
      'WAIT',
      'DONE',
      'BLOCKED',
    ])
    expect(Object.keys(request.questions.click_target?.criteria)).toEqual([
      snapshot.button,
    ])
    expect(Object.keys(request.questions.type_text_target?.criteria)).toEqual([
      snapshot.textbox,
      snapshot.secondTextbox,
    ])
    expect(request.state).toMatchObject({
      page: { url: 'https://example.com/flights' },
      recent_actions: [],
    })
    expect(JSON.stringify(request.questions.operation?.instructions)).toContain(
      'Search flights from SFO to LHR',
    )
  })

  it('offers cursor-pointer generic elements as click targets', () => {
    const refs = new RefMap()
    const customButton = refs.mint({
      backendNodeId: 1,
      role: 'generic',
      name: 'Custom action',
    })
    const text = `- generic "Custom action" [ref=${customButton}] [cursor=pointer]`
    const request = buildLayaRequest(
      'Click custom action',
      'https://example.com',
      text,
      candidatesFromSnapshot(text, refs.byRef),
      [],
    )
    expect(Object.keys(request.questions.click_target?.criteria ?? {})).toEqual(
      [customButton],
    )
  })

  it('offers editable comboboxes as both text and select targets', () => {
    const refs = new RefMap()
    const combo = refs.mint({
      backendNodeId: 1,
      role: 'combobox',
      name: 'Destination',
    })
    const text = `- combobox "Destination" [ref=${combo}]`
    const request = buildLayaRequest(
      'Type destination',
      'https://example.com',
      text,
      candidatesFromSnapshot(text, refs.byRef),
      [],
    )
    expect(
      Object.keys(request.questions.type_text_target?.criteria ?? {}),
    ).toEqual([combo])
    expect(
      Object.keys(request.questions.select_target?.criteria ?? {}),
    ).toEqual([combo])
  })

  it('caps target choices at 64 while prioritizing goal-relevant candidates', () => {
    const candidates = Array.from({ length: 70 }, (_, index) => ({
      ref: `e${index + 1}`,
      role: 'button',
      name: index === 69 ? 'Needle destination' : `Other ${index}`,
      description:
        index === 69
          ? 'button "Needle destination"'
          : `button "Other ${index}"`,
    }))
    const request = buildLayaRequest(
      'click needle destination',
      'https://example.com',
      '- button',
      candidates,
      [],
    )
    const refs = Object.keys(request.questions.click_target?.criteria)
    expect(refs).toHaveLength(64)
    expect(refs[0]).toBe('e70')
  })

  it('budgets page text for the browser checkpoint context', () => {
    const request = buildLayaRequest(
      'Search flights from SFO to LHR',
      'https://example.com/flights',
      'z'.repeat(20_000),
      candidatesFromSnapshot(
        candidateSnapshot().text,
        candidateSnapshot().refs.byRef,
      ),
      [],
    )
    expect(request.state.page.text).toHaveLength(1_500)
    expect(request.state.page.text.endsWith('…')).toBe(true)
  })
})

describe('semantic action Laya answer validation', () => {
  const request = {
    state: {
      page: { url: 'https://example.com', text: 'test' },
      recent_actions: [],
    },
    questions: {
      operation: {
        type: 'choice' as const,
        instructions: { goal: 'click second' },
        criteria: { CLICK: 'click', DONE: 'done' },
      },
      click_target: {
        type: 'choice' as const,
        instructions: { goal: 'click second', operation: 'CLICK' },
        criteria: { e1: 'first', e2: 'second' },
      },
    },
  }

  it('uses selected target and multiplies operation and target confidence', () => {
    const answers: Record<string, LayaAnswer> = {
      operation: {
        type: 'choice',
        choice: 'CLICK',
        probabilities: { CLICK: 0.8, DONE: 0.2 },
      },
      click_target: {
        type: 'choice',
        choice: 'e2',
        probabilities: { e1: 0.25, e2: 0.75 },
      },
    }
    const decision = decide(request.questions, answers)
    expect(decision).toMatchObject({
      status: 'ready',
      operation: 'CLICK',
      targetRef: 'e2',
      operationConfidence: 0.8,
      targetConfidence: 0.75,
    })
    expect(decision.effectiveConfidence).toBeCloseTo(0.6)
  })

  it('abstains when joint confidence is low', () => {
    const answers: Record<string, LayaAnswer> = {
      operation: {
        type: 'choice',
        choice: 'CLICK',
        probabilities: { CLICK: 0.6, DONE: 0.4 },
      },
      click_target: {
        type: 'choice',
        choice: 'e1',
        probabilities: { e1: 0.5, e2: 0.5 },
      },
    }
    expect(decide(request.questions, answers).status).toBe('uncertain')
  })

  it('treats low-confidence BLOCKED as uncertain', () => {
    const questions = {
      operation: {
        type: 'choice' as const,
        instructions: { goal: 'continue' },
        criteria: { BLOCKED: 'blocked', WAIT: 'wait', DONE: 'done' },
      },
    }
    const answers: Record<string, LayaAnswer> = {
      operation: {
        type: 'choice',
        choice: 'BLOCKED',
        probabilities: { BLOCKED: 0.36, WAIT: 0.34, DONE: 0.3 },
      },
    }
    expect(decide(questions, answers).status).toBe('uncertain')
  })

  it('requires stronger confidence before accepting DONE', () => {
    const questions = { operation: request.questions.operation }
    const answers: Record<string, LayaAnswer> = {
      operation: {
        type: 'choice',
        choice: 'DONE',
        probabilities: { CLICK: 0.4, DONE: 0.6 },
      },
    }
    expect(decide(questions, answers).status).toBe('uncertain_done')
  })

  it('rejects a choice that is absent from its probability map', () => {
    const answers: Record<string, LayaAnswer> = {
      operation: {
        type: 'choice',
        choice: 'CLICK',
        probabilities: { CLICK: 0.8, DONE: 0.2 },
      },
      click_target: {
        type: 'choice',
        choice: 'e3',
        probabilities: { e1: 0.5, e2: 0.5 },
      },
    }
    expect(() => decide(request.questions, answers)).toThrow('invalid choice')
  })

  it('rejects malformed probability maps', () => {
    const answers: Record<string, LayaAnswer> = {
      operation: {
        type: 'choice',
        choice: 'CLICK',
        probabilities: { CLICK: 0.9, DONE: 0.9 },
      },
      click_target: {
        type: 'choice',
        choice: 'e1',
        probabilities: { e1: 0.5, e2: 0.5 },
      },
    }
    expect(() => decide(request.questions, answers)).toThrow(
      'do not sum to one',
    )
  })
})
