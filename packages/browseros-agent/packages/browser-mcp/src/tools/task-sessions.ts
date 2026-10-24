/**
 * Persistent, resumable task sessions for the browser MCP layer.
 *
 * A task session is the unit the agent loop and the user share:
 *
 *   taskId -> window/tab set, site, workflow stage, last verified state
 *
 * Resuming a task means reattaching to the *same* session by taskId, never
 * silently creating a fresh one (which is how login state, cart state, and
 * page context used to get lost between turns). The lifecycle is:
 *
 *   running -> paused  (login / 2FA / CAPTCHA / bot-check / user decision)
 *   paused  -> running (resume, or hand-back after a human takeover)
 *   running -> blocked (bot-check exhausted: a terminal-ish state that only
 *                      an explicit user override can leave)
 *   *       -> completed
 *
 * Human takeover is a mutex, not a suggestion: while driver === 'user' the
 * agent must not act, and while driver === 'agent' the user is not driving.
 * `canAgentAct` / `assertAgentCanAct` are the single place that rule lives;
 * action tools should call them before touching a page. On hand-back the
 * agent must diff the observed state against `lastVerifiedState` before
 * continuing, so work the user did mid-takeover is not overwritten or
 * ignored.
 *
 * Secrets: this store never holds a credential value. Pause *questions*
 * ("Which account should I use?") are fine; pause *answers* (a 2FA code, a
 * password) must never be stored here — `resume()` deliberately takes no
 * answer value. See `secret-placeholders.ts` for the execution-boundary
 * placeholder contract.
 *
 * Persistence gap (deliberate, documented): this store is in-memory and
 * serializable (`toJSON` / `TaskSessionStore.fromJSON`), so a future change
 * can persist it to disk or a database without changing the state machine.
 * A process restart today loses in-memory sessions; callers must not treat
 * this store as durable storage yet.
 */

export type TaskDriver = 'agent' | 'user'

export type TaskStatus = 'running' | 'paused' | 'blocked' | 'completed'

export type PauseReason =
  | 'login'
  | 'two_factor'
  | 'captcha'
  | 'bot_check'
  | 'bot_check_exhausted'
  | 'user_decision'

export interface VerifiedState {
  url?: string
  title?: string
  /** Workflow step index, when the caller tracks one. */
  step?: number
  /** Workflow stage label, e.g. 'research', 'checkout'. Mirrored to `stage`. */
  stage?: string
  /** Evidence summary. Must not contain credential values. */
  evidence?: string
}

export interface PauseInfo {
  reason: PauseReason
  /** The exact question surfaced to the user. Never a secret value. */
  question: string
  askedAt: number
}

export interface SessionEvent {
  type: string
  at: number
  driver: TaskDriver
  status: TaskStatus
  /** Field names / counts only — never secret values, URLs are not stored here. */
  detail?: Record<string, unknown>
}

export interface TaskSession {
  taskId: string
  goal?: string
  site?: string
  windowIds: number[]
  pageIds: number[]
  status: TaskStatus
  /** Free-form workflow stage (e.g. 'research', 'checkout'); not the lifecycle. */
  stage: string
  driver: TaskDriver
  lastVerifiedState: VerifiedState
  pause?: PauseInfo
  botCheckAttempts: number
  maxBotCheckAttempts: number
  createdAt: number
  updatedAt: number
  events: SessionEvent[]
}

export interface CreateTaskSessionInput {
  taskId?: string
  goal?: string
  site?: string
  windowIds?: number[]
  pageIds?: number[]
  stage?: string
  maxBotCheckAttempts?: number
}

export interface UpdateVerifiedStateInput {
  url?: string
  title?: string
  step?: number
  stage?: string
  evidence?: string
}

export class TaskSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskSessionError'
  }
}

export const DEFAULT_MAX_BOT_CHECK_ATTEMPTS = 3

function now(): number {
  return Date.now()
}

function cloneSession(session: TaskSession): TaskSession {
  return {
    ...session,
    windowIds: [...session.windowIds],
    pageIds: [...session.pageIds],
    lastVerifiedState: { ...session.lastVerifiedState },
    pause: session.pause ? { ...session.pause } : undefined,
    events: session.events.map((event) => ({
      ...event,
      detail: event.detail ? { ...event.detail } : undefined,
    })),
  }
}

/** Fields of a verified state that changed between two observations. */
export function diffVerifiedState(
  before: VerifiedState,
  after: VerifiedState,
): string[] {
  const changed: string[] = []
  for (const key of ['url', 'title', 'step', 'stage', 'evidence'] as const) {
    if (before[key] !== after[key]) changed.push(key)
  }
  return changed
}

export class TaskSessionStore {
  private readonly sessions = new Map<string, TaskSession>()

  create(input: CreateTaskSessionInput = {}): TaskSession {
    const taskId = input.taskId?.trim() || crypto.randomUUID()
    if (this.sessions.has(taskId)) {
      throw new TaskSessionError(
        `task session ${taskId} already exists; resume it by taskId instead of creating a new session`,
      )
    }
    const session: TaskSession = {
      taskId,
      goal: input.goal,
      site: input.site,
      windowIds: [...(input.windowIds ?? [])],
      pageIds: [...(input.pageIds ?? [])],
      status: 'running',
      stage: input.stage ?? 'research',
      driver: 'agent',
      lastVerifiedState: { stage: input.stage ?? 'research' },
      botCheckAttempts: 0,
      maxBotCheckAttempts:
        input.maxBotCheckAttempts ?? DEFAULT_MAX_BOT_CHECK_ATTEMPTS,
      createdAt: now(),
      updatedAt: now(),
      events: [],
    }
    session.events.push({
      type: 'created',
      at: session.createdAt,
      driver: 'agent',
      status: 'running',
    })
    this.sessions.set(taskId, session)
    return cloneSession(session)
  }

  /** Reattach to an existing session. This does NOT clear a pause — use resume(). */
  get(taskId: string): TaskSession {
    const session = this.sessions.get(taskId)
    if (!session) {
      throw new TaskSessionError(`unknown task session ${taskId}`)
    }
    return cloneSession(session)
  }

  /** Alias for get(): resuming by ID returns the same session, never a new one. */
  resumeById(taskId: string): TaskSession {
    return this.get(taskId)
  }

  list(): TaskSession[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(cloneSession)
  }

  canAgentAct(session: TaskSession): boolean {
    return session.driver === 'agent' && session.status === 'running'
  }

  assertAgentCanAct(taskId: string): TaskSession {
    const session = this.get(taskId)
    if (!this.canAgentAct(session)) {
      const reason =
        session.driver === 'user'
          ? 'the user currently holds the takeover mutex'
          : session.status === 'paused'
            ? `the session is paused (${session.pause?.reason ?? 'unknown'}: ${session.pause?.question ?? 'no question recorded'})`
            : session.status === 'blocked'
              ? 'the session is blocked (bot-check exhausted); only an explicit user override can resume it'
              : `the session is ${session.status}`
      throw new TaskSessionError(
        `agent cannot act on task session ${taskId}: ${reason}`,
      )
    }
    return session
  }

  updateVerifiedState(
    taskId: string,
    input: UpdateVerifiedStateInput,
    actor: TaskDriver = 'agent',
  ): TaskSession {
    const session = this.sessions.get(taskId)
    if (!session) throw new TaskSessionError(`unknown task session ${taskId}`)
    if (actor === 'agent') this.assertAgentCanAct(taskId)
    const before = { ...session.lastVerifiedState }
    session.lastVerifiedState = { ...session.lastVerifiedState, ...input }
    if (input.stage !== undefined) session.stage = input.stage
    session.updatedAt = now()
    session.events.push({
      type: 'state_updated',
      at: session.updatedAt,
      driver: actor,
      status: session.status,
      detail: {
        changedFields: diffVerifiedState(before, session.lastVerifiedState),
      },
    })
    return cloneSession(session)
  }

  /** Human takes the wheel. Fails if the user already holds the mutex. */
  takeover(taskId: string, by = 'user'): TaskSession {
    const session = this.sessions.get(taskId)
    if (!session) throw new TaskSessionError(`unknown task session ${taskId}`)
    if (session.driver === 'user') {
      throw new TaskSessionError(
        `task session ${taskId} is already under human takeover`,
      )
    }
    if (session.status === 'completed') {
      throw new TaskSessionError(
        `task session ${taskId} is completed and cannot be taken over`,
      )
    }
    session.driver = 'user'
    session.updatedAt = now()
    session.events.push({
      type: 'takeover',
      at: session.updatedAt,
      driver: 'user',
      status: session.status,
      detail: { by, wasPaused: session.status === 'paused' },
    })
    return cloneSession(session)
  }

  /**
   * Human hands back. The agent diffs the observed state against
   * lastVerifiedState *before* continuing (the diff field names are returned;
   * values are not echoed, so hand-back notes can never leak a secret the
   * user typed mid-takeover). A session paused for login/2FA/CAPTCHA resumes
   * on hand-back unless `keepPaused` is set.
   */
  handback(
    taskId: string,
    observed: UpdateVerifiedStateInput = {},
    options: { keepPaused?: boolean } = {},
  ): { session: TaskSession; changedFields: string[] } {
    const session = this.sessions.get(taskId)
    if (!session) throw new TaskSessionError(`unknown task session ${taskId}`)
    if (session.driver !== 'user') {
      throw new TaskSessionError(
        `task session ${taskId} is not under human takeover; takeover first`,
      )
    }
    const before = { ...session.lastVerifiedState }
    session.lastVerifiedState = { ...session.lastVerifiedState, ...observed }
    if (observed.stage !== undefined) session.stage = observed.stage
    const changedFields = diffVerifiedState(before, session.lastVerifiedState)
    const wasPaused = session.status === 'paused'
    session.driver = 'agent'
    if (wasPaused && !options.keepPaused) {
      session.status = 'running'
      session.pause = undefined
    }
    session.updatedAt = now()
    session.events.push({
      type: 'handback',
      at: session.updatedAt,
      driver: 'agent',
      status: session.status,
      detail: {
        changedFields,
        resumedFromPause: wasPaused && !options.keepPaused,
      },
    })
    return { session: cloneSession(session), changedFields }
  }

  /** Pause for a human-only step. The question is surfaced; no answer is stored. */
  pause(taskId: string, reason: PauseReason, question: string): TaskSession {
    const session = this.sessions.get(taskId)
    if (!session) throw new TaskSessionError(`unknown task session ${taskId}`)
    if (session.status === 'completed') {
      throw new TaskSessionError(`task session ${taskId} is completed`)
    }
    if (session.status === 'blocked') {
      throw new TaskSessionError(
        `task session ${taskId} is blocked; resume it with a user override instead of pausing`,
      )
    }
    session.status = 'paused'
    session.pause = { reason, question, askedAt: now() }
    session.updatedAt = now()
    session.events.push({
      type: 'paused',
      at: session.updatedAt,
      driver: session.driver,
      status: 'paused',
      detail: { reason },
    })
    return cloneSession(session)
  }

  /**
   * Clear a pause. Takes no answer value on purpose: a 2FA code or password
   * must never be written into session history. A blocked session only
   * resumes with an explicit user override.
   */
  resume(
    taskId: string,
    options: { userOverride?: boolean } = {},
  ): TaskSession {
    const session = this.sessions.get(taskId)
    if (!session) throw new TaskSessionError(`unknown task session ${taskId}`)
    if (session.status === 'blocked' && !options.userOverride) {
      throw new TaskSessionError(
        `task session ${taskId} is blocked (bot-check exhausted); resume requires an explicit user override`,
      )
    }
    if (session.status !== 'paused' && session.status !== 'blocked') {
      throw new TaskSessionError(
        `task session ${taskId} is ${session.status}, not paused or blocked`,
      )
    }
    const wasBlocked = session.status === 'blocked'
    session.status = 'running'
    session.pause = undefined
    if (wasBlocked) session.botCheckAttempts = 0
    session.updatedAt = now()
    session.events.push({
      type: 'resumed',
      at: session.updatedAt,
      driver: session.driver,
      status: 'running',
      detail: {
        userOverride: wasBlocked ? true : Boolean(options.userOverride),
      },
    })
    return cloneSession(session)
  }

  /** One bot-check attempt. At the cap the session blocks instead of failing silently. */
  recordBotCheckAttempt(taskId: string): TaskSession {
    const session = this.sessions.get(taskId)
    if (!session) throw new TaskSessionError(`unknown task session ${taskId}`)
    session.botCheckAttempts += 1
    session.updatedAt = now()
    if (session.botCheckAttempts >= session.maxBotCheckAttempts) {
      return this.markBotCheckExhausted(taskId)
    }
    session.events.push({
      type: 'bot_check_attempt',
      at: session.updatedAt,
      driver: session.driver,
      status: session.status,
      detail: { attempts: session.botCheckAttempts },
    })
    return cloneSession(session)
  }

  markBotCheckExhausted(taskId: string): TaskSession {
    const session = this.sessions.get(taskId)
    if (!session) throw new TaskSessionError(`unknown task session ${taskId}`)
    session.status = 'blocked'
    session.pause = {
      reason: 'bot_check_exhausted',
      question:
        'Bot checks for this site are exhausted. Take over the browser to continue manually, or resume with an explicit user override.',
      askedAt: now(),
    }
    session.updatedAt = now()
    session.events.push({
      type: 'bot_check_exhausted',
      at: session.updatedAt,
      driver: session.driver,
      status: 'blocked',
      detail: { attempts: session.botCheckAttempts },
    })
    return cloneSession(session)
  }

  complete(taskId: string): TaskSession {
    const session = this.sessions.get(taskId)
    if (!session) throw new TaskSessionError(`unknown task session ${taskId}`)
    session.status = 'completed'
    session.pause = undefined
    session.updatedAt = now()
    session.events.push({
      type: 'completed',
      at: session.updatedAt,
      driver: session.driver,
      status: 'completed',
    })
    return cloneSession(session)
  }

  toJSON(): TaskSession[] {
    return this.list()
  }

  static fromJSON(sessions: TaskSession[]): TaskSessionStore {
    const store = new TaskSessionStore()
    for (const session of sessions) {
      store.sessions.set(session.taskId, cloneSession(session))
    }
    return store
  }
}

/** Process-wide store used by the MCP tools. Core logic is tested via the class. */
export const defaultTaskSessionStore = new TaskSessionStore()
