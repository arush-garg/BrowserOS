import { describe, expect, it } from 'bun:test'
import { ApprovalStore, gradeAction } from './risk-gate'

describe('risk gating', () => {
  it('auto-runs reads and navigation', () => {
    expect(gradeAction('navigate')).toBe('LOW')
    expect(gradeAction('snapshot')).toBe('LOW')
    expect(gradeAction('read')).toBe('LOW')
  })

  it('auto-runs reversible writes', () => {
    expect(gradeAction('type')).toBe('MEDIUM')
    expect(gradeAction('fill')).toBe('MEDIUM')
  })

  it('requires approval for irreversible actions', () => {
    for (const kind of ['purchase', 'pay', 'send', 'delete', 'evaluate', 'run']) {
      expect(gradeAction(kind)).toBe('HIGH')
    }
  })

  it('fails closed on unknown kinds', () => {
    expect(gradeAction('teleport')).toBe('HIGH')
    expect(gradeAction('')).toBe('HIGH')
  })

  it('gates HIGH actions behind a card showing the exact payload', () => {
    const store = new ApprovalStore()
    const decision = store.gate({
      kind: 'purchase',
      payload: { item: 'Widget A', total: 19.99, currency: 'USD' },
      purpose: 'Buy the reviewed cart',
    })
    expect(decision.verdict).toBe('requires-approval')
    if (decision.verdict !== 'requires-approval') return
    const rendered = store.renderCard(decision.card)
    expect(rendered).toContain('Widget A')
    expect(rendered).toContain('19.99')
    expect(rendered).toContain(decision.card.id)
  })

  it('approves exactly one action with the exact payload, then consumes it', () => {
    const store = new ApprovalStore()
    const action = { kind: 'send', payload: { to: 'ada@example.test' } }
    const decision = store.gate(action)
    expect(decision.verdict).toBe('requires-approval')
    if (decision.verdict !== 'requires-approval') return
    store.resolveApproval(decision.card.id, 'approved')
    expect(store.consumeApproval(decision.card.id, action)).toBe(true)
    // One-shot: the same card cannot authorise a second action.
    expect(store.consumeApproval(decision.card.id, action)).toBe(false)
  })

  it('refuses to consume an approval for a different payload', () => {
    const store = new ApprovalStore()
    const decision = store.gate({
      kind: 'purchase',
      payload: { item: 'Widget A', total: 19.99 },
    })
    if (decision.verdict !== 'requires-approval') return
    store.resolveApproval(decision.card.id, 'approved')
    expect(
      store.consumeApproval(decision.card.id, {
        kind: 'purchase',
        payload: { item: 'Widget B', total: 24.99 },
      }),
    ).toBe(false)
  })

  it('expires unresolved approvals', () => {
    const store = new ApprovalStore()
    const decision = store.gate(
      { kind: 'delete', payload: { id: 1 } },
      { ttlMs: 1000, now: 1000 },
    )
    if (decision.verdict !== 'requires-approval') return
    const resolved = store.resolveApproval(decision.card.id, 'approved', {
      now: 5000,
    })
    expect(resolved?.status).toBe('expired')
    expect(
      store.consumeApproval(
        decision.card.id,
        { kind: 'delete', payload: { id: 1 } },
        { now: 5000 },
      ),
    ).toBe(false)
  })
})
