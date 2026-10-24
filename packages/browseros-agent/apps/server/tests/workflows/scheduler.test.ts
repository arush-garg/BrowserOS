import { describe, expect, test } from 'bun:test'
import {
  InMemoryWorkflowRunStore,
  decideRunOutcome,
  isDurableBlock,
  nextRunAfter,
  triggerMatches,
} from '../../src/workflows/scheduler'
import type { WorkflowSchedule } from '../../src/workflows/types'

describe('nextRunAfter', () => {
  test('hourly advances exactly one hour', () => {
    const s: WorkflowSchedule = { id: 's', workflowId: 'w', kind: 'hourly', enabled: true }
    expect(nextRunAfter(s, new Date('2026-10-24T10:15:00Z')).toISOString()).toBe(
      '2026-10-24T11:15:00.000Z',
    )
  })

  test('daily picks the next occurrence at the configured time', () => {
    const s: WorkflowSchedule = {
      id: 's',
      workflowId: 'w',
      kind: 'daily',
      hour: 8,
      minute: 0,
      enabled: true,
    }
    // After 08:00 today -> tomorrow 08:00.
    expect(nextRunAfter(s, new Date('2026-10-24T10:00:00Z')).toISOString()).toBe(
      '2026-10-25T08:00:00.000Z',
    )
    // Before 08:00 today -> today 08:00.
    expect(nextRunAfter(s, new Date('2026-10-24T07:00:00Z')).toISOString()).toBe(
      '2026-10-24T08:00:00.000Z',
    )
  })

  test('weekly picks the next matching weekday', () => {
    // 2026-10-24 is a Saturday.
    const s: WorkflowSchedule = {
      id: 's',
      workflowId: 'w',
      kind: 'weekly',
      weekday: 1,
      hour: 8,
      minute: 0,
      enabled: true,
    }
    expect(nextRunAfter(s, new Date('2026-10-24T10:00:00Z')).toISOString()).toBe(
      '2026-10-26T08:00:00.000Z',
    )
  })

  test('custom requires a positive interval', () => {
    const s: WorkflowSchedule = { id: 's', workflowId: 'w', kind: 'custom', enabled: true }
    expect(() => nextRunAfter(s, new Date())).toThrow('intervalMinutes')
    const ok: WorkflowSchedule = { ...s, intervalMinutes: 30 }
    expect(
      nextRunAfter(ok, new Date('2026-10-24T10:00:00Z')).toISOString(),
    ).toBe('2026-10-24T10:30:00.000Z')
  })
})

describe('triggers and durable blocks', () => {
  test('trigger matches on type, and on source when both set', () => {
    expect(
      triggerMatches({ type: 'sheet-row', source: 'leads' }, { type: 'sheet-row', source: 'leads' }),
    ).toBe(true)
    expect(
      triggerMatches({ type: 'sheet-row', source: 'leads' }, { type: 'sheet-row', source: 'other' }),
    ).toBe(false)
    expect(triggerMatches({ type: 'email' }, { type: 'sheet-row' })).toBe(false)
  })

  test('login / captcha / connector blocks are durable', () => {
    expect(isDurableBlock('Login required to continue')).toBe(true)
    expect(isDurableBlock('bot-check encountered')).toBe(true)
    expect(isDurableBlock('connector needs reconnect')).toBe(true)
    expect(isDurableBlock('element not found')).toBe(false)
    expect(isDurableBlock(undefined)).toBe(false)
  })

  test('durable block pauses instead of failing, with next run scheduled', () => {
    const schedule: WorkflowSchedule = {
      id: 's',
      workflowId: 'w',
      kind: 'hourly',
      enabled: true,
    }
    const outcome = decideRunOutcome({
      schedule,
      error: 'Login required',
      now: new Date('2026-10-24T10:00:00Z').getTime(),
    })
    expect(outcome.status).toBe('paused-blocked')
    expect(outcome.nextRunAt).toBe(
      new Date('2026-10-24T11:00:00Z').getTime(),
    )
    const failed = decideRunOutcome({ error: 'element not found' })
    expect(failed.status).toBe('failed')
    expect(decideRunOutcome({}).status).toBe('succeeded')
  })
})

describe('InMemoryWorkflowRunStore', () => {
  test('lists newest first and prunes to the cap', () => {
    const store = new InMemoryWorkflowRunStore()
    for (let i = 0; i < 55; i++) {
      store.add({
        id: `r${i}`,
        workflowId: 'w',
        status: 'succeeded',
        startedAt: 1000 + i,
        stepsCompleted: i,
      })
    }
    const listed = store.listByWorkflow('w')
    expect(listed).toHaveLength(50)
    expect(listed[0]?.id).toBe('r54')
    expect(store.latest('w')?.id).toBe('r54')
  })
})
