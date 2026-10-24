import { describe, expect, test } from 'bun:test'
import { createTaskPlan, TaskPlan } from './plan'

describe('TaskPlan transitions', () => {
  test('starts all subtasks open, one at a time in progress', () => {
    const plan = createTaskPlan('Book a flight', ['Search', 'Select', 'Pay'])
    expect(plan.subtasks.map((s) => s.status)).toEqual([
      'open',
      'open',
      'open',
    ])
    plan.startSubtask('subtask-1')
    expect(() =>
      plan.startSubtask('subtask-2'),
    ).toThrow('already in_progress')
    expect(plan.subtask('subtask-1').status).toBe('in_progress')
  })

  test('full happy path: open -> in_progress -> completed -> verified', () => {
    const plan = createTaskPlan('Book a flight', ['Search'])
    plan.startSubtask('subtask-1')
    plan.completeSubtask('subtask-1')
    plan.verifySubtask('subtask-1')
    expect(plan.subtask('subtask-1').status).toBe('verified')
    expect(plan.canFinish()).toBe(true)
  })

  test('illegal transitions throw', () => {
    const plan = createTaskPlan('Book a flight', ['Search'])
    expect(() => plan.completeSubtask('subtask-1')).toThrow(
      'Invalid plan transition: open -> completed',
    )
    expect(() => plan.verifySubtask('subtask-1')).toThrow(
      'Invalid plan transition: open -> verified',
    )
    expect(() => plan.startSubtask('subtask-99')).toThrow('Unknown subtask')
  })

  test('verified and abandoned are terminal', () => {
    const plan = createTaskPlan('Book a flight', ['Search', 'Pay'])
    plan.startSubtask('subtask-1')
    plan.completeSubtask('subtask-1')
    plan.verifySubtask('subtask-1')
    expect(() => plan.startSubtask('subtask-1')).toThrow(
      'Invalid plan transition: verified -> in_progress',
    )
    plan.abandonSubtask('subtask-2')
    expect(() => plan.completeSubtask('subtask-2')).toThrow(
      'Invalid plan transition: abandoned -> completed',
    )
  })

  test('completed can reopen after a failed verification', () => {
    const plan = createTaskPlan('Book a flight', ['Search'])
    plan.startSubtask('subtask-1')
    plan.completeSubtask('subtask-1')
    plan.reopenSubtask('subtask-1')
    expect(plan.subtask('subtask-1').status).toBe('in_progress')
  })

  test('canFinish requires verified work and no unresolved subtasks', () => {
    const plan = createTaskPlan('Book a flight', ['Search', 'Pay'])
    expect(plan.canFinish()).toBe(false)
    plan.startSubtask('subtask-1')
    plan.completeSubtask('subtask-1')
    plan.verifySubtask('subtask-1')
    // subtask-2 still open
    expect(plan.canFinish()).toBe(false)
    plan.abandonSubtask('subtask-2')
    expect(plan.canFinish()).toBe(true)
  })

  test('all-abandoned is not a finish', () => {
    const plan = createTaskPlan('Book a flight', ['Search'])
    plan.abandonSubtask('subtask-1')
    expect(plan.canFinish()).toBe(false)
  })

  test('Planning Mode blocks side effects until approved', () => {
    const plan = createTaskPlan('Book a flight', ['Search'], {
      planningMode: true,
    })
    expect(plan.isSideEffectAllowed()).toBe(false)
    plan.approvePlan()
    expect(plan.isSideEffectAllowed()).toBe(true)
  })

  test('non-planning mode allows side effects immediately', () => {
    const plan = createTaskPlan('Book a flight', ['Search'])
    expect(plan.isSideEffectAllowed()).toBe(true)
  })

  test('snapshot round-trip preserves goal, mode, approval, and statuses', () => {
    const plan = createTaskPlan('Book a flight', ['Search', 'Pay'], {
      planningMode: true,
      id: 'plan-1',
    })
    plan.approvePlan()
    plan.startSubtask('subtask-1')
    plan.completeSubtask('subtask-1')
    plan.verifySubtask('subtask-1')
    const restored = TaskPlan.fromSnapshot(plan.toSnapshot())
    expect(restored.toSnapshot()).toEqual(plan.toSnapshot())
    expect(restored.canFinish()).toBe(false) // subtask-2 still open
  })

  test('snapshot rejects bad versions and empty plans', () => {
    expect(() =>
      TaskPlan.fromSnapshot({
        version: 2 as never,
        id: 'x',
        goal: 'g',
        planningMode: false,
        approved: false,
        subtasks: [{ id: 'subtask-1', title: 'Search', status: 'open' }],
      }),
    ).toThrow('Unsupported TaskPlan snapshot version')
    expect(() => createTaskPlan('', ['Search'])).toThrow()
    expect(() => createTaskPlan('Goal', [])).toThrow()
  })
})
