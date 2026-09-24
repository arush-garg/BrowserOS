import type { BrowserSession } from '@browseros/browser-core/core/session'
import { z } from 'zod/v4'
import {
  clampTimeout,
  defineTool,
  errorResult,
  type ToolContext,
  type ToolResult,
  textResult,
} from './framework'
import {
  awaitPredicate,
  describePredicate,
  type Predicate,
  PredicateError,
  predicateSchema,
  validatePredicate,
} from './predicate'

type InputApi = ReturnType<BrowserSession['input']>

const DEFAULT_HOLD_MS = 1_000
const DEFAULT_HOLD_TIMEOUT_MS = 10_000
const MAX_HOLD_TIMEOUT_MS = 30_000
const RECOVER_SETTLE_MS = 2_000

// Flat (not discriminated-union) schema: some providers reject nested anyOf JSON Schema. The kind
// is validated at runtime in the handler. All page mutation goes through this one tool.
export const act = defineTool({
  name: 'act',
  description:
    'Act on the page using refs from the last snapshot. kinds: click, hold (press and keep the button down - for hold-to-confirm controls and long-press menus - releasing after `until` is satisfied), type (into focused element), fill (one field via ref+value, or many via fields[]), press (a key/combo), hover, focus, check, uncheck, select (an option value), scroll, drag. Prefer the ref-based kinds; use the coordinate kinds (click_at/type_at/hover_at/drag_at) only when the target is not in the snapshot. Reads back a diff of what changed - re-snapshot if you need fresh refs. If a click or fill fails, scroll the target into view and retry once, or pass `recover` to have the tool do it. Never type credentials into a page you navigated to yourself; only into pages the user already opened or explicitly directed you to.',
  input: z
    .object({
      page: z.number().int(),
      kind: z.enum([
        'click',
        'click_at',
        'hold',
        'hold_at',
        'type',
        'type_at',
        'fill',
        'press',
        'hover',
        'hover_at',
        'focus',
        'check',
        'uncheck',
        'select',
        'scroll',
        'drag',
        'drag_at',
      ]),
      ref: z.string().optional().describe('Target element ref, e.g. "e12".'),
      selector: z
        .string()
        .optional()
        .describe(
          'CSS selector for the target element. Mutually exclusive with ref.',
        ),
      text: z.string().optional().describe('Text for kind=type.'),
      value: z.string().optional().describe('Value for kind=fill/select.'),
      fields: z
        .array(z.object({ ref: z.string(), value: z.string() }).strict())
        .optional()
        .describe('Multiple fields for kind=fill, filled in order.'),
      key: z
        .string()
        .optional()
        .describe('Key/combo for kind=press, e.g. "Enter", "Control+a".'),
      direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      amount: z
        .number()
        .optional()
        .describe('Scroll amount (wheel notches), default 3.'),
      x: z
        .number()
        .optional()
        .describe('Viewport x coordinate for *_at kinds.'),
      y: z
        .number()
        .optional()
        .describe('Viewport y coordinate for *_at kinds.'),
      targetRef: z.string().optional().describe('Target ref for kind=drag.'),
      startX: z.number().optional().describe('Drag start x coordinate.'),
      startY: z.number().optional().describe('Drag start y coordinate.'),
      endX: z.number().optional().describe('Drag end x coordinate.'),
      endY: z.number().optional().describe('Drag end y coordinate.'),
      until: predicateSchema
        .optional()
        .describe(
          'For kind=hold/hold_at: when to release the button. Defaults to a fixed 1000ms press. Use kind="selector"/"text" to hold until a confirmation appears, or "stable" to hold until the page stops animating.',
        ),
      holdTimeout: z
        .number()
        .optional()
        .describe(
          `For kind=hold/hold_at: longest the button may stay down, in ms (default ${DEFAULT_HOLD_TIMEOUT_MS}, max ${MAX_HOLD_TIMEOUT_MS}). The button is always released when this elapses, even if \`until\` never matched.`,
        ),
      recover: z
        .object({
          attempts: z
            .number()
            .int()
            .min(1)
            .max(3)
            .describe(
              'How many extra attempts to make after the first failure.',
            ),
          strategy: z
            .array(z.enum(['resnapshot', 'scroll', 'settle']))
            .nonempty()
            .describe(
              'What to do between attempts, applied in order: resnapshot (refresh refs), scroll (reveal the target), settle (wait for the DOM to stop changing).',
            ),
        })
        .strict()
        .optional()
        .describe(
          'Opt-in retry for a step that failed because the page moved under it. Only retries errors raised before the action reached the page (stale ref, detached node, navigating frame), so a click cannot be double-fired.',
        ),
      button: z.enum(['left', 'middle', 'right']).optional(),
      clickCount: z.number().int().optional(),
      clear: z.boolean().optional(),
    })
    .strict(),
  annotations: {
    title: 'Interact with page',
    destructiveHint: true,
  },
  handler: async (args, ctx, response) => {
    if (args.ref && args.selector) {
      return errorResult('provide either ref or selector, not both')
    }

    const out: ActNote = {}
    if (args.selector) {
      const err = await actOnSelector(args, ctx)
      if (err) return err
    } else {
      const input = ctx.session.input(args.page)
      const err = await withRecovery(args, ctx, input, out)
      if (err) return err
    }

    response.data({ kind: args.kind, ...out.data })
    response.includeDiff(args.page, { includeStructured: true })
    return textResult(out.note ?? `ok (${args.kind})`)
  },
})

type ActArgs = {
  page: number
  kind: string
  ref?: string
  selector?: string
  text?: string
  value?: string
  fields?: { ref: string; value: string }[]
  key?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  x?: number
  y?: number
  targetRef?: string
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  button?: 'left' | 'middle' | 'right'
  clickCount?: number
  clear?: boolean
  until?: Predicate
  holdTimeout?: number
  recover?: { attempts: number; strategy: RecoverStrategy[] }
}

type RecoverStrategy = 'resnapshot' | 'scroll' | 'settle'

/** Somewhere for a handler to report detail the generic `ok (kind)` line cannot carry. */
interface ActNote {
  note?: string
  data?: Record<string, unknown>
}

// Handlers that need neither ctx nor out simply declare fewer parameters.
type ActHandler = (
  args: ActArgs,
  input: InputApi,
  ctx: ToolContext,
  out: ActNote,
) => Promise<ToolResult | undefined>

const ACT_HANDLERS: Record<string, ActHandler> = {
  click: clickRef,
  click_at: clickAt,
  hold: holdRef,
  hold_at: holdAt,
  type: typeFocused,
  type_at: typeAt,
  fill,
  press,
  hover,
  hover_at: hoverAt,
  focus,
  check,
  uncheck,
  select,
  scroll,
  drag,
  drag_at: dragAt,
}

async function runKind(
  args: ActArgs,
  input: InputApi,
  ctx: ToolContext,
  out: ActNote,
): Promise<ToolResult | undefined> {
  const handler = ACT_HANDLERS[args.kind]
  return handler
    ? handler(args, input, ctx, out)
    : errorResult(`act: unknown kind "${args.kind}".`)
}

// A ref points at a snapshot node; once the DOM detaches it, retrying the same ref cannot help.
// Surface a clear instruction to re-snapshot instead of a raw CDP error.
async function runRefKind(
  args: ActArgs,
  input: InputApi,
  ctx: ToolContext,
  out: ActNote,
): Promise<ToolResult | undefined> {
  try {
    return await runKind(args, input, ctx, out)
  } catch (error) {
    return actFailure(args, error)
  }
}

function actFailure(args: ActArgs, error: unknown): ToolResult {
  if (error instanceof PredicateError) return errorResult(error.message)
  if (args.ref && isRetryableActError(error)) {
    return errorResult(
      `stale reference for ref "${args.ref}" — please refresh the snapshot and retry with a fresh ref.`,
    )
  }
  throw error
}

const MAX_SELECTOR_ATTEMPTS = 2
const SELECTOR_KINDS = new Set(['click', 'hover', 'fill', 'focus'])

// Transient DOM/frame races that a fresh resolve-and-dispatch can recover from.
function isRetryableActError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /detached|stale|navigating frame/i.test(message)
}

async function withSelectorRetry<T>(action: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_SELECTOR_ATTEMPTS; attempt++) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      if (!isRetryableActError(error) || attempt === MAX_SELECTOR_ATTEMPTS) {
        throw error
      }
    }
  }
  throw lastError
}

// Resolve a CSS selector to a backendNodeId via CDP on the page's own session.
async function resolveSelector(
  ctx: ToolContext,
  page: number,
  selector: string,
): Promise<number> {
  const { session: cdp } = await ctx.session.pages.getSession(page)
  const { root } = await cdp.DOM.getDocument()
  const { nodeId } = await cdp.DOM.querySelector({
    nodeId: root.nodeId,
    selector,
  })
  if (nodeId === 0) throw new Error('matched no elements')
  const { node } = await cdp.DOM.describeNode({ nodeId })
  return node.backendNodeId
}

async function actOnSelector(
  args: ActArgs,
  ctx: ToolContext,
): Promise<ToolResult | undefined> {
  if (!SELECTOR_KINDS.has(args.kind)) {
    return errorResult(
      `act ${args.kind}: selector is only supported for click, hover, fill, and focus.`,
    )
  }
  if (args.kind === 'fill' && args.value === undefined) {
    return errorResult('act fill: value is required.')
  }

  const selector = args.selector as string
  try {
    await withSelectorRetry(async () => {
      const backendNodeId = await resolveSelector(ctx, args.page, selector)
      const input = ctx.session.input(args.page)
      await dispatchSelector(args, input, backendNodeId)
    })
    return undefined
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error))
  }
}

async function dispatchSelector(
  args: ActArgs,
  input: InputApi,
  backendNodeId: number,
): Promise<void> {
  switch (args.kind) {
    case 'click':
      await input.clickBackendNode(backendNodeId, {})
      return
    case 'hover':
      await input.hoverBackendNode(backendNodeId)
      return
    case 'fill':
      await input.fillBackendNode(backendNodeId, args.value as string, {
        clear: args.clear,
      })
      return
    case 'focus':
      await input.focusBackendNode(backendNodeId)
      return
  }
}

async function clickRef(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (!args.ref) return errorResult('act click: ref is required.')
  await input.click(args.ref, clickOptions(args))
  return undefined
}

async function clickAt(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  const point = pointFromArgs(args, 'click_at')
  if ('content' in point) return point
  await input.clickAt(point.x, point.y, clickOptions(args))
  return undefined
}

async function typeFocused(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (args.text === undefined) return errorResult('act type: text is required.')
  await input.type(args.text)
  return undefined
}

async function typeAt(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  const point = pointFromArgs(args, 'type_at')
  if ('content' in point) return point
  if (args.text === undefined)
    return errorResult('act type_at: text is required.')
  await input.typeAt(point.x, point.y, args.text, args.clear ?? false)
  return undefined
}

async function fill(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (args.fields) {
    for (const field of args.fields)
      await input.fill(field.ref, field.value, { clear: args.clear })
    return undefined
  }
  if (args.ref && args.value !== undefined) {
    await input.fill(args.ref, args.value, { clear: args.clear })
    return undefined
  }
  return errorResult('act fill: provide fields[] or both ref and value.')
}

async function press(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (!args.key) return errorResult('act press: key is required.')
  await input.press(args.key)
  return undefined
}

async function hover(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (!args.ref) return errorResult('act hover: ref is required.')
  await input.hover(args.ref)
  return undefined
}

async function hoverAt(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  const point = pointFromArgs(args, 'hover_at')
  if ('content' in point) return point
  await input.hoverAt(point.x, point.y)
  return undefined
}

async function focus(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (!args.ref) return errorResult('act focus: ref is required.')
  await input.focus(args.ref)
  return undefined
}

async function check(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (!args.ref) return errorResult('act check: ref is required.')
  await input.check(args.ref)
  return undefined
}

async function uncheck(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (!args.ref) return errorResult('act uncheck: ref is required.')
  await input.uncheck(args.ref)
  return undefined
}

async function select(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (!args.ref || args.value === undefined) {
    return errorResult('act select: ref and value are required.')
  }
  await input.selectOption(args.ref, args.value)
  return undefined
}

async function scroll(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  await input.scroll(args.direction ?? 'down', args.amount ?? 3, args.ref)
  return undefined
}

async function drag(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (!args.ref || !args.targetRef) {
    return errorResult('act drag: ref and targetRef are required.')
  }
  await input.drag(args.ref, args.targetRef)
  return undefined
}

async function dragAt(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  if (
    args.startX === undefined ||
    args.startY === undefined ||
    args.endX === undefined ||
    args.endY === undefined
  ) {
    return errorResult(
      'act drag_at: startX, startY, endX, and endY are required.',
    )
  }
  await input.dragAt(
    { x: args.startX, y: args.startY },
    { x: args.endX, y: args.endY },
  )
  return undefined
}

function pointFromArgs(
  args: ActArgs,
  kind: string,
): { x: number; y: number } | ToolResult {
  if (args.x === undefined || args.y === undefined) {
    return errorResult(`act ${kind}: x and y are required.`)
  }
  return { x: args.x, y: args.y }
}

function clickOptions(args: ActArgs): { button?: string; clickCount?: number } {
  return {
    ...(args.button && { button: args.button }),
    ...(args.clickCount !== undefined && { clickCount: args.clickCount }),
  }
}

// Coordinate kinds cannot go stale, and type/press/drag/hold may already have reached the page
// when they fail — replaying those could duplicate typed text or re-trigger a hold-to-confirm.
const RECOVERABLE_KINDS = new Set([
  'click',
  'fill',
  'hover',
  'focus',
  'check',
  'uncheck',
  'select',
])

/**
 * Runs the action, optionally retrying it when the page moved underneath it.
 *
 * Only errors raised *before* the action reached the page are retried (stale ref, detached
 * node, navigating frame), which is what makes retrying a click safe: the first attempt
 * provably never dispatched, so there is nothing to double-fire.
 */
async function withRecovery(
  args: ActArgs,
  ctx: ToolContext,
  input: InputApi,
  out: ActNote,
): Promise<ToolResult | undefined> {
  const plan = args.recover
  if (!plan) return runRefKind(args, input, ctx, out)
  if (!RECOVERABLE_KINDS.has(args.kind)) {
    return errorResult(
      `act ${args.kind}: recover is not supported for this kind — a partial ${args.kind} may already have reached the page, so retrying could repeat its effect.`,
    )
  }

  const attempts = plan.attempts + 1
  const trace: string[] = []
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await runKind(args, input, ctx, out)
      if (attempt > 1) {
        out.note ??= `ok (${args.kind}) after ${attempt - 1} recovery attempt(s): ${trace.join('; ')}`
        out.data = { ...out.data, recovered: true, attempts: attempt }
      }
      return result
    } catch (error) {
      if (!isRetryableActError(error) || attempt === attempts) {
        return actFailure(args, error)
      }
      trace.push(errorText(error))
      trace.push(...(await applyStrategies(plan.strategy, args, ctx, input)))
    }
  }
  return undefined
}

async function applyStrategies(
  strategies: RecoverStrategy[],
  args: ActArgs,
  ctx: ToolContext,
  input: InputApi,
): Promise<string[]> {
  const applied: string[] = []
  for (const strategy of strategies) {
    try {
      if (strategy === 'resnapshot') {
        await ctx.session.observe(args.page).snapshot()
      } else if (strategy === 'scroll') {
        await input.scroll('down', 2)
      } else {
        const { session } = await ctx.session.pages.getSession(args.page)
        await awaitPredicate(
          session,
          { kind: 'stable' },
          { timeout: RECOVER_SETTLE_MS, signal: ctx.signal },
        )
      }
      applied.push(strategy)
    } catch {
      // A recovery step that cannot run is not itself a failure — the retry still happens.
      applied.push(`${strategy} (skipped)`)
    }
  }
  return applied
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function holdRef(
  args: ActArgs,
  input: InputApi,
  ctx: ToolContext,
  out: ActNote,
): Promise<ToolResult | undefined> {
  if (!args.ref) return errorResult('act hold: ref is required.')
  const plan = holdPlan(args)
  const invalid = checkHoldPlan(plan)
  if (invalid) return invalid
  const { session } = await ctx.session.pages.getSession(args.page)
  let outcome: Awaited<ReturnType<typeof awaitPredicate>> | undefined
  await input.hold(
    args.ref,
    async () => {
      outcome = await awaitPredicate(session, plan.until, {
        timeout: plan.timeout,
        signal: ctx.signal,
      })
    },
    clickOptions(args),
  )
  reportHold(plan, outcome, out)
  return undefined
}

async function holdAt(
  args: ActArgs,
  input: InputApi,
  ctx: ToolContext,
  out: ActNote,
): Promise<ToolResult | undefined> {
  const point = pointFromArgs(args, 'hold_at')
  if ('content' in point) return point
  const plan = holdPlan(args)
  const invalid = checkHoldPlan(plan)
  if (invalid) return invalid
  const { session } = await ctx.session.pages.getSession(args.page)
  let outcome: Awaited<ReturnType<typeof awaitPredicate>> | undefined
  await input.holdAt(
    point.x,
    point.y,
    async () => {
      outcome = await awaitPredicate(session, plan.until, {
        timeout: plan.timeout,
        signal: ctx.signal,
      })
    },
    clickOptions(args),
  )
  reportHold(plan, outcome, out)
  return undefined
}

function holdPlan(args: ActArgs): { until: Predicate; timeout: number } {
  return {
    until: args.until ?? { kind: 'time', ms: DEFAULT_HOLD_MS },
    timeout: clampTimeout(
      args.holdTimeout,
      DEFAULT_HOLD_TIMEOUT_MS,
      MAX_HOLD_TIMEOUT_MS,
    ),
  }
}

function checkHoldPlan(plan: { until: Predicate }): ToolResult | undefined {
  try {
    validatePredicate(plan.until)
    return undefined
  } catch (error) {
    if (error instanceof PredicateError) return errorResult(error.message)
    throw error
  }
}

// A hold whose condition never matched still released the button, so it is reported as a
// completed action rather than an error — but the note says so plainly instead of "ok (hold)".
// Use the assert tool when the condition not matching should stop the run.
function reportHold(
  plan: { until: Predicate; timeout: number },
  outcome: Awaited<ReturnType<typeof awaitPredicate>> | undefined,
  out: ActNote,
): void {
  const description = describePredicate(plan.until)
  if (outcome?.matched) {
    out.note = `held ${outcome.waitedMs}ms, released on ${outcome.detail}`
  } else {
    out.note = `held ${outcome?.waitedMs ?? plan.timeout}ms and released at the ${plan.timeout}ms limit — ${description} never matched`
  }
  out.data = {
    held: true,
    matched: outcome?.matched ?? false,
    heldMs: outcome?.waitedMs ?? plan.timeout,
    until: description,
  }
}
