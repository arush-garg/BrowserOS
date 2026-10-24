import { describe, expect, test } from 'bun:test'
import { EventLog } from './event-log'

describe('EventLog', () => {
  test('append assigns contiguous sequence numbers and kinds', () => {
    const log = new EventLog()
    const a = log.append('action', { tool: 'click', ref: 'e12' })
    const b = log.append('observation', { url: 'https://example.com' })
    const c = log.append('error', { message: 'timeout' })
    expect(a.seq).toBe(1)
    expect(b.seq).toBe(2)
    expect(c.seq).toBe(3)
    expect(log.length).toBe(3)
    expect(log.ofKind('error')).toHaveLength(1)
  })

  test('appended events are immutable via the returned copy', () => {
    const log = new EventLog()
    const detail = { tool: 'click' }
    const event = log.append('action', detail)
    detail.tool = 'mutated'
    expect(log.replay()[0].detail.tool).toBe('click')
    expect(() => {
      ;(event as { seq: number }).seq = 99
    }).toThrow()
  })

  test('JSONL round-trip rebuilds the same log', () => {
    const log = new EventLog()
    log.append('decision', { choice: 'CLICK:e1' }, { timestamp: '2026-01-01T00:00:00.000Z' })
    log.append('plan', { type: 'verified', subtaskId: 'subtask-1' }, { timestamp: '2026-01-01T00:00:01.000Z' })
    const rebuilt = EventLog.fromJSONL(log.toJSONL())
    expect(rebuilt.replay()).toEqual(log.replay())
    expect(rebuilt.toJSONL()).toBe(log.toJSONL())
  })

  test('empty log serializes to empty string and back', () => {
    const log = new EventLog()
    expect(log.toJSONL()).toBe('')
    expect(EventLog.fromJSONL('').length).toBe(0)
  })

  test('replay rejects sequence gaps, unknown kinds, and malformed lines', () => {
    const gap = JSON.stringify({ seq: 2, timestamp: 't', kind: 'action', detail: {} })
    expect(() => EventLog.fromJSONL(gap)).toThrow('sequence gap')
    const badKind = JSON.stringify({ seq: 1, timestamp: 't', kind: 'nope', detail: {} })
    expect(() => EventLog.fromJSONL(badKind)).toThrow('Unknown agent event kind')
    expect(() => EventLog.fromJSONL('{not json')).toThrow('Invalid JSONL')
    expect(() => new EventLog().append('nope' as never, {})).toThrow('Unknown agent event kind')
  })
})
