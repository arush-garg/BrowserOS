import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { action_guard } from './action-guard'

function textOf(result: { content?: unknown } | undefined): string {
  if (!Array.isArray(result?.content)) return ''
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'text' &&
        'text' in item &&
        typeof item.text === 'string',
    )
    .map((item) => item.text)
    .join('\n')
}

describe('action_guard tool', () => {
  it('enqueues, asserts, and rejects after invalidation', async () => {
    const session = { pages: {} } as unknown as BrowserSession
    const ctx = { session }

    const enqueued = await executeTool(
      action_guard,
      { page: 3, action: 'enqueue' },
      ctx,
    )
    expect(enqueued.isError).toBeFalsy()
    const generation = (
      enqueued.structuredContent as { generation: number }
    ).generation

    const asserted = await executeTool(
      action_guard,
      { page: 3, action: 'assert', generation },
      ctx,
    )
    expect(asserted.isError).toBeFalsy()

    await executeTool(
      action_guard,
      { page: 3, action: 'invalidate', reason: 'navigate url' },
      ctx,
    )

    const stale = await executeTool(
      action_guard,
      { page: 3, action: 'assert', generation },
      ctx,
    )
    expect(stale.isError).toBe(true)
    expect(textOf(stale)).toContain('stale snapshot')
    expect(textOf(stale)).toContain('fresh snapshot')
  })

  it('requires a generation for assert', async () => {
    const session = { pages: {} } as unknown as BrowserSession
    const result = await executeTool(
      action_guard,
      { page: 3, action: 'assert' },
      { session },
    )
    expect(result.isError).toBe(true)
  })
})
