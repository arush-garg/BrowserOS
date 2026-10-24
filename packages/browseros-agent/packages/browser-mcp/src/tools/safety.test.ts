import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { safety } from './safety'

const session = {} as unknown as BrowserSession
const ctx = { session }

function textOf(result: { content?: unknown } | undefined): string {
  if (!Array.isArray(result?.content)) return ''
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        typeof (item as { text?: unknown }).text === 'string',
    )
    .map((item) => (item as { text: string }).text)
    .join('\n')
}

const cart = {
  merchant: 'Example Store',
  items: [{ name: 'Widget A', variant: 'Blue', quantity: 1, unitPrice: 19.99 }],
  total: 19.99,
  currency: 'USD',
  isLiveChecked: true,
}

describe('safety tool', () => {
  it('gates a purchase and returns an approval card', async () => {
    const result = await executeTool(
      safety,
      {
        action: 'gate',
        kind: 'purchase',
        payload: { item: 'Widget A', total: 19.99 },
      },
      ctx,
    )
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('Approval required')
    expect(textOf(result)).toContain('Widget A')
  })

  it('allows a read without a card', async () => {
    const result = await executeTool(
      safety,
      { action: 'gate', kind: 'snapshot', payload: {} },
      ctx,
    )
    expect(textOf(result)).toContain('allowed (LOW risk)')
  })

  it('runs a cart review end to end, then blocks a changed cart', async () => {
    const started = await executeTool(safety, { action: 'cart_start', cart }, ctx)
    expect(started.isError).toBeFalsy()
    const structured = started.structuredContent as
      | { review?: { id: string } }
      | undefined
    const reviewId = structured?.review?.id
    expect(reviewId).toBeTruthy()
    if (!reviewId) return

    await executeTool(safety, { action: 'cart_approve', reviewId }, ctx)
    const ok = await executeTool(
      safety,
      { action: 'cart_check', reviewId, cart },
      ctx,
    )
    expect(ok.isError).toBeFalsy()

    const changed = { ...cart, total: 24.99 }
    const blocked = await executeTool(
      safety,
      { action: 'cart_check', reviewId, cart: changed },
      ctx,
    )
    expect(blocked.isError).toBeTruthy()
    expect(textOf(blocked)).toContain('does NOT authorise payment')
  })

  it('appends and renders a task trace', async () => {
    const taskId = `safety-test-${Date.now()}`
    await executeTool(
      safety,
      {
        action: 'trace_append',
        taskId,
        traceKind: 'tool-decision',
        summary: 'clicked [e12] Search',
        confidence: 0.9,
      },
      ctx,
    )
    const rendered = await executeTool(
      safety,
      { action: 'trace_render', taskId },
      ctx,
    )
    expect(textOf(rendered)).toContain('clicked [e12] Search')
    expect(textOf(rendered)).toContain('confidence 0.90')
  })
})
