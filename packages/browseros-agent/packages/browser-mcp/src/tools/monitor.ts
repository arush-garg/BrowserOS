import type { BrowserSession } from '@browseros/browser-core/core/session'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'

// A subscription nobody reads must not grow without bound, so the queue keeps
// the newest window and drops the oldest events.
const MAX_QUEUE_SIZE = 100
const EVENT_TYPES = ['navigation', 'loading', 'error', 'dom_change'] as const

type MonitorEventType = (typeof EVENT_TYPES)[number]

interface MonitorEvent {
  type: MonitorEventType
  timestamp: number
  details: Record<string, unknown>
}

interface Subscription {
  queue: MonitorEvent[]
  removeListeners: Array<() => void>
  eventTypes: readonly MonitorEventType[]
  /** Events discarded by the cap since the last read, reported on that read. */
  dropped: number
}

// Keyed by browser session so subscriptions cannot outlive the session they
// watch, and two sessions monitoring the same page id stay independent.
const subscriptions = new WeakMap<BrowserSession, Map<number, Subscription>>()

function sessionSubscriptions(
  session: BrowserSession,
): Map<number, Subscription> {
  const existing = subscriptions.get(session)
  if (existing) return existing
  const created = new Map<number, Subscription>()
  subscriptions.set(session, created)
  return created
}

function enqueue(
  subscription: Subscription,
  type: MonitorEventType,
  details: Record<string, unknown>,
): void {
  if (subscription.queue.length >= MAX_QUEUE_SIZE) {
    subscription.queue.shift()
    subscription.dropped += 1
  }
  subscription.queue.push({ type, timestamp: Date.now(), details })
}

/** Attaches the CDP listeners for one event type, returning their removers. */
function listen(
  protocol: ProtocolApi,
  type: MonitorEventType,
  emit: (type: MonitorEventType, details: Record<string, unknown>) => void,
): Array<() => void> {
  switch (type) {
    case 'navigation':
      return [
        protocol.Page.on('frameNavigated', (params) =>
          emit('navigation', {
            frameId: params.frame?.id,
            url: params.frame?.url,
          }),
        ),
      ]
    case 'loading':
      return [
        protocol.Page.on('frameStartedLoading', (params) =>
          emit('loading', { frameId: params.frameId, loading: true }),
        ),
        protocol.Page.on('frameStoppedLoading', (params) =>
          emit('loading', { frameId: params.frameId, loading: false }),
        ),
      ]
    case 'error':
      return [
        protocol.Runtime.on('exceptionThrown', (params) =>
          emit('error', {
            source: 'exception',
            text: params.exceptionDetails?.text,
            url: params.exceptionDetails?.url,
            lineNumber: params.exceptionDetails?.lineNumber,
          }),
        ),
        protocol.Runtime.on('consoleAPICalled', (params) => {
          if (params.type !== 'error') return
          emit('error', {
            source: 'console',
            text: params.args
              .map((arg) => arg.description ?? String(arg.value ?? ''))
              .join(' '),
          })
        }),
      ]
    case 'dom_change':
      return [
        protocol.DOM.on('childNodeInserted', (params) =>
          emit('dom_change', {
            change: 'inserted',
            parentNodeId: params.parentNodeId,
            nodeId: params.node?.nodeId,
          }),
        ),
        protocol.DOM.on('childNodeRemoved', (params) =>
          emit('dom_change', {
            change: 'removed',
            parentNodeId: params.parentNodeId,
            nodeId: params.nodeId,
          }),
        ),
        protocol.DOM.on('characterDataModified', (params) =>
          emit('dom_change', {
            change: 'text',
            nodeId: params.nodeId,
            characterData: params.characterData,
          }),
        ),
      ]
  }
}

export const monitor = defineTool({
  name: 'monitor',
  description:
    'Watch a page for CDP events without blocking, as the observational counterpart to `wait`. action="start" subscribes the page, "read" drains everything queued since the last read, and "stop" unsubscribes - always stop a page you started. Event types: "navigation" (frame committed a new url), "loading" (frame started/stopped loading), "error" (uncaught exceptions and console.error), "dom_change" (nodes inserted, removed, or text edited); omit eventTypes to watch all four. The queue holds at most 100 events and drops the oldest ones past that, so read often on a busy page - each read reports how many were dropped.',
  input: z
    .object({
      action: z
        .enum(['start', 'read', 'stop'])
        .default('start')
        .describe('Subscribe, drain queued events, or unsubscribe.'),
      page: z.number().int().describe('Page id from `tabs`.'),
      eventTypes: z
        .array(z.enum(EVENT_TYPES))
        .nonempty()
        .optional()
        .describe('Event types to watch on "start". Defaults to all four.'),
    })
    .strict(),
  annotations: { title: 'Monitor page events', readOnlyHint: true },
  handler: async (args, ctx) => {
    const subs = sessionSubscriptions(ctx.session)
    const existing = subs.get(args.page)

    switch (args.action) {
      case 'start': {
        if (existing) {
          return textResult(
            `monitoring already started for page ${args.page} (${existing.eventTypes.join(', ')})`,
            { page: args.page, eventTypes: existing.eventTypes },
          )
        }
        const eventTypes = args.eventTypes ?? EVENT_TYPES
        const subscription: Subscription = {
          queue: [],
          removeListeners: [],
          eventTypes,
          dropped: 0,
        }
        const { session } = await ctx.session.pages.getSession(args.page)
        const emit = (
          type: MonitorEventType,
          details: Record<string, unknown>,
        ) => enqueue(subscription, type, details)
        for (const type of eventTypes) {
          subscription.removeListeners.push(...listen(session, type, emit))
        }
        // Registered only once the listeners are attached, so a failure above
        // cannot leave a subscription that collects nothing and blocks restart.
        subs.set(args.page, subscription)
        return textResult(
          `monitoring started for page ${args.page} (${eventTypes.join(', ')})`,
          { page: args.page, eventTypes },
        )
      }
      case 'read': {
        if (!existing) {
          return errorResult(
            `monitor read: page ${args.page} is not monitored. Call monitor with action="start" first.`,
          )
        }
        const events = existing.queue
        const dropped = existing.dropped
        existing.queue = []
        existing.dropped = 0
        const suffix = dropped ? ` (${dropped} dropped, queue is full)` : ''
        return textResult(`read ${events.length} events${suffix}`, {
          page: args.page,
          count: events.length,
          dropped,
          events,
        })
      }
      case 'stop': {
        if (!existing) {
          return errorResult(
            `monitor stop: page ${args.page} is not monitored.`,
          )
        }
        for (const remove of existing.removeListeners) remove()
        subs.delete(args.page)
        return textResult(`monitoring stopped for page ${args.page}`, {
          page: args.page,
        })
      }
    }
  },
})
