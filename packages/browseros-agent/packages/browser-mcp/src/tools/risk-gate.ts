/**
 * Risk-aware confirmation gate for browser actions.
 *
 * Pure, dependency-free policy layer: it decides whether an action may
 * run, must be approved, or is blocked — it never itself drives the
 * browser, and it never approves its own decisions. A HIGH action is
 * paused and surfaced as an approve/reject card carrying the exact
 * payload the user is being asked to authorise; the decision is then
 * resolved out-of-band (UI / MCP caller) via `resolveApproval`.
 *
 * Grading rules (deliberately conservative):
 * - LOW: reads and navigation — snapshot, read, history, navigate,
 *   scroll, hover, screenshot, search. Auto-run.
 * - MEDIUM: reversible writes — type, fill, check, select, upload,
 *   download, tab create/close. Auto-run, but logged as a write.
 * - HIGH: irreversible or account-affecting — purchase, pay, send,
 *   message, post, publish, delete, change account settings, grant
 *   permissions, evaluate/run arbitrary JS. Always requires approval.
 * Unknown action kinds grade as HIGH: fail closed, never fail open.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface RiskAction {
  /** Stable action kind, e.g. 'navigate', 'click', 'purchase'. */
  kind: string
  /** Exact payload that will be executed if approved. Shown verbatim. */
  payload: Record<string, unknown>
  /** Optional free-text purpose, shown alongside the payload. */
  purpose?: string
  /** Page/tab the action targets, when known. */
  page?: number
}

export interface ApprovalCard {
  id: string
  action: RiskAction
  risk: RiskLevel
  status: ApprovalStatus
  createdAt: number
  /** Approvals expire so a stale card can never authorise a later run. */
  expiresAt: number
  resolvedAt?: number
  reason?: string
}

export const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000

const HIGH_KINDS = new Set([
  'purchase',
  'pay',
  'checkout',
  'send',
  'message',
  'post',
  'publish',
  'delete',
  'remove',
  'change-settings',
  'account-settings',
  'grant-permission',
  'evaluate',
  'run',
  'subscribe',
  'cancel-subscription',
])

const MEDIUM_KINDS = new Set([
  'type',
  'fill',
  'check',
  'uncheck',
  'select',
  'upload',
  'download',
  'tab-new',
  'tab-close',
  'click',
  'press',
  'drag',
  'hold',
  'focus',
])

const LOW_KINDS = new Set([
  'snapshot',
  'read',
  'history',
  'navigate',
  'scroll',
  'hover',
  'screenshot',
  'search',
  'grep',
  'diff',
  'wait',
  'monitor',
  'assert',
  'tab-list',
  'tab-active',
  'tab-match',
  'tab-lease',
])

export function gradeAction(kind: string): RiskLevel {
  const normalized = kind.trim().toLowerCase()
  if (HIGH_KINDS.has(normalized)) return 'HIGH'
  if (MEDIUM_KINDS.has(normalized)) return 'MEDIUM'
  if (LOW_KINDS.has(normalized)) return 'LOW'
  // Unknown kinds fail closed: an action we cannot classify is treated
  // as irreversible until a human (or an explicit mapping) says otherwise.
  return 'HIGH'
}

export type GateDecision =
  | { verdict: 'allow'; risk: RiskLevel }
  | { verdict: 'requires-approval'; risk: RiskLevel; card: ApprovalCard }

let approvalCounter = 0

export class ApprovalStore {
  private cards = new Map<string, ApprovalCard>()

  /**
   * Gate an action. LOW/MEDIUM return `allow`; HIGH returns a pending
   * card. A previously approved card authorises exactly one action
   * with the same kind + payload — it is consumed on use, so an old
   * approval can never be replayed for a different payload.
   */
  gate(
    action: RiskAction,
    opts: { ttlMs?: number; now?: number } = {},
  ): GateDecision {
    const risk = gradeAction(action.kind)
    if (risk !== 'HIGH') return { verdict: 'allow', risk }
    const now = opts.now ?? Date.now()
    const ttlMs = opts.ttlMs ?? DEFAULT_APPROVAL_TTL_MS
    const card: ApprovalCard = {
      id: `approval-${++approvalCounter}-${now}`,
      action,
      risk,
      status: 'pending',
      createdAt: now,
      expiresAt: now + ttlMs,
    }
    this.cards.set(card.id, card)
    return { verdict: 'requires-approval', risk, card }
  }

  /** Resolve a pending card. Expired cards resolve to `expired`, never approved. */
  resolveApproval(
    id: string,
    decision: 'approved' | 'rejected',
    opts: { now?: number } = {},
  ): ApprovalCard | undefined {
    const card = this.cards.get(id)
    if (!card || card.status !== 'pending') return card
    const now = opts.now ?? Date.now()
    if (now > card.expiresAt) {
      card.status = 'expired'
      card.resolvedAt = now
      card.reason = 'Approval expired before it was resolved.'
      return card
    }
    card.status = decision
    card.resolvedAt = now
    return card
  }

  /**
   * Consume an approved card for exactly the action it was issued for.
   * Returns true only when the card is approved, unexpired, and the
   * kind + payload match exactly. Consumption is one-shot.
   */
  consumeApproval(
    id: string,
    action: RiskAction,
    opts: { now?: number } = {},
  ): boolean {
    const card = this.cards.get(id)
    if (!card || card.status !== 'approved') return false
    const now = opts.now ?? Date.now()
    if (now > card.expiresAt) {
      card.status = 'expired'
      return false
    }
    if (card.action.kind !== action.kind) return false
    if (JSON.stringify(card.action.payload) !== JSON.stringify(action.payload))
      return false
    this.cards.delete(id)
    return true
  }

  get(id: string): ApprovalCard | undefined {
    return this.cards.get(id)
  }

  pending(): ApprovalCard[] {
    return [...this.cards.values()].filter((c) => c.status === 'pending')
  }

  /** Render the card exactly as the user should see it: payload verbatim. */
  renderCard(card: ApprovalCard): string {
    const lines = [
      `Approval required (${card.risk} risk): ${card.action.kind}`,
      `Action: ${card.action.kind}`,
      `Payload: ${JSON.stringify(card.action.payload)}`,
    ]
    if (card.action.purpose) lines.push(`Purpose: ${card.action.purpose}`)
    if (card.action.page !== undefined)
      lines.push(`Page: ${card.action.page}`)
    lines.push(`Approval id: ${card.id}`)
    return lines.join('\n')
  }
}
