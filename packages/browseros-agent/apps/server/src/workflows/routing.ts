/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
  BudgetLimits,
  BudgetMeter,
  BudgetStep,
  ModelRoutes,
  StepKind,
} from './types'

/** Route a step to a model: text steps cheap, vision steps vision-capable. */
export function routeStep(routes: ModelRoutes, stepKind: StepKind): string {
  if (stepKind === 'vision') return routes.visionModel
  if (stepKind === 'text') return routes.textModel
  return routes.defaultModel ?? routes.textModel
}

export interface BudgetCheck {
  allowed: boolean
  reason?: string
}

function limitReason(
  meter: BudgetMeter,
  limits: BudgetLimits,
): string | undefined {
  if (limits.maxSteps !== undefined && meter.steps > limits.maxSteps) {
    return 'max-steps'
  }
  if (limits.maxRetries !== undefined && meter.retries > limits.maxRetries) {
    return 'max-retries'
  }
  if (limits.maxTokens !== undefined && meter.tokens > limits.maxTokens) {
    return 'max-tokens'
  }
  if (limits.maxCostUsd !== undefined && meter.costUsd > limits.maxCostUsd) {
    return 'max-cost'
  }
  if (
    limits.maxDurationMs !== undefined &&
    meter.elapsedMs > limits.maxDurationMs
  ) {
    return 'max-duration'
  }
  return undefined
}

/**
 * Per-task budget tracker. A run that trips a ceiling aborts cleanly: the
 * abort reason is recorded once and every later check stays aborted, so a
 * loop cannot restart itself past the budget. `nowFn` is injectable for tests.
 */
export class BudgetTracker {
  private meter: BudgetMeter
  private readonly startedAt: number
  private readonly nowFn: () => number

  constructor(limits: BudgetLimits, nowFn: () => number = Date.now) {
    this.startedAt = nowFn()
    this.nowFn = nowFn
    this.meter = {
      steps: 0,
      retries: 0,
      tokens: 0,
      costUsd: 0,
      elapsedMs: 0,
      limits,
      aborted: false,
    }
  }

  /** Record one step; returns whether the run may continue after it. */
  recordStep(step: BudgetStep): BudgetCheck {
    if (this.meter.aborted) {
      return { allowed: false, reason: this.meter.abortReason }
    }
    this.meter.steps += 1
    if (step.isRetry) this.meter.retries += 1
    this.meter.tokens += step.tokens ?? 0
    this.meter.costUsd += step.costUsd ?? 0
    this.meter.elapsedMs = this.nowFn() - this.startedAt
    const reason = limitReason(this.meter, this.meter.limits)
    if (reason) {
      this.meter.aborted = true
      this.meter.abortReason = reason
      return { allowed: false, reason }
    }
    return { allowed: true }
  }

  meterSnapshot(): BudgetMeter {
    return {
      ...this.meter,
      elapsedMs: this.nowFn() - this.startedAt,
      limits: { ...this.meter.limits },
    }
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0')}`
}

/** Human-readable meter line for a run view (sidepanel binds to this). */
export function formatMeter(meter: BudgetMeter): string {
  const maxSteps = meter.limits.maxSteps ?? '∞'
  const parts = [
    `${meter.steps}/${maxSteps} steps`,
    `${meter.tokens.toLocaleString('en-US')} tokens`,
    formatCost(meter.costUsd),
    `${formatDuration(meter.elapsedMs)} elapsed`,
  ]
  if (meter.aborted) parts.push(`aborted: ${meter.abortReason ?? 'budget'}`)
  return parts.join(' · ')
}

/** Structured run-view model: a UI can render these fields directly. */
export function runMeterView(meter: BudgetMeter): {
  label: string
  stepsText: string
  tokensText: string
  costText: string
  elapsedText: string
  progressPct: number
  aborted: boolean
  abortReason?: string
} {
  const maxSteps = meter.limits.maxSteps
  return {
    label: formatMeter(meter),
    stepsText: `${meter.steps}/${maxSteps ?? '∞'} steps`,
    tokensText: `${meter.tokens.toLocaleString('en-US')} tokens`,
    costText: formatCost(meter.costUsd),
    elapsedText: formatDuration(meter.elapsedMs),
    progressPct:
      maxSteps === undefined
        ? 0
        : Math.min(100, Math.round((meter.steps / maxSteps) * 100)),
    aborted: meter.aborted,
    abortReason: meter.abortReason,
  }
}
