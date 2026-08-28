export type BrowserErrorCode =
  | 'stale_refs'
  | 'tab_destroyed'
  | 'navigation_race'
  | 'session_expired'
  | 'timeout'

export type RecoveryHint = 'snapshot_then_retry' | 'create_new_tab' | 'retry'

export interface BrowserErrorClassification {
  code: BrowserErrorCode
  recovery: RecoveryHint
  status: number
}

const PATTERNS: Array<{
  code: BrowserErrorCode
  recovery: RecoveryHint
  status: number
  patterns: readonly string[]
}> = [
  {
    code: 'stale_refs',
    recovery: 'snapshot_then_retry',
    status: 422,
    patterns: [
      'element detached',
      'no longer exists',
      'node with given id does not belong',
      'element is not attached',
    ],
  },
  {
    code: 'tab_destroyed',
    recovery: 'create_new_tab',
    status: 410,
    patterns: [
      'target closed',
      'session closed',
      'disconnected',
      'target crashed',
      'connection closed',
    ],
  },
  {
    code: 'navigation_race',
    recovery: 'snapshot_then_retry',
    status: 409,
    patterns: [
      'navigating frame was detached',
      'frame was detached',
      'frame.goto',
    ],
  },
  {
    code: 'session_expired',
    recovery: 'retry',
    status: 503,
    patterns: [
      'cdp session not found',
      'cannot find context with specified id',
      'execution context was destroyed',
    ],
  },
  {
    code: 'timeout',
    recovery: 'retry',
    status: 503,
    patterns: ['timeout', 'timed out', 'exceeded', 'waiting failed'],
  },
]

export function classifyBrowserError(
  err: unknown,
): BrowserErrorClassification | null {
  if (!(err instanceof Error)) return null
  const message = err.message.toLowerCase()
  for (const entry of PATTERNS) {
    if (entry.patterns.some((p) => message.includes(p))) {
      return {
        code: entry.code,
        recovery: entry.recovery,
        status: entry.status,
      }
    }
  }
  return null
}
