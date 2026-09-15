import type { BrowserSession } from '@browseros/browser-core/core/session'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { z } from 'zod'
import { defineTool, errorResult, intArg, textResult } from './framework'

const MAX_QUEUE_SIZE = 100
const DEFAULT_EVENT_TYPES = [
  'navigation',
  'loading',
  'error',
  'dom_change',
] as const
const EVENT_TYPES = ['navigation', 'loading', 'error', 'dom_change'] as const

type MonitorEventType = (typeof EVENT_TYPES)[number]

interface MonitorEvent {
  type: MonitorEventType
  timestamp: number
  details: Record<string, unknown>
}

interface Subscription {
  pageId: number
  queue: MonitorEvent[]
  removeListeners: Array<() => void>
  domTimer?: ReturnType<typeof setTimeout>
  closed: boolean
}

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
  if (subscription.closed) return
  if (subscription.queue.length >= MAX_QUEUE_SIZE) subscription.queue.shift()
  subscription.queue.push({ type, timestamp: Date.now(), details })
}

function addListener(
  session: ProtocolApi,
  domain: string,
  event: string,
  handler: (params: unknown) => void,
): () => void {
  const api = (
    session as unknown as Record<
      string,
      { on?: (name: string, callback: (params: unknown) => void) => () => void }
    >
  )[domain]
  if (!api?.on) throw new Error(`CDP ${domain} event API unavailable`)
  return api.on(event, handler)
}

export const monitor = defineTool({
  name: 'monitor',
  description:
    'Start monitoring events for a page or read the monitored events.',
  input: z.object({
    action: z.enum(['start', 'read', 'stop']).default('start'),
    page: intArg()
      .optional()
      .describe('Page id to monitor. Required for action="start" and "stop".'),
    eventTypes: z
      .array(z.enum(['navigation', 'loading', 'error', 'dom_change']))
      .optional()
      .describe('Event types to monitor. Defaults to all.'),
  }),
  handler: async (args, ctx) => {
    switch (args.action) {
      case 'start': {
        if (args.page === undefined) {
          return errorResult('monitor start: page id is required')
        }
        const session = ctx.session
        const subs = sessionSubscriptions(session)
        const sub = subs.get(args.page)
        if (sub) {
          return textResult(
            `monitoring already started for page ${args.page}`,
            { page: args.page },
          )
        }
        const newSub: Subscription = {
          pageId: args.page,
          queue: [],
          removeListeners: [],
          closed: false,
        }
        subs.set(args.page, newSub)
        const protocol = session.protocol
        if (!protocol) {
          return errorResult('monitor start: no protocol available')
        }
        const eventTypes = args.eventTypes ?? DEFAULT_EVENT_TYPES
        for (const type of eventTypes) {
          switch (type) {
            case 'navigation': {
              const remove = addListener(
                protocol,
                'Page',
                'frameNavigated',
                (params) => {
                  const typedParams = params as { frameId: string; url: string }
                  enqueue(newSub, 'navigation', {
                    frameId: typedParams.frameId,
                    url: typedParams.url,
                  })
                },
              )
              newSub.removeListeners.push(remove)
              break
            }
            case 'loading': {
              const remove1 = addListener(
                protocol,
                'Page',
                'frameStartedLoading',
                (params) => {
                  const typedParams = params as { frameId: string }
                  enqueue(newSub, 'loading', { frameId: typedParams.frameId })
                },
              )
              const remove2 = addListener(
                protocol,
                'Page',
                'frameStoppedLoading',
                (params) => {
                  const typedParams = params as { frameId: string }
                  enqueue(newSub, 'loading', {
                    frameId: typedParams.frameId,
                    stopped: true,
                  })
                },
              )
              newSub.removeListeners.push(remove1, remove2)
              break
            }
            case 'error': {
              const remove1 = addListener(
                protocol,
                'Runtime',
                'exceptionThrown',
                (params) => {
                  const typedParams = params as { exceptionDetails: unknown }
                  enqueue(newSub, 'error', {
                    exceptionDetails: typedParams.exceptionDetails,
                  })
                },
              )
              const remove2 = addListener(
                protocol,
                'Page',
                'frameFailedToLoad',
                (params) => {
                  const typedParams = params as {
                    frameId: string
                    errorText: string
                  }
                  enqueue(newSub, 'error', {
                    frameId: typedParams.frameId,
                    errorText: typedParams.errorText,
                  })
                },
              )
              newSub.removeListeners.push(remove1, remove2)
              break
            }
            case 'dom_change': {
              const remove1 = addListener(
                protocol,
                'DOM',
                'childNodeAdded',
                (params) => {
                  const typedParams = params as {
                    parentNodeId: string
                    nodeId: string
                  }
                  enqueue(newSub, 'dom_change', {
                    parentNodeId: typedParams.parentNodeId,
                    nodeId: typedParams.nodeId,
                  })
                },
              )
              const remove2 = addListener(
                protocol,
                'DOM',
                'childNodeRemoved',
                (params) => {
                  const typedParams = params as {
                    parentNodeId: string
                    nodeId: string
                  }
                  enqueue(newSub, 'dom_change', {
                    parentNodeId: typedParams.parentNodeId,
                    nodeId: typedParams.nodeId,
                  })
                },
              )
              const remove3 = addListener(
                protocol,
                'DOM',
                'characterDataModified',
                (params) => {
                  const typedParams = params as {
                    nodeId: string
                    characterData: string
                  }
                  enqueue(newSub, 'dom_change', {
                    nodeId: typedParams.nodeId,
                    characterData: typedParams.characterData,
                  })
                },
              )
              newSub.removeListeners.push(remove1, remove2, remove3)
              break
            }
          }
        }
        return textResult(`monitoring started for page ${args.page}`, {
          page: args.page,
          eventTypes,
        })
      }
      case 'read': {
        if (args.page === undefined) {
          return errorResult('monitor read: page id is required')
        }
        const session = ctx.session
        const subs = sessionSubscriptions(session)
        const sub = subs.get(args.page)
        if (!sub) {
          return errorResult(
            `monitor read: no monitoring for page ${args.page}`,
          )
        }
        const queue = sub.queue
        sub.queue = [] // clear the queue
        return textResult(`read ${queue.length} events`, { events: queue })
      }
      case 'stop': {
        if (args.page === undefined) {
          return errorResult('monitor stop: page id is required')
        }
        const session = ctx.session
        const subs = sessionSubscriptions(session)
        const sub = subs.get(args.page)
        if (!sub) {
          return errorResult(
            `monitor stop: no monitoring for page ${args.page}`,
          )
        }
        // Remove all listeners
        for (const remove of sub.removeListeners) {
          remove()
        }
        sub.removeListeners = []
        sub.closed = true
        subs.delete(args.page)
        return textResult(`monitoring stopped for page ${args.page}`, {
          page: args.page,
        })
      }
      default:
        return errorResult('monitor: unsupported action')
    }
  },
})
