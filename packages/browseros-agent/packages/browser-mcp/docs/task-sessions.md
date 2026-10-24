# Task sessions, takeover, and login pauses

## What this is

`task-sessions.ts` + `task-session-tools.ts` add a session layer on top of
the existing tab/page tools. One task session maps a `taskId` to a
window/tab set, a site, a workflow stage, and the last verified state.
Resuming a task means reattaching to the same session by `taskId` — never
creating a fresh session and losing login, cart, or page context.

Lifecycle: `running -> paused -> running`, `running -> blocked ->
running` (user override only), `* -> completed`.

## Takeover mutex

`task_session_takeover` gives the driving mutex to the user; while
`driver === 'user'`, `assertAgentCanAct` throws and
`task_session_update_state` (agent) is refused. `task_session_handback`
returns the mutex, diffs the observed state against `lastVerifiedState`
(only changed field *names* are reported, never values), and resumes a
login/2FA/CAPTCHA pause unless `keepPaused` is set. Agent and user never
drive simultaneously by construction, not by convention.

## Pause states

`task_session_pause` with `reason` = `login | two_factor | captcha |
bot_check | bot_check_exhausted | user_decision` and an exact `question`
surfaces the question to the user instead of killing the run.
`task_session_resume` deliberately takes no answer value: a 2FA code or
password must never be written into session history.

Bot checks: `task_session_bot_check` with `outcome: 'attempt'` counts
toward the session cap (default 3); at the cap, or on `'exhausted'`, the
session becomes `blocked` with the exhaustion reported as state. A blocked
session only resumes with `task_session_resume` + `userOverride: true`.

## Secrets at the execution boundary

`secret-placeholders.ts`: the model, transcripts, logs, and session
history only ever see `<secret>key</secret>`. The real value is
substituted immediately before a fill action, for one domain only, via a
`SecretVault` implementation. Unknown or out-of-scope placeholders fail
closed — nothing is typed. `InMemorySecretVault` is for tests/local dev
only; production must inject an OS-keychain / extension-secure-storage
vault at the fill site. This module does not implement purchases and
does not bypass logins: it only governs how a credential the user
already approved is filled.

## Gaps (not hidden)

- The store is in-memory and serializable (`toJSON` / `fromJSON`), not
  yet persisted to disk. A process restart loses sessions.
- No live-browser test was run here (this VM has no Chrome). The
  state machine, mutex, pause/resume, bot-check blocking, and secret
  masking are covered by unit tests; wiring the mutex into `act` /
  `semantic_action` dispatch is a separate integration step and is
  intentionally out of this branch (see the Hermes scope note in the
  parent task: those files are not touched here).
- `act` and other action tools do not yet call `assertAgentCanAct`
  themselves; callers must pass a `taskId` and check before acting
  until that integration lands.
