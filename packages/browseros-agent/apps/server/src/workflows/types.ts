/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Shared types for the workflow / skills / model-routing layer.
 *
 * These modules are intentionally dependency-free and browser-free: they
 * model templates, context, schedules, fan-out, skills and budgets as pure
 * data transformations so they can be unit-tested without Chrome. Wiring
 * them to a real browser tab, a persistent store, or a sidepanel UI is a
 * separate, explicitly documented step (see README.md in this directory).
 */

export interface WorkflowStep {
  id: string
  tool: string
  input: Record<string, unknown>
  description?: string
}

export interface WorkflowInputSlot {
  name: string
  type: 'string' | 'number' | 'string[]'
  required: boolean
  defaultValue?: string | number | string[]
  description?: string
}

export interface OutputSchemaField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'string[]'
  required: boolean
}

export interface Workflow {
  id: string
  name: string
  description?: string
  /** Goal with all input slots already substituted. */
  goal: string
  inputs: WorkflowInputSlot[]
  outputSchema: OutputSchemaField[]
  steps: WorkflowStep[]
  contextBundleId?: string
  source?: {
    kind: 'template' | 'trajectory'
    templateId?: string
    trajectoryGoal?: string
  }
  createdAt: number
}

export interface TrajectoryStep {
  tool: string
  input: Record<string, unknown>
  /** Deliberately never carried into a workflow: outputs may contain
   *  page data, personal data, or secrets from the original run. */
  output?: unknown
}

export interface Trajectory {
  goal: string
  steps: TrajectoryStep[]
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  /** Goal template; `{{slot}}` placeholders are substituted on use. */
  goal: string
  inputs: WorkflowInputSlot[]
  outputSchema: OutputSchemaField[]
  steps: WorkflowStep[]
}

export interface ContextBundle {
  id: string
  workflowId?: string
  /** What "good" looks like; carried into every run, never re-prompted. */
  criteria: string[]
  sites: string[]
  exclusions: string[]
  tone?: string
  destination?: string
  notes?: string
}

export type ScheduleKind = 'hourly' | 'daily' | 'weekly' | 'custom'

export interface WorkflowTrigger {
  type: 'sheet-row' | 'email' | 'manual'
  source?: string
}

export interface WorkflowSchedule {
  id: string
  workflowId: string
  kind: ScheduleKind
  /** For `custom`: repeat every N minutes. Required for `custom`. */
  intervalMinutes?: number
  /** For `daily` / `weekly`: hour/minute in the schedule's local time. */
  hour?: number
  minute?: number
  /** For `weekly`: 0 = Sunday … 6 = Saturday. */
  weekday?: number
  /** Minutes east of UTC for hour/minute interpretation. Default 0 (UTC). */
  timezoneOffsetMinutes?: number
  triggers?: WorkflowTrigger[]
  enabled: boolean
}

export type WorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'paused-blocked'
  | 'aborted'

export interface WorkflowRunRecord {
  id: string
  workflowId: string
  scheduleId?: string
  status: WorkflowRunStatus
  startedAt: number
  finishedAt?: number
  /** Set only for `paused-blocked`: why the run stopped without failing. */
  blockReason?: string
  error?: string
  stepsCompleted: number
}

export type SkillTrigger = 'always' | 'keyword' | 'task' | 'site'

export interface Skill {
  name: string
  trigger: SkillTrigger
  keywords?: string[]
  taskNames?: string[]
  sites?: string[]
  content: string
  source?: string
}

export interface SkillContext {
  task: string
  taskName?: string
  site?: string
}

export type StepKind = 'text' | 'vision' | 'default'

export interface ModelRoutes {
  textModel: string
  visionModel: string
  defaultModel?: string
}

export interface BudgetLimits {
  maxSteps?: number
  maxRetries?: number
  maxTokens?: number
  /** USD. No payment code consumes this; it is a cost ceiling only. */
  maxCostUsd?: number
  maxDurationMs?: number
}

export interface BudgetMeter {
  steps: number
  retries: number
  tokens: number
  costUsd: number
  elapsedMs: number
  limits: BudgetLimits
  aborted: boolean
  abortReason?: string
}

export interface BudgetStep {
  tokens?: number
  costUsd?: number
  isRetry?: boolean
  stepKind?: StepKind
}
