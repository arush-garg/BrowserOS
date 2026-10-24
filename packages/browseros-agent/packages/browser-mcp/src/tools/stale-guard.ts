import type { BrowserSession } from '@browseros/browser-core/core/session'
import { StaleDomGuard } from './observation-policy'

/**
 * Per-session, per-page StaleDomGuard store.
 *
 * The guard itself lives in observation-policy.ts (pure, tested there).
 * This store is the only stateful piece: one guard per (session, page),
 * keyed by a WeakMap so guards cannot outlive their browser session.
 * Navigation tools invalidate the guard for their page; queued
 * multi-action callers check their token with `action_guard` before
 * acting, and a stale token means "take a fresh snapshot first".
 */

const guards = new WeakMap<BrowserSession, Map<number, StaleDomGuard>>()

export function getStaleGuard(
  session: BrowserSession,
  page: number,
): StaleDomGuard {
  let byPage = guards.get(session)
  if (!byPage) {
    byPage = new Map<number, StaleDomGuard>()
    guards.set(session, byPage)
  }
  let guard = byPage.get(page)
  if (!guard) {
    guard = new StaleDomGuard()
    byPage.set(page, guard)
  }
  return guard
}

/** Terminate queued multi-actions for a page after a navigation event. */
export function invalidateStaleGuard(
  session: BrowserSession,
  page: number,
  reason: string,
): void {
  getStaleGuard(session, page).invalidate(reason)
}
