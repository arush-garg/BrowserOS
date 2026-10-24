/**
 * MCP tools over `task-sessions.ts`.
 *
 * These tools manage session state only — they do not drive the browser.
 * The takeover mutex is enforced here as well as in the store: an agent
 * action tool should call `assertAgentCanAct(taskId)` before touching a
 * page, and `task_session_update_state` refuses agent updates while the
 * user holds the mutex, the session is paused, or it is blocked.
 *
 * Responses deliberately return field *names* (e.g. which verified-state
 * fields changed on hand-back), not field values, so a hand-back can never
 * echo a secret the user typed while driving.
 */
import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'
import {
  defaultTaskSessionStore,
  type PauseReason,
  type TaskSession,
  TaskSessionError,
} from './task-sessions'

const store = defaultTaskSessionStore

function sessionSummary(session: TaskSession): Record<string, unknown> {
  return {
    taskId: session.taskId,
    goal: session.goal,
    site: session.site,
    windowIds: session.windowIds,
    pageIds: session.pageIds,
    status: session.status,
    stage: session.stage,
    driver: session.driver,
    // Field names only: verified-state values are not echoed.
    verifiedStateFields: Object.keys(session.lastVerifiedState),
    pause: session.pause
      ? { reason: session.pause.reason, question: session.pause.question }
      : undefined,
    botCheckAttempts: session.botCheckAttempts,
    maxBotCheckAttempts: session.maxBotCheckAttempts,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function handle(error: unknown): ReturnType<typeof errorResult> {
  if (error instanceof TaskSessionError) return errorResult(error.message)
  throw error
}

const PAUSE_REASONS = [
  'login',
  'two_factor',
  'captcha',
  'bot_check',
  'bot_check_exhausted',
  'user_decision',
] as const

export const task_session_create = defineTool({
  name: 'task_session_create',
  description:
    'Create a persistent, resumable browser task session (taskId -> window/tab set, site, stage, last verified state). If a taskId already exists, this fails: resume that session by taskId instead of creating a new one, so login and page state are not lost.',
  input: z
    .object({
      taskId: z.string().optional(),
      goal: z.string().optional(),
      site: z.string().optional(),
      windowIds: z.array(z.number().int()).optional(),
      pageIds: z.array(z.number().int()).optional(),
      stage: z.string().optional(),
      maxBotCheckAttempts: z.number().int().positive().optional(),
    })
    .strict(),
  annotations: { title: 'Create task session' },
  handler: async (args) => {
    try {
      const session = store.create(args)
      return textResult(
        `created task session ${session.taskId}`,
        sessionSummary(session),
      )
    } catch (error) {
      return handle(error)
    }
  },
})

export const task_session_get = defineTool({
  name: 'task_session_get',
  description:
    'Resume/reattach to an existing task session by taskId. Returns the same session, never a new one. Reattaching does not clear a pause; use task_session_resume for that.',
  input: z.object({ taskId: z.string() }).strict(),
  annotations: { title: 'Get task session', readOnlyHint: true },
  handler: async (args) => {
    try {
      const session = store.resumeById(args.taskId)
      return textResult(
        `task session ${session.taskId} (${session.status})`,
        sessionSummary(session),
      )
    } catch (error) {
      return handle(error)
    }
  },
})

export const task_session_list = defineTool({
  name: 'task_session_list',
  description: 'List task sessions, most recently updated first.',
  input: z.object({}).strict(),
  annotations: { title: 'List task sessions', readOnlyHint: true },
  handler: async () => {
    const sessions = store.list().map(sessionSummary)
    return textResult(
      sessions.length === 0
        ? 'no task sessions'
        : `${sessions.length} task session(s)`,
      { sessions },
    )
  },
})

export const task_session_takeover = defineTool({
  name: 'task_session_takeover',
  description:
    'Human takeover: the user takes the driving mutex for a task session. While the user holds it, the agent must not act on that session. Fails if the user already holds it or the session is completed.',
  input: z.object({ taskId: z.string() }).strict(),
  annotations: { title: 'Take over task session' },
  handler: async (args) => {
    try {
      const session = store.takeover(args.taskId)
      return textResult(
        `user took over task session ${session.taskId}`,
        sessionSummary(session),
      )
    } catch (error) {
      return handle(error)
    }
  },
})

export const task_session_handback = defineTool({
  name: 'task_session_handback',
  description:
    'Human hand-back: the user returns the driving mutex to the agent. The agent diffs the observed state against the last verified state before continuing; only changed field names are reported, never values. A session paused for login/2FA/CAPTCHA resumes on hand-back unless keepPaused is set.',
  input: z
    .object({
      taskId: z.string(),
      observedUrl: z.string().optional(),
      observedTitle: z.string().optional(),
      observedStep: z.number().int().optional(),
      observedStage: z.string().optional(),
      keepPaused: z.boolean().optional(),
    })
    .strict(),
  annotations: { title: 'Hand back task session' },
  handler: async (args) => {
    try {
      const { session, changedFields } = store.handback(
        args.taskId,
        {
          url: args.observedUrl,
          title: args.observedTitle,
          step: args.observedStep,
          stage: args.observedStage,
        },
        { keepPaused: args.keepPaused },
      )
      return textResult(
        `agent resumed task session ${session.taskId}; changed fields: ${changedFields.join(', ') || '(none)'}`,
        { ...sessionSummary(session), changedFields },
      )
    } catch (error) {
      return handle(error)
    }
  },
})

export const task_session_pause = defineTool({
  name: 'task_session_pause',
  description:
    'Pause a task session for a human-only step (login, 2FA, CAPTCHA, bot-check, or another user decision). The loop pauses and surfaces the exact question; it does not die, and no answer value is stored. Resume with task_session_resume, or take over and hand back.',
  input: z
    .object({
      taskId: z.string(),
      reason: z.enum(PAUSE_REASONS),
      question: z.string().min(1),
    })
    .strict(),
  annotations: { title: 'Pause task session' },
  handler: async (args) => {
    try {
      const session = store.pause(
        args.taskId,
        args.reason as PauseReason,
        args.question,
      )
      return textResult(
        `paused task session ${session.taskId} (${args.reason})`,
        sessionSummary(session),
      )
    } catch (error) {
      return handle(error)
    }
  },
})

export const task_session_resume = defineTool({
  name: 'task_session_resume',
  description:
    'Resume a paused task session. Takes no answer value: a 2FA code or password must never be written into session history. A blocked session (bot-check exhausted) only resumes with userOverride set.',
  input: z
    .object({
      taskId: z.string(),
      userOverride: z.boolean().optional(),
    })
    .strict(),
  annotations: { title: 'Resume task session' },
  handler: async (args) => {
    try {
      const session = store.resume(args.taskId, {
        userOverride: args.userOverride,
      })
      return textResult(
        `resumed task session ${session.taskId}`,
        sessionSummary(session),
      )
    } catch (error) {
      return handle(error)
    }
  },
})

export const task_session_update_state = defineTool({
  name: 'task_session_update_state',
  description:
    'Update the last verified state of a task session (URL, title, step, stage, evidence). Agent updates are refused while the user holds the takeover mutex, the session is paused, or it is blocked. Evidence must not contain credential values.',
  input: z
    .object({
      taskId: z.string(),
      url: z.string().optional(),
      title: z.string().optional(),
      step: z.number().int().optional(),
      stage: z.string().optional(),
      evidence: z.string().optional(),
    })
    .strict(),
  annotations: { title: 'Update task session state' },
  handler: async (args) => {
    try {
      const session = store.updateVerifiedState(
        args.taskId,
        {
          url: args.url,
          title: args.title,
          step: args.step,
          stage: args.stage,
          evidence: args.evidence,
        },
        'agent',
      )
      return textResult(
        `updated task session ${session.taskId}`,
        sessionSummary(session),
      )
    } catch (error) {
      return handle(error)
    }
  },
})

export const task_session_bot_check = defineTool({
  name: 'task_session_bot_check',
  description:
    'Record a bot-check outcome for a task session. "attempt" counts one attempt; at the session cap the session becomes blocked (bot-check exhausted) instead of failing silently. "exhausted" blocks immediately. "resolved" is only a status note — a blocked session still needs task_session_resume with userOverride.',
  input: z
    .object({
      taskId: z.string(),
      outcome: z.enum(['attempt', 'exhausted']),
    })
    .strict(),
  annotations: { title: 'Record bot check' },
  handler: async (args) => {
    try {
      const session =
        args.outcome === 'attempt'
          ? store.recordBotCheckAttempt(args.taskId)
          : store.markBotCheckExhausted(args.taskId)
      return textResult(
        `bot check ${args.outcome} for task session ${session.taskId} (${session.status})`,
        sessionSummary(session),
      )
    } catch (error) {
      return handle(error)
    }
  },
})

export const TASK_SESSION_TOOLS = [
  task_session_create,
  task_session_get,
  task_session_list,
  task_session_takeover,
  task_session_handback,
  task_session_pause,
  task_session_resume,
  task_session_update_state,
  task_session_bot_check,
]
