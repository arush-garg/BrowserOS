import { describe, expect, test } from 'bun:test'
import { EventLog } from './event-log'
import { createPlannerSession } from './session'

describe('AgentPlannerSession', () => {
  test('plan transitions are recorded as plan events, in order', () => {
    const session = createPlannerSession('Book a flight', ['Search'], {
      planningMode: true,
    })
    expect(session.isSideEffectAllowed()).toBe(false)
    session.approvePlan()
    session.startSubtask('subtask-1')
    session.completeSubtask('subtask-1')
    session.verifySubtask('subtask-1')
    const kinds = session.eventLog.ofKind('plan').map((e) => e.detail.type)
    expect(kinds).toEqual(['created', 'approved', 'started', 'completed', 'verified'])
    expect(session.isSideEffectAllowed()).toBe(true)
  })

  test('requestFinish records a decision event and refuses an unverified plan', () => {
    const session = createPlannerSession('Book a flight', ['Search'])
    const refused = session.requestFinish({}, { pageText: 'done' })
    expect(refused.passed).toBe(false)
    session.startSubtask('subtask-1')
    session.completeSubtask('subtask-1')
    session.verifySubtask('subtask-1')
    const accepted = session.requestFinish({}, { pageText: 'done' })
    expect(accepted.passed).toBe(true)
    const decisions = session.eventLog.ofKind('decision')
    expect(decisions).toHaveLength(2)
    expect(decisions[0].detail.passed).toBe(false)
    expect(decisions[1].detail.passed).toBe(true)
  })

  test('session JSONL round-trips through EventLog', () => {
    const session = createPlannerSession('Book a flight', ['Search'])
    session.recordAction({ tool: 'navigate', url: 'https://example.com' })
    session.recordObservation({ url: 'https://example.com' })
    session.recordError({ message: 'timeout' })
    const rebuilt = EventLog.fromJSONL(session.toJSONL())
    expect(rebuilt.replay()).toEqual(session.eventLog.replay())
    expect(rebuilt.length).toBe(4) // created + action + observation + error
  })
})
