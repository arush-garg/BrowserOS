import { z } from 'zod/v4'
import { CartReviewStore, renderCartReview, type Cart } from './cart-review'
import { defineTool, errorResult, textResult } from './framework'
import { ApprovalStore, gradeAction } from './risk-gate'
import { TaskTrace, type TraceEventKind } from './task-trace'

/**
 * `safety` MCP tool: the reachable surface for the risk/cart/trace
 * modules in this branch. Module-level stores are per-process, which
 * matches the MCP server model: one server process owns one browser
 * session, and approvals/cart reviews live only as long as it does.
 *
 * This tool does NOT execute browser actions itself. It gates them:
 * an external agent calls `gate` before a HIGH action, shows the
 * returned card to the user, and only proceeds after `approve` +
 * payload-exact consumption (enforced by ApprovalStore). Cart
 * reviews work the same way: `cart_start` -> user reviews the
 * rendered cart -> `cart_approve` -> `cart_check` immediately before
 * payment, so a material change forces a fresh review.
 */

const approvals = new ApprovalStore()
const cartReviews = new CartReviewStore()
const traces = new Map<string, TaskTrace>()

function traceFor(taskId: string): TaskTrace {
  let trace = traces.get(taskId)
  if (!trace) {
    trace = new TaskTrace(taskId)
    traces.set(taskId, trace)
  }
  return trace
}

const cartItemSchema = z
  .object({
    name: z.string(),
    seller: z.string().optional(),
    variant: z.string().optional(),
    quantity: z.number(),
    unitPrice: z.number(),
  })
  .strict()

const cartSchema = z
  .object({
    merchant: z.string(),
    items: z.array(cartItemSchema),
    shippingOption: z.string().optional(),
    shippingCost: z.number().optional(),
    taxes: z.number().optional(),
    fees: z.number().optional(),
    total: z.number(),
    currency: z.string(),
    paymentMethod: z.string().optional(),
    commitments: z.array(z.string()).optional(),
    isLiveChecked: z.boolean(),
  })
  .strict()

export const safety = defineTool({
  name: 'safety',
  description:
    'Risk gate, cart review, and task trace. Gate HIGH actions (purchase, send, delete, evaluate) before executing them and show the returned approval card to the user; approve only after the user confirms the exact payload. Start a cart review before payment and re-check it immediately before paying — a material change forces a fresh review. Append trace events to keep one timeline per task.',
  input: z
    .object({
      action: z
        .enum([
          'gate',
          'approve',
          'reject',
          'pending',
          'cart_start',
          'cart_approve',
          'cart_check',
          'trace_append',
          'trace_render',
        ])
        .default('pending'),
      kind: z.string().optional().describe('Action kind for gate.'),
      payload: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Exact payload for gate.'),
      purpose: z.string().optional(),
      page: z.number().int().optional(),
      approvalId: z.string().optional().describe('Approval id for approve/reject.'),
      reviewId: z.string().optional().describe('Cart review id for cart_approve/cart_check.'),
      cart: cartSchema.optional().describe('Verified cart for cart_start/cart_check.'),
      taskId: z.string().optional().describe('Task id for trace_append/trace_render.'),
      traceKind: z
        .enum([
          'llm-turn',
          'tool-decision',
          'ax-diff',
          'screenshot',
          'cdp-error',
          'approval',
          'cart-review',
          'lease',
          'note',
        ])
        .optional(),
      summary: z.string().optional().describe('Trace event summary.'),
      confidence: z.number().min(0).max(1).optional(),
    })
    .strict(),
  annotations: {
    title: 'Safety gate',
    readOnlyHint: false,
  },
  handler: async (args) => {
    switch (args.action) {
      case 'gate': {
        if (!args.kind || !args.payload)
          return errorResult('safety gate: kind and payload are required.')
        const decision = approvals.gate({
          kind: args.kind,
          payload: args.payload,
          purpose: args.purpose,
          page: args.page,
        })
        if (decision.verdict === 'allow')
          return textResult(`allowed (${decision.risk} risk): ${args.kind}`, {
            verdict: 'allow',
            risk: decision.risk,
          })
        return textResult(approvals.renderCard(decision.card), {
          verdict: 'requires-approval',
          risk: decision.risk,
          card: decision.card,
        })
      }
      case 'approve': {
        if (!args.approvalId)
          return errorResult('safety approve: approvalId is required.')
        const card = approvals.resolveApproval(args.approvalId, 'approved')
        if (!card) return errorResult('safety approve: unknown approval id.')
        return textResult(`approval ${card.id} ${card.status}`, { card })
      }
      case 'reject': {
        if (!args.approvalId)
          return errorResult('safety reject: approvalId is required.')
        const card = approvals.resolveApproval(args.approvalId, 'rejected')
        if (!card) return errorResult('safety reject: unknown approval id.')
        return textResult(`approval ${card.id} ${card.status}`, { card })
      }
      case 'pending': {
        const pending = approvals.pending()
        return textResult(
          pending.length === 0
            ? '(no pending approvals)'
            : pending.map((c) => approvals.renderCard(c)).join('\n---\n'),
          { pending },
        )
      }
      case 'cart_start': {
        if (!args.cart)
          return errorResult('safety cart_start: cart is required.')
        const review = cartReviews.startReview(args.cart as Cart)
        return textResult(
          `Cart review ${review.id} pending:\n${renderCartReview(review.cart)}`,
          { review },
        )
      }
      case 'cart_approve': {
        if (!args.reviewId)
          return errorResult('safety cart_approve: reviewId is required.')
        const review = cartReviews.approve(args.reviewId)
        if (!review) return errorResult('safety cart_approve: unknown review id.')
        return textResult(`cart review ${review.id} ${review.status}`, { review })
      }
      case 'cart_check': {
        if (!args.reviewId || !args.cart)
          return errorResult('safety cart_check: reviewId and cart are required.')
        const result = cartReviews.authorisesPayment(
          args.reviewId,
          args.cart as Cart,
        )
        return result.ok
          ? textResult('cart review authorises payment: no material change, live-checked.', {
              ok: true,
            })
          : errorResult(
              `cart review does NOT authorise payment: ${result.reason ?? 'unknown'}`,
            )
      }
      case 'trace_append': {
        if (!args.taskId || !args.traceKind || !args.summary)
          return errorResult(
            'safety trace_append: taskId, traceKind, and summary are required.',
          )
        const event = traceFor(args.taskId).append(
          args.traceKind as TraceEventKind,
          args.summary,
          { confidence: args.confidence },
        )
        return textResult(`trace event ${event.seq} appended to ${args.taskId}`, {
          event,
        })
      }
      case 'trace_render': {
        if (!args.taskId)
          return errorResult('safety trace_render: taskId is required.')
        const trace = traces.get(args.taskId)
        if (!trace) return errorResult(`safety trace_render: no trace for ${args.taskId}.`)
        return textResult(trace.render(), { events: trace.timeline() })
      }
      default:
        return errorResult('safety: unsupported action.')
    }
  },
})

// Re-exported for the agent loop: approval consumption is payload-exact
// and one-shot, so a loop that checks `consumeApproval` cannot replay
// an old approval for a different purchase.
export { approvals as safetyApprovals, gradeAction as safetyGradeAction }
