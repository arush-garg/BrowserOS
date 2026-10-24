import { describe, expect, it } from 'bun:test'
import { RefMap } from '@browseros/browser-core/core/snapshot/refs'
import type { OpenJevAnswer } from './openjev-client'
import {
  buildOpenJevRequest,
  candidatesFromSnapshot,
  decide,
  goalEvidence,
  hasActionCycle,
  semanticSignature,
} from './semantic-action'

function fixture() {
  const refs = new RefMap()
  const button = refs.mint({ backendNodeId: 1, role: 'button', name: 'Search' })
  const from = refs.mint({
    backendNodeId: 2,
    role: 'textbox',
    name: 'Where from?',
  })
  const to = refs.mint({ backendNodeId: 3, role: 'textbox', name: 'Where to?' })
  const text = `- button "Search" [ref=${button}]\n- textbox "Where from?" [ref=${from}]\n- textbox "Where to?" [ref=${to}]`
  return { refs, button, from, to, text }
}

function request() {
  const page = fixture()
  return buildOpenJevRequest(
    'Search flights from SFO to LHR',
    'https://example.com/flights?secret=1',
    page.text,
    candidatesFromSnapshot(page.text, page.refs.byRef),
    [],
  )
}
function answer(
  criteria: Record<string, string>,
  winner: string,
  scores?: Record<string, number>,
): OpenJevAnswer {
  return {
    type: 'choice',
    choice: winner,
    probabilities:
      scores ??
      Object.fromEntries(
        Object.keys(criteria).map((id) => [id, id === winner ? 1 : 0]),
      ),
  }
}
function answers(
  req: ReturnType<typeof request>,
  operation: string,
  target?: string,
): Record<string, OpenJevAnswer> {
  return Object.fromEntries(
    Object.entries(req.questions).map(([key, question]) => [
      key,
      answer(
        question.criteria,
        key === 'operation'
          ? operation
          : ((key === `${operation.toLowerCase()}_target`
              ? target
              : undefined) ?? (Object.keys(question.criteria)[0] as string)),
      ),
    ]),
  )
}

describe('fan-out System One decision', () => {
  it('offers operation plus only compatible target heads, sanitizes URL, and never entangles choices', () => {
    const req = request()
    expect(Object.keys(req.questions)).toEqual([
      'operation',
      'click_target',
      'type_text_target',
    ])
    expect(Object.keys(req.questions.operation?.criteria ?? {})).toEqual([
      'CLICK',
      'TYPE_TEXT',
      'SELECT',
      'SCROLL_UP',
      'SCROLL_DOWN',
      'WAIT',
      'DONE',
      'BLOCKED',
    ])
    expect(Object.keys(req.questions.click_target?.criteria ?? {})).toEqual([
      fixture().button,
    ])
    expect(Object.keys(req.questions.type_text_target?.criteria ?? {})).toEqual(
      [fixture().from, fixture().to],
    )
    expect(req.state.page.url).toBe('https://example.com/flights')
  })
  it('uses only the target head matching the chosen operation', () => {
    const req = request()
    const result = decide(req, answers(req, 'TYPE_TEXT', 'e3'))
    expect(result).toMatchObject({
      operation: 'TYPE_TEXT',
      targetRef: 'e3',
      effectiveConfidence: 1,
    })
  })
  it('rejects bad probability sum, extra/missing keys, non-argmax, nonfinite, and invalid target heads', () => {
    const req = request()
    const badSum = answers(req, 'CLICK', 'e1')
    badSum.operation!.probabilities.CLICK = 0.6
    expect(() => decide(req, badSum)).toThrow('invalid probabilities')
    const extra = answers(req, 'CLICK', 'e1')
    extra.operation!.probabilities.OTHER = 0
    expect(() => decide(req, extra)).toThrow('wrong options')
    const notArgmax = answers(req, 'CLICK', 'e1')
    notArgmax.operation!.choice = 'DONE'
    expect(() => decide(req, notArgmax)).toThrow('invalid probabilities')
    const nan = answers(req, 'CLICK', 'e1')
    nan.operation!.probabilities.CLICK = Number.NaN
    expect(() => decide(req, nan)).toThrow('invalid')
    const missing = answers(req, 'CLICK', 'e1')
    delete missing.click_target
    expect(() => decide(req, missing)).toThrow('missing click_target')
  })
  it('separates operation and target confidence and holds low-confidence DONE', () => {
    const req = request()
    const predicted = answers(req, 'TYPE_TEXT', 'e2')
    predicted.type_text_target = answer(
      req.questions.type_text_target!.criteria,
      'e2',
      { e2: 0.55, e3: 0.45 },
    )
    expect(decide(req, predicted).effectiveConfidence).toBe(0.55)
    const done = answers(req, 'DONE')
    done.operation = answer(
      req.questions.operation!.criteria,
      'DONE',
      Object.fromEntries(
        Object.keys(req.questions.operation!.criteria).map((key) => [
          key,
          key === 'DONE' ? 0.6 : key === 'WAIT' ? 0.4 : 0,
        ]),
      ),
    )
    expect(decide(req, done).status).toBe('uncertain_done')
  })
  it('keeps goal-relevant targets in the first per-operation tranche and bounds it', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => ({
      ref: `e${i + 1}`,
      role: 'button',
      name: i === 99 ? 'Needle destination' : `Other ${i}`,
      description: i === 99 ? 'button Needle destination' : `button Other ${i}`,
    }))
    const req = buildOpenJevRequest(
      'click needle destination',
      'https://example.com',
      '',
      candidates,
      [],
    )
    expect(
      Object.keys(req.questions.click_target!.criteria).length,
    ).toBeLessThanOrEqual(48)
    expect(Object.keys(req.questions.click_target!.criteria)[0]).toBe('e100')
  })
})

describe('semantic verification helpers', () => {
  it('normalizes whitespace but detects AX state and URL changes', () => {
    expect(semanticSignature('/a', 'a  b\n c')).toBe(
      semanticSignature('/a', 'a b c'),
    )
    expect(semanticSignature('/a', 'a b')).not.toBe(
      semanticSignature('/b', 'a b'),
    )
    expect(semanticSignature('/a', 'a b')).not.toBe(
      semanticSignature('/a', 'a c'),
    )
  })
  it('detects A→B→A when the state and action pair cycle', () => {
    expect(
      hasActionCycle([
        { action: 'CLICK:e1', before: 'a', after: 'b' },
        { action: 'CLICK:e2', before: 'b', after: 'a' },
        { action: 'CLICK:e1', before: 'a', after: 'b' },
      ]),
    ).toBe(true)
    expect(
      hasActionCycle([
        { action: 'CLICK:e1', before: 'a', after: 'b' },
        { action: 'CLICK:e2', before: 'b', after: 'c' },
        { action: 'CLICK:e1', before: 'c', after: 'd' },
      ]),
    ).toBe(false)
  })
  it('requires actual visible goal evidence for DONE', () => {
    expect(
      goalEvidence(
        'Open settings',
        'https://example.com/settings',
        '- heading Settings',
      ),
    ).toBe(true)
    expect(
      goalEvidence(
        'Open settings',
        'https://example.com/home',
        '- heading Home',
      ),
    ).toBe(false)
    expect(
      goalEvidence(
        'Finish the task',
        'https://example.com/home',
        '- heading Home',
      ),
    ).toBe(false)
  })
})
