import { describe, expect, it } from 'bun:test'
import { TaskTrace } from './task-trace'

describe('unified task trace', () => {
  it('assembles llm turns, decisions, diffs, screenshots, and errors in order', () => {
    const trace = new TaskTrace('task-1')
    trace.llmTurn('plan: search for Widget A')
    trace.toolDecision('clicked [e12] Search', 0.87, { action: 'CLICK', ref: 'e12' })
    trace.axDiff('search results appeared', { added: 3 })
    trace.screenshot('results page', { width: 1024, height: 768, format: 'jpeg', used: true })
    trace.cdpError('snapshot timed out', 'CDP timeout after 15000ms')
    const timeline = trace.timeline()
    expect(timeline.map((e) => e.kind)).toEqual([
      'llm-turn',
      'tool-decision',
      'ax-diff',
      'screenshot',
      'cdp-error',
    ])
    expect(timeline.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
    expect(trace.lastError()?.summary).toBe('snapshot timed out')
  })

  it('round-trips through JSONL without losing order or confidences', () => {
    const trace = new TaskTrace('task-2')
    trace.toolDecision('clicked [e3] Buy', 0.65)
    trace.llmTurn('verify confirmation page')
    const restored = TaskTrace.fromJSONL('task-2', trace.toJSONL())
    expect(restored.timeline().length).toBe(2)
    expect(restored.timeline()[0].confidence).toBe(0.65)
    expect(restored.render()).toContain('confidence 0.65')
  })

  it('redacts credential-like fields and never stores screenshot bytes', () => {
    const trace = new TaskTrace('task-3')
    const event = trace.llmTurn('login attempt', {
      password: 'hunter2',
      api_key: 'sk-live-123',
      username: 'ada',
    })
    const detail = event.detail as Record<string, unknown>
    expect(detail.password).toBe('[redacted]')
    expect(detail.api_key).toBe('[redacted]')
    expect(detail.username).toBe('ada')
    const shot = trace.screenshot('login page', { width: 800, height: 600 })
    expect(JSON.stringify(shot.detail)).not.toContain('base64')
  })
})
