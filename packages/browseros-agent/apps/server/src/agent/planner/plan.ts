/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Persisted task tree for the apps/server agent loop.
 *
 * This module is intentionally dependency-free and interface-based: it does
 * not drive the browser, call a model, or rewrite the ToolLoopAgent. It is
 * the plan state that a future wiring step can hold alongside
 * `AiSdkAgent` (see `session.ts`) and render in the sidepanel.
 *
 * Statuses:
 * - `open`: not started yet.
 * - `in_progress`: the single subtask currently being worked on.
 * - `completed`: work attempted; still needs verification.
 * - `verified`: evidence checked — the only status that counts as done.
 * - `abandoned`: deliberately dropped; terminal, like `verified`.
 *
 * Only one subtask may be `in_progress` at a time. A subtask may move
 * `completed -> in_progress` again (reopen after a failed verification),
 * but `verified` and `abandoned` are terminal.
 */

export type PlanSubtaskStatus =
  | 'open'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'abandoned'

export interface PlanSubtask {
  id: string
  title: string
  status: PlanSubtaskStatus
}

export interface TaskPlanSnapshot {
  version: 1
  id: string
  goal: string
  planningMode: boolean
  approved: boolean
  subtasks: PlanSubtask[]
}

export interface CreateTaskPlanOptions {
  /** Stable id for the plan; defaults to a random UUID. */
  id?: string
  /**
   * Planning Mode: when true, side-effecting steps are blocked until
   * `approvePlan()` has been called (see `isSideEffectAllowed`).
   */
  planningMode?: boolean
}

const ALLOWED_TRANSITIONS: Record<
  PlanSubtaskStatus,
  readonly PlanSubtaskStatus[]
> = {
  open: ['in_progress', 'abandoned'],
  in_progress: ['completed', 'abandoned', 'open'],
  completed: ['verified', 'in_progress'],
  verified: [],
  abandoned: [],
}

function isPlanSubtaskStatus(value: unknown): value is PlanSubtaskStatus {
  return (
    value === 'open' ||
    value === 'in_progress' ||
    value === 'completed' ||
    value === 'verified' ||
    value === 'abandoned'
  )
}

export class TaskPlan {
  readonly id: string
  readonly goal: string
  readonly planningMode: boolean
  private _approved: boolean
  private readonly _subtasks: PlanSubtask[]

  constructor(
    goal: string,
    subtaskTitles: string[],
    options: CreateTaskPlanOptions = {},
  ) {
    if (!goal.trim()) {
      throw new Error('TaskPlan goal must not be empty')
    }
    if (subtaskTitles.length === 0) {
      throw new Error('TaskPlan requires at least one subtask')
    }
    this.id = options.id ?? crypto.randomUUID()
    this.goal = goal
    this.planningMode = options.planningMode ?? false
    this._approved = false
    this._subtasks = subtaskTitles.map((title, index) => {
      if (!title.trim()) {
        throw new Error('Plan subtask titles must not be empty')
      }
      return { id: `subtask-${index + 1}`, title, status: 'open' as const }
    })
  }

  get approved(): boolean {
    return this._approved
  }

  /** Deep copy of the subtasks, so callers cannot mutate plan state. */
  get subtasks(): PlanSubtask[] {
    return this._subtasks.map((subtask) => ({ ...subtask }))
  }

  /** In Planning Mode, side effects require explicit approval first. */
  isSideEffectAllowed(): boolean {
    return !this.planningMode || this._approved
  }

  approvePlan(): void {
    this._approved = true
  }

  subtask(id: string): PlanSubtask {
    const found = this._subtasks.find((subtask) => subtask.id === id)
    if (!found) {
      throw new Error(`Unknown subtask: ${id}`)
    }
    return { ...found }
  }

  startSubtask(id: string): PlanSubtask {
    if (this._subtasks.some((subtask) => subtask.status === 'in_progress')) {
      throw new Error('Another subtask is already in_progress')
    }
    return this.transition(id, 'in_progress')
  }

  completeSubtask(id: string): PlanSubtask {
    return this.transition(id, 'completed')
  }

  verifySubtask(id: string): PlanSubtask {
    return this.transition(id, 'verified')
  }

  abandonSubtask(id: string): PlanSubtask {
    return this.transition(id, 'abandoned')
  }

  /** Reopen a completed subtask, e.g. after a failed verification. */
  reopenSubtask(id: string): PlanSubtask {
    return this.transition(id, 'in_progress')
  }

  private transition(id: string, next: PlanSubtaskStatus): PlanSubtask {
    const subtask = this._subtasks.find((item) => item.id === id)
    if (!subtask) {
      throw new Error(`Unknown subtask: ${id}`)
    }
    if (!ALLOWED_TRANSITIONS[subtask.status].includes(next)) {
      throw new Error(
        `Invalid plan transition: ${subtask.status} -> ${next} for ${id}`,
      )
    }
    subtask.status = next
    return { ...subtask }
  }

  /**
   * A plan may finish only when it has at least one subtask, nothing is
   * still open / in progress / merely completed, and at least one subtask
   * was verified (a plan where everything was abandoned is not a success).
   */
  canFinish(): boolean {
    if (this._subtasks.length === 0) return false
    const hasVerified = this._subtasks.some(
      (subtask) => subtask.status === 'verified',
    )
    const allResolved = this._subtasks.every(
      (subtask) =>
        subtask.status === 'verified' || subtask.status === 'abandoned',
    )
    return hasVerified && allResolved
  }

  toSnapshot(): TaskPlanSnapshot {
    return {
      version: 1,
      id: this.id,
      goal: this.goal,
      planningMode: this.planningMode,
      approved: this._approved,
      subtasks: this.subtasks,
    }
  }

  static fromSnapshot(snapshot: TaskPlanSnapshot): TaskPlan {
    if (snapshot.version !== 1) {
      throw new Error(`Unsupported TaskPlan snapshot version: ${snapshot.version}`)
    }
    if (!snapshot.goal.trim() || snapshot.subtasks.length === 0) {
      throw new Error('Invalid TaskPlan snapshot: empty goal or subtasks')
    }
    const plan = new TaskPlan(
      snapshot.goal,
      snapshot.subtasks.map((subtask) => subtask.title),
      { id: snapshot.id, planningMode: snapshot.planningMode },
    )
    // Restore statuses directly: fromSnapshot is the trusted persistence
    // boundary, so it bypasses the transition rules (a persisted plan may
    // legitimately be in any combination of states).
    for (const saved of snapshot.subtasks) {
      if (!isPlanSubtaskStatus(saved.status)) {
        throw new Error(`Invalid subtask status in snapshot: ${saved.status}`)
      }
      const current = plan._subtasks.find((item) => item.id === saved.id)
      if (!current) {
        throw new Error(`Snapshot subtask id not in plan: ${saved.id}`)
      }
      current.status = saved.status
    }
    plan._approved = snapshot.approved
    return plan
  }
}

export function createTaskPlan(
  goal: string,
  subtaskTitles: string[],
  options?: CreateTaskPlanOptions,
): TaskPlan {
  return new TaskPlan(goal, subtaskTitles, options)
}
