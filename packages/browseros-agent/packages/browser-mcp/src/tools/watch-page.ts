import type { BrowserSession } from '@browseros/browser-core/core/session'
import { z } from 'zod/v4'
import { defineTool, errorResult, textResult } from './framework'
import {
  mapWatcherSignal,
  WatcherQueue,
  type WatcherEventType,
} from './observation-policy'

/**
 * Separate watchers for popups/dialogs, downloads, and tab crashes.
 *
 * Unlike `monitor`'s general CDP feed, this tool watches only the
 * step-blocking signals, queues them without blocking the agent loop,
 * and lets a reader drain them. A step that would otherwise hang on a
 * dialog/download/crash timeout can instead read queued watcher events
 * and react (dismiss, wait for the download, or report the crash).
 */

const WATCHER_EVENT_TYPES = ['dialog', 'popup', 'download', 'tab-crash'] as const

type WatcherProtocol = {
  Page: {
    on: (event: string, handler: (params: never) => void) => () => void
  }
  Target?: {
    on: (event: string, handler: (params: never) => void) => () => void
  }
  Inspector?: {
    on: (event: string, handler: () => void) => () => void
  }
}

interface Subscription {
  queue: WatcherQueue
  removeListeners: Array<() => void>
  eventTypes: readonly WatcherEventType[]
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

function listen(
  protocol: WatcherProtocol,
  page: number,
  type: WatcherEventType,
  emit: (type: WatcherEventType, details: Record<string, unknown>) => void,
): Array<() => void> {
  switch (type) {
    case 'dialog':
      return [
        protocol.Page.on('javascriptDialogOpening', (params) => {
          const p = params as unknown as Record<string, unknown>
          emit('dialog', {
            message: p.message,
            dialogType: p.type,
            url: p.url,
          })
        }),
      ]
    case 'popup':
      return [
        protocol.Page.on('windowOpen', (params) => {
          const p = params as unknown as Record<string, unknown>
          emit('popup', { url: p.url, windowName: p.windowName })
        }),
      ]
    case 'download':
      return [
        protocol.Page.on('downloadWillBegin', (params) => {
          const p = params as unknown as Record<string, unknown>
          emit('download', {
            state: 'began',
            guid: p.guid,
            suggestedFilename: p.suggestedFilename,
          })
        }),
        protocol.Page.on('downloadProgress', (params) => {
          const p = params as unknown as Record<string, unknown>
          emit('download', {
            state: p.state,
            guid: p.guid,
            receivedBytes: p.receivedBytes,
            totalBytes: p.totalBytes,
          })
        }),
      ]
    case 'tab-crash': {
      if (protocol.Target) {
        return [
          protocol.Target.on('targetCrashed', (params) => {
            const p = params as unknown as Record<string, unknown>
            emit('tab-crash', {
              targetId: p.targetId,
              status: p.status,
              errorCode: p.errorCode,
            })
          }),
        ]
      }
      if (protocol.Inspector) {
        return [
          protocol.Inspector.on('targetCrashed', () => {
            emit('tab-crash', {})
          }),
        ]
      }
      return []
    }
  }
}

export const watch_page = defineTool({
  name: 'watch_page',
  description:
    'Watch a page for step-blocking signals without blocking: JavaScript dialogs, popups (window.open), downloads, and tab crashes. action="start" subscribes, "read" drains queued events since the last read, "stop" unsubscribes. Events queue up to 100 and report how many were dropped, so a busy page cannot grow the queue without bound.',
  input: z
    .object({
      action: z
        .enum(['start', 'read', 'stop'])
        .default('start')
        .describe('Subscribe, drain queued events, or unsubscribe.'),
      page: z.number().int().describe('Page id from `tabs`.'),
      eventTypes: z
        .array(z.enum(WATCHER_EVENT_TYPES))
        .nonempty()
        .optional()
        .describe('Event types to watch on "start". Defaults to all four.'),
    })
    .strict(),
  annotations: { title: 'Watch page signals', readOnlyHint: true },
  handler: async (args, ctx) => {
    const subs = sessionSubscriptions(ctx.session)
    const existing = subs.get(args.page)

    switch (args.action) {
      case 'start': {
        if (existing) {
          return textResult(
            `watching already started for page ${args.page} (${existing.eventTypes.join(', ')})`,
            { page: args.page, eventTypes: existing.eventTypes },
          )
        }
        const eventTypes = args.eventTypes ?? WATCHER_EVENT_TYPES
        const queue = new WatcherQueue()
        const { session } = await ctx.session.pages.getSession(args.page)
        const protocol = session as unknown as WatcherProtocol
        const emit = (
          type: WatcherEventType,
          details: Record<string, unknown>,
        ) => {
          const event = mapWatcherSignal(
            type === 'dialog'
              ? 'javascriptDialogOpening'
              : type === 'popup'
                ? 'windowOpen'
                : type === 'download'
                  ? 'downloadWillBegin'
                  : 'targetCrashed',
            args.page,
            details,
          )
          if (event) queue.emit(event)
        }
        const removeListeners: Array<() => void> = []
        for (const type of eventTypes) {
          removeListeners.push(...listen(protocol, args.page, type, emit))
        }
        subs.set(args.page, { queue, removeListeners, eventTypes })
        return textResult(
          `watching started for page ${args.page} (${eventTypes.join(', ')})`,
          { page: args.page, eventTypes },
        )
      }
      case 'read': {
        if (!existing) {
          return errorResult(
            `watch_page read: page ${args.page} is not watched. Call watch_page with action="start" first.`,
          )
        }
        const { events, dropped } = existing.queue.drain()
        const suffix = dropped ? ` (${dropped} dropped, queue was full)` : ''
        return textResult(`read ${events.length} watcher events${suffix}`, {
          page: args.page,
          count: events.length,
          dropped,
          events,
        })
      }
      case 'stop': {
        if (!existing) {
          return errorResult(
            `watch_page stop: page ${args.page} is not watched.`,
          )
        }
        for (const remove of existing.removeListeners) remove()
        subs.delete(args.page)
        return textResult(`watching stopped for page ${args.page}`, {
          page: args.page,
        })
      }
    }
  },
})
