import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import {
  task_session_bot_check,
  task_session_create,
  task_session_get,
  task_session_handback,
  task_session_pause,
  task_session_resume,
  task_session_takeover,
  task_session_update_state,
} from './task-session-tools'

// Task-session tools touch no browser session; only executeTool's tail reads
// pages, and these tools carry no `page` arg, so a bare stub is sufficient.
const ctx = {
  session: { pages: {} } as unknown as BrowserSession,
}

function textOf(result: { content?: unknown } | undefined): string {
  if (!Array.isArray(result?.content)) return ''
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        (item as { type: unknown }).type === 'text' &&
        'text' in item &&
        typeof (item as { text: unknown }).text === 'string',
    )
    .map((item) => item.text)
    .join('\n')
}

describe('task session MCP tools', () => {
  it('full flow: create -> pause for login -> takeover -> hand-back -> agent can act again', async () => {
    const id = `tool-flow-${crypto.randomUUID()}`
    const created = await executeTool(
      task_session_create,
      { taskId: id, goal: 'buy', site: 'example.com' },
      ctx,
    )
    expect(created.isError).toBeFalsy()

    const paused = await executeTool(
      task_session_pause,
      {
        taskId: id,
        reason: 'login',
        question: 'Please log in, then hand back.',
      },
      ctx,
    )
    expect(paused.isError).toBeFalsy()
    expect(textOf(paused)).toContain('paused')

    // Agent updates are refused while paused.
    const blockedUpdate = await executeTool(
      task_session_update_state,
      { taskId: id, step: 1 },
      ctx,
    )
    expect(blockedUpdate.isError).toBe(true)

    await executeTool(task_session_takeover, { taskId: id }, ctx)
    const handback = await executeTool(
      task_session_handback,
      { taskId: id, observedUrl: 'https://example.com/home' },
      ctx,
    )
    expect(handback.isError).toBeFalsy()
    expect(handback.structuredContent).toMatchObject({
      status: 'running',
      driver: 'agent',
    })

    const updated = await executeTool(
      task_session_update_state,
      { taskId: id, step: 2 },
      ctx,
    )
    expect(updated.isError).toBeFalsy()
  })

  it('create with a duplicate taskId errors, get resumes the same session', async () => {
    const id = `tool-dup-${crypto.randomUUID()}`
    await executeTool(task_session_create, { taskId: id }, ctx)
    const dup = await executeTool(task_session_create, { taskId: id }, ctx)
    expect(dup.isError).toBe(true)
    expect(textOf(dup)).toContain('already exists')
    const got = await executeTool(task_session_get, { taskId: id }, ctx)
    expect(got.isError).toBeFalsy()
  })

  it('bot-check cap blocks the session and resume without override fails', async () => {
    const id = `tool-bot-${crypto.randomUUID()}`
    await executeTool(
      task_session_create,
      { taskId: id, maxBotCheckAttempts: 1 },
      ctx,
    )
    const blocked = await executeTool(
      task_session_bot_check,
      { taskId: id, outcome: 'attempt' },
      ctx,
    )
    expect(blocked.structuredContent).toMatchObject({ status: 'blocked' })
    const noOverride = await executeTool(
      task_session_resume,
      { taskId: id },
      ctx,
    )
    expect(noOverride.isError).toBe(true)
    const overridden = await executeTool(
      task_session_resume,
      { taskId: id, userOverride: true },
      ctx,
    )
    expect(overridden.isError).toBeFalsy()
  })
})
