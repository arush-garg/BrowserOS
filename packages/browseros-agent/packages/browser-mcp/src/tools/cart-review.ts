/**
 * Verified cart-review loop + irreversible-action reconciliation.
 *
 * Two invariants, both enforced here rather than left to the agent's
 * judgement:
 *
 * 1. Cart review is a blocking step before payment. The review captures
 *    the full verified cart; any material change after a review was
 *    approved (items, variants, quantities, shipping, taxes, fees,
 *    total, currency, payment method, cancellation/recurring terms)
 *    invalidates the approval and forces a fresh review.
 * 2. An irreversible action whose outcome is unknown is NEVER retried
 *    and NEVER re-routed. It is reported as `submitted-not-confirmed`,
 *    a recheck is scheduled, and only reconciliation (an order lookup,
 *    account/email check) may resolve it to `confirmed` or `failed`.
 *
 * Separately: a listing is not availability. `isLiveChecked` records
 * whether price/availability were re-verified at commit time; only a
 * live-checked cart may proceed to payment.
 */

export interface CartItem {
  name: string
  seller?: string
  variant?: string
  quantity: number
  unitPrice: number
}

export interface Cart {
  merchant: string
  items: CartItem[]
  shippingOption?: string
  shippingCost?: number
  taxes?: number
  fees?: number
  /** Exact total, in minor units avoided — this is the displayed total. */
  total: number
  currency: string
  paymentMethod?: string
  /** Material commitments: cancellation terms, recurring charges, fees. */
  commitments?: string[]
  /** True only when price/availability were re-verified at commit time. */
  isLiveChecked: boolean
}

export interface CartReview {
  id: string
  cart: Cart
  status: 'pending' | 'approved' | 'rejected' | 'superseded'
  createdAt: number
  approvedAt?: number
}

let reviewCounter = 0

/** Fields whose change is material and must force a fresh review. */
export function cartMaterialDifferences(a: Cart, b: Cart): string[] {
  const diffs: string[] = []
  const eq = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
  if (a.merchant !== b.merchant) diffs.push('merchant')
  if (!eq(a.items, b.items)) diffs.push('items')
  if (a.shippingOption !== b.shippingOption) diffs.push('shippingOption')
  if (a.shippingCost !== b.shippingCost) diffs.push('shippingCost')
  if (a.taxes !== b.taxes) diffs.push('taxes')
  if (a.fees !== b.fees) diffs.push('fees')
  if (a.total !== b.total) diffs.push('total')
  if (a.currency !== b.currency) diffs.push('currency')
  if (a.paymentMethod !== b.paymentMethod) diffs.push('paymentMethod')
  if (!eq(a.commitments ?? [], b.commitments ?? []))
    diffs.push('commitments')
  return diffs
}

export function renderCartReview(cart: Cart): string {
  const lines = [
    `Merchant: ${cart.merchant}`,
    `Items:`,
    ...cart.items.map(
      (i) =>
        `  - ${i.name}${i.variant ? ` (${i.variant})` : ''}${i.seller ? `, sold by ${i.seller}` : ''} x${i.quantity} @ ${i.unitPrice}`,
    ),
    `Shipping: ${cart.shippingOption ?? '(none)'}${cart.shippingCost !== undefined ? ` (${cart.shippingCost})` : ''}`,
    `Taxes: ${cart.taxes ?? '(unknown)'}`,
    `Fees: ${cart.fees ?? '(unknown)'}`,
    `Total: ${cart.total} ${cart.currency}`,
    `Payment method: ${cart.paymentMethod ?? '(not selected)'}`,
    `Commitments: ${(cart.commitments ?? []).join('; ') || '(none stated)'}`,
    `Live-checked at commit: ${cart.isLiveChecked ? 'yes' : 'NO — price/availability not re-verified'}`,
  ]
  return lines.join('\n')
}

export class CartReviewStore {
  private reviews = new Map<string, CartReview>()

  /** Start a review for the exact cart as verified right now. */
  startReview(cart: Cart, now = Date.now()): CartReview {
    const review: CartReview = {
      id: `cart-review-${++reviewCounter}-${now}`,
      cart: structuredClone(cart),
      status: 'pending',
      createdAt: now,
    }
    this.reviews.set(review.id, review)
    return review
  }

  approve(id: string, now = Date.now()): CartReview | undefined {
    const review = this.reviews.get(id)
    if (review && review.status === 'pending') {
      review.status = 'approved'
      review.approvedAt = now
    }
    return review
  }

  reject(id: string): CartReview | undefined {
    const review = this.reviews.get(id)
    if (review && review.status === 'pending') review.status = 'rejected'
    return review
  }

  /**
   * Check whether an approved review still authorises `currentCart`.
   * Returns `{ ok: true }` only when the review is approved, the cart
   * is live-checked, and nothing material changed. Otherwise returns
   * the material differences and marks the review superseded when the
   * cart changed — the caller must start a fresh review.
   */
  authorisesPayment(
    id: string,
    currentCart: Cart,
  ): { ok: boolean; differences: string[]; reason?: string } {
    const review = this.reviews.get(id)
    if (!review) return { ok: false, differences: [], reason: 'No such review.' }
    if (review.status !== 'approved')
      return {
        ok: false,
        differences: [],
        reason: `Review is ${review.status}, not approved.`,
      }
    if (!currentCart.isLiveChecked)
      return {
        ok: false,
        differences: [],
        reason:
          'Cart is not live-checked: price/availability were not re-verified at commit time. A listing is not availability.',
      }
    const differences = cartMaterialDifferences(review.cart, currentCart)
    if (differences.length > 0) {
      review.status = 'superseded'
      return {
        ok: false,
        differences,
        reason: `Material change since review: ${differences.join(', ')}. A fresh review is required.`,
      }
    }
    return { ok: true, differences: [] }
  }

  get(id: string): CartReview | undefined {
    return this.reviews.get(id)
  }
}

// ---------------------------------------------------------------------------
// Irreversible-action reconciliation
// ---------------------------------------------------------------------------

export type IrreversibleOutcome =
  | 'pending'
  | 'submitted-not-confirmed'
  | 'confirmed'
  | 'failed'
  | 'declined'

export interface IrreversibleAction {
  id: string
  kind: string
  /** What was submitted; used to match a later reconciliation lookup. */
  submission: Record<string, unknown>
  outcome: IrreversibleOutcome
  /** Number of execute attempts made. Must never exceed 1 while unknown. */
  attempts: number
  /** When a recheck should next run (epoch ms), if scheduled. */
  recheckAt?: number
  resolution?: string
}

let actionCounter = 0

export class IrreversibleActionStore {
  private actions = new Map<string, IrreversibleAction>()

  begin(kind: string, submission: Record<string, unknown>): IrreversibleAction {
    const action: IrreversibleAction = {
      id: `irrev-${++actionCounter}-${Date.now()}`,
      kind,
      submission: structuredClone(submission),
      outcome: 'pending',
      attempts: 0,
    }
    this.actions.set(action.id, action)
    return action
  }

  /**
   * Record one execution attempt. Throws if this would be a retry while
   * a previous attempt's outcome is still unknown — that is the
   * double-order path, and it must be a hard error, not a warning.
   */
  recordAttempt(id: string): IrreversibleAction {
    const action = this.actions.get(id)
    if (!action) throw new Error(`No such irreversible action: ${id}`)
    if (action.outcome === 'submitted-not-confirmed')
      throw new Error(
        `Refusing to retry irreversible action ${id}: previous submission outcome is unknown. ` +
          'Reconcile (order/account lookup) before any further attempt.',
      )
    if (action.attempts >= 1 && action.outcome === 'pending')
      throw new Error(
        `Refusing to re-execute irreversible action ${id}: an attempt is already in flight.`,
      )
    action.attempts += 1
    return action
  }

  /** The submission went out but no confirmation came back. */
  markSubmittedNotConfirmed(
    id: string,
    recheckDelayMs = 60_000,
    now = Date.now(),
  ): IrreversibleAction {
    const action = this.actions.get(id)
    if (!action) throw new Error(`No such irreversible action: ${id}`)
    action.outcome = 'submitted-not-confirmed'
    action.recheckAt = now + recheckDelayMs
    action.resolution =
      'Submitted, not confirmed. Do not retry, do not switch payment routes, do not start a parallel task. Recheck order status at recheckAt.'
    return action
  }

  /**
   * The ONLY way out of `submitted-not-confirmed`: an external
   * reconciliation lookup (order status, account, email) that reports
   * the real outcome. A retry is never a reconciliation.
   */
  reconcile(
    id: string,
    outcome: 'confirmed' | 'failed' | 'declined',
    evidence: string,
  ): IrreversibleAction {
    const action = this.actions.get(id)
    if (!action) throw new Error(`No such irreversible action: ${id}`)
    if (
      action.outcome !== 'submitted-not-confirmed' &&
      action.outcome !== 'pending'
    )
      throw new Error(
        `Cannot reconcile irreversible action ${id}: already ${action.outcome}.`,
      )
    action.outcome = outcome
    action.resolution = evidence
    action.recheckAt = undefined
    return action
  }

  /** True while a recheck is due (and only then may a lookup run). */
  recheckDue(id: string, now = Date.now()): boolean {
    const action = this.actions.get(id)
    return (
      !!action &&
      action.outcome === 'submitted-not-confirmed' &&
      action.recheckAt !== undefined &&
      now >= action.recheckAt
    )
  }

  get(id: string): IrreversibleAction | undefined {
    return this.actions.get(id)
  }
}
