/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Thin session tying the planner modules together.
 *
 * `AgentPlannerSession` owns one `TaskPlan` and one `EventLog`. Every
 * plan transition is also recorded as a `plan` event, and every action /
 * observation / error / decision the caller reports is recorded as an
 * event — so the event log alone can reconstruct what the plan did.
 *
 * Integration point (not yet wired into `ToolLoopAgent`, by design):
 * create one session per conversation in `AiSdkAgent.create`, call
 * `recordAction` / `recordObservation` / `recordError` around tool
 * execution, gate side-effecting tools on `isSideEffectAllowed()`, and
 * call `requestFinish()` instead of accepting a bare `done` from the
 * model. Wiring it into the tool loop is a follow-up change; this
 * module keeps that wiring surface small and testable on its own.
 */

import { condenseTranscript, type CondenseOptions, type CondenseResult, type TranscriptMessage } from './condenser'
import { EventLog, type AgentEventKind } from './event-log'
import {
  verifyFinish,
  type FinishEvidence,
  type FinishGateResult,
  type FinishRequirements,
} from './finish-gate'
import {
  createTaskPlan,
  type CreateTaskPlanOptions,
  type PlanSubtask,
  type TaskPlan,
} from './plan'

export type { AgentEventKind, FinishEvidence, FinishGateResult, FinishRequirements, PlanSubtask, TaskPlan, TranscriptMessage }

export class AgentPlannerSession {
  readonly plan: TaskPlan
  readonly eventLog: EventLog

  constructor(
    goal: string,
    subtaskTitles: string[],
    options?: CreateTaskPlanOptions,
  ) {
    this.plan = createTaskPlan(goal, subtaskTitles, options)
    this.eventLog = new EventLog()
    this.eventLog.append('plan', {
      type: 'created',
      planId: this.plan.id,
      goal,
      subtaskCount: subtaskTitles.length,
      planningMode: this.plan.planningMode,
    })
  }

  /** Planning Mode gate: false until the user approves the plan. */
  isSideEffectAllowed(): boolean {
    return this.plan.isSideEffectAllowed()
  }

  approvePlan(): void {
    this.plan.approvePlan()
    this.eventLog.append('plan', { type: 'approved', planId: this.plan.id })
  }

  startSubtask(id: string): PlanSubtask {
    const subtask = this.plan.startSubtask(id)
    this.eventLog.append('plan', { type: 'started', subtaskId: id })
    return subtask
  }

  completeSubtask(id: string): PlanSubtask {
    const subtask = this.plan.completeSubtask(id)
    this.eventLog.append('plan', { type: 'completed', subtaskId: id })
    return subtask
  }

  verifySubtask(id: string): PlanSubtask {
    const subtask = this.plan.verifySubtask(id)
    this.eventLog.append('plan', { type: 'verified', subtaskId: id })
    return subtask
  }

  abandonSubtask(id: string): PlanSubtask {
    const subtask = this.plan.abandonSubtask(id)
    this.eventLog.append('plan', { type: 'abandoned', subtaskId: id })
    return subtask
  }

  recordAction(detail: Record<string, unknown>): void {
    this.eventLog.append('action', detail)
  }

  recordObservation(detail: Record<string, unknown>): void {
    this.eventLog.append('observation', detail)
  }

  recordError(detail: Record<string, unknown>): void {
    this.eventLog.append('error', detail)
  }

  recordDecision(detail: Record<string, unknown>): void {
    this.eventLog.append('decision', detail)
  }

  /**
   * Verified finish: evidence must pass AND the plan must be
   * finishable. A failure is recorded as a decision event so the log
   * shows why `done` was refused, instead of the run silently ending.
   */
  requestFinish(
    requirements: FinishRequirements,
    evidence: FinishEvidence,
  ): FinishGateResult {
    const result = verifyFinish(requirements, evidence, this.plan)
    this.eventLog.append('decision', {
      type: 'finish_requested',
      passed: result.passed,
      missing: result.missing,
    })
    return result
  }

  condenseTranscript(
    messages: TranscriptMessage[],
    options?: CondenseOptions,
  ): Promise<CondenseResult> {
    return condenseTranscript(messages, options)
  }

  /** JSONL persistence for the whole session's event log. */
  toJSONL(): string {
    return this.eventLog.toJSONL()
  }
}

export function createPlannerSession(
  goal: string,
  subtaskTitles: string[],
  options?: CreateTaskPlanOptions,
): AgentPlannerSession {
  return new AgentPlannerSession(goal, subtaskTitles, options)
}
