import { describe, expect, it } from 'bun:test'
import { RefMap } from '@browseros/browser-core/core/snapshot/refs'
import type { OpenJevAnswer } from './openjev-client'
import {
  buildOpenJevRequest,
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
    const request = buildOpenJevRequest(
      'Search flights from SFO to LHR',
      'https://example.com/flights?injected=true#fragment',
      snapshot.text,
      candidatesFromSnapshot(snapshot.text, snapshot.refs.byRef),
      [],
    )

    expect(Object.keys(request.questions)).toEqual(['action'])
    expect(Object.keys(request.questions.action?.criteria)).toEqual([
      `CLICK:${snapshot.button}`,
      `TYPE_TEXT:${snapshot.textbox}`,
      `TYPE_TEXT:${snapshot.secondTextbox}`,
      'SCROLL_UP',
      'SCROLL_DOWN',
      'WAIT',
      'DONE',
      'BLOCKED',
    ])
    expect(request.actions).toEqual([
      expect.objectContaining({
        id: `CLICK:${snapshot.button}`,
        operation: 'CLICK',
        targetRef: snapshot.button,
      }),
      expect.objectContaining({
        id: `TYPE_TEXT:${snapshot.textbox}`,
        operation: 'TYPE_TEXT',
        targetRef: snapshot.textbox,
      }),
      expect.objectContaining({
        id: `TYPE_TEXT:${snapshot.secondTextbox}`,
        operation: 'TYPE_TEXT',
        targetRef: snapshot.secondTextbox,
      }),
      expect.objectContaining({ id: 'SCROLL_UP' }),
      expect.objectContaining({ id: 'SCROLL_DOWN' }),
      expect.objectContaining({ id: 'WAIT' }),
      expect.objectContaining({ id: 'DONE' }),
      expect.objectContaining({ id: 'BLOCKED' }),
    ])
    expect(request.state).toMatchObject({
      page: { url: 'https://example.com/flights' },
      recent_actions: [],
    })
    expect(JSON.stringify(request.questions.action?.instructions)).toContain(
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
    const request = buildOpenJevRequest(
      'Click custom action',
      'https://example.com',
      text,
      candidatesFromSnapshot(text, refs.byRef),
      [],
    )
    expect(Object.keys(request.questions.action?.criteria ?? {})).toContain(
      `CLICK:${customButton}`,
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
    const request = buildOpenJevRequest(
      'Type destination',
      'https://example.com',
      text,
      candidatesFromSnapshot(text, refs.byRef),
      [],
    )
    const actionIds = Object.keys(request.questions.action?.criteria ?? {})
    expect(actionIds).toContain(`TYPE_TEXT:${combo}`)
    expect(actionIds).toContain(`SELECT:${combo}`)
  })

  it('caps joint action choices at 64 while prioritizing goal-relevant targets', () => {
    const candidates = Array.from({ length: 70 }, (_, index) => ({
      ref: `e${index + 1}`,
      role: 'button',
      name: index === 69 ? 'Needle destination' : `Other ${index}`,
      description:
        index === 69
          ? 'button "Needle destination"'
          : `button "Other ${index}"`,
    }))
    const request = buildOpenJevRequest(
      'click needle destination',
      'https://example.com',
      '- button',
      candidates,
      [],
    )
    const actionIds = Object.keys(request.questions.action?.criteria ?? {})
    expect(actionIds).toHaveLength(64)
    expect(actionIds[0]).toBe('CLICK:e70')
  })

  it('budgets page text for the browser checkpoint context', () => {
    const request = buildOpenJevRequest(
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
      action: {
        type: 'choice' as const,
        instructions: { goal: 'click second' },
        criteria: {
          'CLICK:e1': 'click first',
          'CLICK:e2': 'click second',
          DONE: 'done',
        },
      },
    },
    actions: [
      {
        id: 'CLICK:e1',
        operation: 'CLICK' as const,
        targetRef: 'e1',
        description: 'click first',
      },
      {
        id: 'CLICK:e2',
        operation: 'CLICK' as const,
        targetRef: 'e2',
        description: 'click second',
      },
      { id: 'DONE', operation: 'DONE' as const, description: 'done' },
    ],
  }

  it('uses one joint action distribution without multiplying separate confidences', () => {
    const answers: Record<string, OpenJevAnswer> = {
      action: {
        type: 'choice',
        choice: 'CLICK:e2',
        probabilities: { 'CLICK:e1': 0.1, 'CLICK:e2': 0.7, DONE: 0.2 },
      },
    }
    const decision = decide(request, answers)
    expect(decision).toMatchObject({
      status: 'ready',
      operation: 'CLICK',
      targetRef: 'e2',
      operationConfidence: 0.7,
      effectiveConfidence: 0.7,
    })
  })

  it('abstains when joint action confidence is low', () => {
    const answers: Record<string, OpenJevAnswer> = {
      action: {
        type: 'choice',
        choice: 'CLICK:e1',
        probabilities: { 'CLICK:e1': 0.35, 'CLICK:e2': 0.35, DONE: 0.3 },
      },
    }
    expect(decide(request, answers).status).toBe('uncertain')
  })

  it('treats low-confidence BLOCKED as uncertain', () => {
    const blockedRequest = {
      ...request,
      questions: {
        action: {
          type: 'choice' as const,
          instructions: { goal: 'continue' },
          criteria: { BLOCKED: 'blocked', WAIT: 'wait', DONE: 'done' },
        },
      },
      actions: [
        {
          id: 'BLOCKED',
          operation: 'BLOCKED' as const,
          description: 'blocked',
        },
        { id: 'WAIT', operation: 'WAIT' as const, description: 'wait' },
        { id: 'DONE', operation: 'DONE' as const, description: 'done' },
      ],
    }
    const answers: Record<string, OpenJevAnswer> = {
      action: {
        type: 'choice',
        choice: 'BLOCKED',
        probabilities: { BLOCKED: 0.36, WAIT: 0.34, DONE: 0.3 },
      },
    }
    expect(decide(blockedRequest, answers).status).toBe('uncertain')
  })

  it('requires stronger confidence before accepting DONE', () => {
    const doneRequest = {
      ...request,
      questions: {
        action: {
          type: 'choice' as const,
          instructions: { goal: 'finish' },
          criteria: { 'CLICK:e1': 'click', DONE: 'done' },
        },
      },
      actions: [
        {
          id: 'CLICK:e1',
          operation: 'CLICK' as const,
          targetRef: 'e1',
          description: 'click',
        },
        { id: 'DONE', operation: 'DONE' as const, description: 'done' },
      ],
    }
    const answers: Record<string, OpenJevAnswer> = {
      action: {
        type: 'choice',
        choice: 'DONE',
        probabilities: { 'CLICK:e1': 0.4, DONE: 0.6 },
      },
    }
    expect(decide(doneRequest, answers).status).toBe('uncertain_done')
  })

  it('rejects a choice absent from the action distribution', () => {
    const answers: Record<string, OpenJevAnswer> = {
      action: {
        type: 'choice',
        choice: 'CLICK:e3',
        probabilities: { 'CLICK:e1': 0.5, 'CLICK:e2': 0.5, DONE: 0 },
      },
    }
    expect(() => decide(request, answers)).toThrow('invalid choice')
  })

  it('accepts independently calibrated action scores', () => {
    const answers: Record<string, OpenJevAnswer> = {
      action: {
        type: 'choice',
        choice: 'CLICK:e1',
        probabilities: { 'CLICK:e1': 0.98, 'CLICK:e2': 0.67, DONE: 0.55 },
      },
    }
    expect(decide(request, answers).effectiveConfidence).toBeCloseTo(0.98)
  })
})
