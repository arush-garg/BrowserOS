import { describe, expect, test } from 'bun:test'
import {
  BudgetTracker,
  formatMeter,
  routeStep,
  runMeterView,
} from '../../src/workflows/routing'

const ROUTES = {
  textModel: 'cheap-text',
  visionModel: 'vision-pro',
  defaultModel: 'default-model',
}

describe('routeStep', () => {
  test('text goes cheap, vision goes vision, default falls back', () => {
    expect(routeStep(ROUTES, 'text')).toBe('cheap-text')
    expect(routeStep(ROUTES, 'vision')).toBe('vision-pro')
    expect(routeStep(ROUTES, 'default')).toBe('default-model')
    expect(
      routeStep({ textModel: 't', visionModel: 'v' }, 'default'),
    ).toBe('t')
  })
})

describe('BudgetTracker', () => {
  test('aborts on max steps and stays aborted', () => {
    const tracker = new BudgetTracker({ maxSteps: 2 })
    expect(tracker.recordStep({})).toEqual({ allowed: true })
    expect(tracker.recordStep({})).toEqual({ allowed: true })
    expect(tracker.recordStep({})).toEqual({
      allowed: false,
      reason: 'max-steps',
    })
    expect(tracker.recordStep({})).toEqual({
      allowed: false,
      reason: 'max-steps',
    })
    expect(tracker.meterSnapshot().aborted).toBe(true)
  })

  test('aborts on retries, tokens, cost, and duration', () => {
    expect(
      new BudgetTracker({ maxRetries: 1 }).recordStep({ isRetry: true }),
    ).toEqual({ allowed: true })
    const retryTracker = new BudgetTracker({ maxRetries: 1 })
    retryTracker.recordStep({ isRetry: true })
    expect(retryTracker.recordStep({ isRetry: true })).toEqual({
      allowed: false,
      reason: 'max-retries',
    })
    expect(
      new BudgetTracker({ maxTokens: 10 }).recordStep({ tokens: 11 }),
    ).toEqual({ allowed: false, reason: 'max-tokens' })
    expect(
      new BudgetTracker({ maxCostUsd: 0.01 }).recordStep({ costUsd: 0.02 }),
    ).toEqual({ allowed: false, reason: 'max-cost' })

    let now = 1000
    const durationTracker = new BudgetTracker(
      { maxDurationMs: 100 },
      () => now,
    )
    now = 2000
    expect(durationTracker.recordStep({})).toEqual({
      allowed: false,
      reason: 'max-duration',
    })
  })

  test('meter formats for a run view', () => {
    const tracker = new BudgetTracker({ maxSteps: 50 })
    tracker.recordStep({ tokens: 1240, costUsd: 0.04 })
    const meter = tracker.meterSnapshot()
    const view = runMeterView(meter)
    expect(view.stepsText).toBe('1/50 steps')
    expect(view.tokensText).toBe('1,240 tokens')
    expect(view.progressPct).toBe(2)
    expect(view.aborted).toBe(false)
    expect(formatMeter(meter)).toContain('1/50 steps')
    expect(formatMeter(meter)).toContain('1,240 tokens')
  })
})
