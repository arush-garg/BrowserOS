import { describe, expect, it } from 'bun:test'
import {
  CartReviewStore,
  IrreversibleActionStore,
  type Cart,
} from './cart-review'

const baseCart: Cart = {
  merchant: 'Example Store',
  items: [{ name: 'Widget A', variant: 'Blue', quantity: 1, unitPrice: 19.99 }],
  shippingOption: 'Standard',
  shippingCost: 4.99,
  taxes: 1.6,
  fees: 0,
  total: 26.58,
  currency: 'USD',
  paymentMethod: 'Visa •• 4242',
  commitments: ['30-day returns'],
  isLiveChecked: true,
}

describe('cart review', () => {
  it('authorises payment for an unchanged, live-checked cart', () => {
    const store = new CartReviewStore()
    const review = store.startReview(baseCart)
    store.approve(review.id)
    const result = store.authorisesPayment(review.id, baseCart)
    expect(result.ok).toBe(true)
  })

  it('re-triggers review on any material change', () => {
    const store = new CartReviewStore()
    const review = store.startReview(baseCart)
    store.approve(review.id)
    const changed: Cart = { ...baseCart, total: 29.99 }
    const result = store.authorisesPayment(review.id, changed)
    expect(result.ok).toBe(false)
    expect(result.differences).toContain('total')
    expect(store.get(review.id)?.status).toBe('superseded')
  })

  it('re-triggers review on variant, quantity, and payment changes', () => {
    const store = new CartReviewStore()
    const review = store.startReview(baseCart)
    store.approve(review.id)
    const changed: Cart = {
      ...baseCart,
      items: [{ name: 'Widget A', variant: 'Red', quantity: 2, unitPrice: 19.99 }],
      paymentMethod: 'Mastercard •• 1111',
    }
    const result = store.authorisesPayment(review.id, changed)
    expect(result.ok).toBe(false)
    expect(result.differences).toContain('items')
    expect(result.differences).toContain('paymentMethod')
  })

  it('refuses payment when the cart was not live-checked', () => {
    const store = new CartReviewStore()
    const review = store.startReview({ ...baseCart, isLiveChecked: false })
    store.approve(review.id)
    const result = store.authorisesPayment(review.id, {
      ...baseCart,
      isLiveChecked: false,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('live-checked')
  })

  it('does not authorise payment for a merely pending review', () => {
    const store = new CartReviewStore()
    const review = store.startReview(baseCart)
    expect(store.authorisesPayment(review.id, baseCart).ok).toBe(false)
  })
})

describe('irreversible-action reconciliation', () => {
  it('reports submitted-but-not-confirmed and schedules a recheck', () => {
    const store = new IrreversibleActionStore()
    const action = store.begin('purchase', { total: 26.58 })
    store.recordAttempt(action.id)
    const marked = store.markSubmittedNotConfirmed(action.id, 60_000, 1000)
    expect(marked.outcome).toBe('submitted-not-confirmed')
    expect(marked.recheckAt).toBe(61_000)
    expect(store.recheckDue(action.id, 61_000)).toBe(true)
    expect(store.recheckDue(action.id, 60_000)).toBe(false)
  })

  it('NEVER retries while the outcome is unknown', () => {
    const store = new IrreversibleActionStore()
    const action = store.begin('purchase', { total: 26.58 })
    store.recordAttempt(action.id)
    store.markSubmittedNotConfirmed(action.id)
    expect(() => store.recordAttempt(action.id)).toThrow(
      /Refusing to retry/,
    )
  })

  it('resolves only via reconciliation, never via a retry', () => {
    const store = new IrreversibleActionStore()
    const action = store.begin('purchase', { total: 26.58 })
    store.recordAttempt(action.id)
    store.markSubmittedNotConfirmed(action.id)
    const resolved = store.reconcile(
      action.id,
      'confirmed',
      'Order #123 found in account order history.',
    )
    expect(resolved.outcome).toBe('confirmed')
    expect(store.get(action.id)?.resolution).toContain('Order #123')
  })

  it('a declined payment is a terminal, reconciled outcome', () => {
    const store = new IrreversibleActionStore()
    const action = store.begin('purchase', { total: 26.58 })
    store.recordAttempt(action.id)
    store.markSubmittedNotConfirmed(action.id)
    const resolved = store.reconcile(action.id, 'declined', 'Card declined by issuer.')
    expect(resolved.outcome).toBe('declined')
  })
})
