/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowSchedule,
  WorkflowTrigger,
} from './types'

export const MAX_RUNS_PER_WORKFLOW = 50

function atMinute(date: Date): Date {
  const d = new Date(date)
  d.setSeconds(0, 0)
  return d
}

/**
 * Next occurrence of an hour/minute in a timezone expressed as minutes east
 * of UTC. All schedule math is UTC-based; the offset only shifts how
 * hour/minute are interpreted, so behaviour is deterministic in tests.
 */
function nextDaily(
  from: Date,
  hour: number,
  minute: number,
  weekday: number | undefined,
  offsetMinutes: number,
): Date {
  const local = new Date(from.getTime() + offsetMinutes * 60_000)
  const candidate = new Date(local)
  candidate.setHours(hour, minute, 0, 0)
  if (weekday !== undefined) {
    const delta = (weekday - candidate.getDay() + 7) % 7
    candidate.setDate(candidate.getDate() + delta)
    if (candidate.getTime() <= local.getTime()) {
      candidate.setDate(candidate.getDate() + 7)
    }
  } else if (candidate.getTime() <= local.getTime()) {
    candidate.setDate(candidate.getDate() + 1)
  }
  return new Date(candidate.getTime() - offsetMinutes * 60_000)
}

/** Next run after `from` for a schedule. Throws on invalid configuration. */
export function nextRunAfter(
  schedule: WorkflowSchedule,
  from: Date | number,
): Date {
  const base = atMinute(new Date(from))
  const offset = schedule.timezoneOffsetMinutes ?? 0
  switch (schedule.kind) {
    case 'hourly':
      return new Date(base.getTime() + 60 * 60_000)
    case 'daily':
      return nextDaily(
        base,
        schedule.hour ?? 9,
        schedule.minute ?? 0,
        undefined,
        offset,
      )
    case 'weekly':
      return nextDaily(
        base,
        schedule.hour ?? 9,
        schedule.minute ?? 0,
        schedule.weekday ?? 1,
        offset,
      )
    case 'custom': {
      const interval = schedule.intervalMinutes
      if (!interval || interval <= 0) {
        throw new Error('Custom schedule requires intervalMinutes > 0')
      }
      return new Date(base.getTime() + interval * 60_000)
    }
  }
}

export function triggerMatches(
  trigger: WorkflowTrigger,
  event: { type: WorkflowTrigger['type']; source?: string },
): boolean {
  if (trigger.type !== event.type) return false
  if (trigger.source && event.source) return trigger.source === event.source
  return true
}

const DURABLE_BLOCK_PATTERNS = [
  'login',
  'log-in',
  'sign-in',
  'sign in',
  '2fa',
  'two-factor',
  'captcha',
  'bot-check',
  'bot check',
  'auth',
  'connector',
  'reconnect',
  'session expired',
  'verification required',
]

/**
 * Durable blocks are conditions only the user (or a later scheduled run)
 * can clear: login, 2FA, bot checks, connector reconnects. They must pause
 * a schedule, not fail it forever and not spin retries.
 */
export function isDurableBlock(reason: string | undefined): boolean {
  if (!reason) return false
  const lower = reason.toLowerCase()
  return DURABLE_BLOCK_PATTERNS.some((p) => lower.includes(p))
}

export interface RunOutcome {
  status: WorkflowRunStatus
  /** Next scheduled run; set for paused-blocked runs so they retry on schedule. */
  nextRunAt?: number
  blockReason?: string
  error?: string
}

/**
 * Decide how a finished (or blocked) run should be recorded. A durable
 * block becomes `paused-blocked` with the next run still scheduled; any
 * other error becomes `failed`; a clean finish becomes `succeeded`.
 */
export function decideRunOutcome(opts: {
  schedule?: WorkflowSchedule
  error?: string
  blockReason?: string
  now?: number
}): RunOutcome {
  const now = opts.now ?? Date.now()
  const reason = opts.blockReason ?? opts.error
  if (reason && isDurableBlock(reason)) {
    return {
      status: 'paused-blocked',
      blockReason: reason,
      nextRunAt: opts.schedule
        ? nextRunAfter(opts.schedule, now).getTime()
        : undefined,
    }
  }
  if (opts.error) return { status: 'failed', error: opts.error }
  return { status: 'succeeded' }
}

/** In-memory run history. Swap for the DB run store when wiring to the server. */
export class InMemoryWorkflowRunStore {
  private runs: WorkflowRunRecord[] = []

  add(run: WorkflowRunRecord): WorkflowRunRecord {
    this.runs.push(run)
    this.prune(run.workflowId)
    return run
  }

  get(id: string): WorkflowRunRecord | undefined {
    return this.runs.find((r) => r.id === id)
  }

  listByWorkflow(workflowId: string): WorkflowRunRecord[] {
    return this.runs
      .filter((r) => r.workflowId === workflowId)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  latest(workflowId: string): WorkflowRunRecord | undefined {
    return this.listByWorkflow(workflowId)[0]
  }

  prune(workflowId: string, keep: number = MAX_RUNS_PER_WORKFLOW): number {
    const kept = this.listByWorkflow(workflowId).slice(0, keep)
    const keepIds = new Set(kept.map((r) => r.id))
    const before = this.runs.length
    this.runs = this.runs.filter(
      (r) => r.workflowId !== workflowId || keepIds.has(r.id),
    )
    return before - this.runs.length
  }
}
