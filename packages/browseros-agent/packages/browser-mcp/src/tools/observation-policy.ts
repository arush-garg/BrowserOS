/**
 * Pure observation policy helpers for the browser-MCP tool layer.
 *
 * Everything here is deliberately browser-free: it operates on snapshot
 * text and small signal objects, so it is unit-testable without Chrome.
 * Browser-facing tools (snapshot, observe_page, watch_page, extract)
 * import these helpers and keep their CDP calls thin.
 *
 * These helpers do NOT change click execution. They only make what the
 * agent saw — and what it did not see — explicit.
 */

const REF_PATTERN = /\[ref=(e\d+)\]/g

export interface SnapshotElement {
  ref?: string
  /** Snapshot line with the ref stripped and whitespace collapsed. */
  fingerprint: string
  role?: string
  name?: string
}

/** Parse one snapshot line into its ref and a reload-stable fingerprint. */
export function parseSnapshotElement(line: string): SnapshotElement {
  const refMatch = line.match(/\[ref=(e\d+)\]/)
  const withoutRef = line.replace(/\[ref=e\d+\]/, '').trim()
  const fingerprint = withoutRef.replace(/\s+/g, ' ')
  const roleMatch = withoutRef.trim().match(/^-\s+(\S+)/)
  const nameMatch = withoutRef.match(/"([^"]*)"/)
  return {
    ...(refMatch ? { ref: refMatch[1] } : {}),
    fingerprint,
    ...(roleMatch ? { role: roleMatch[1] } : {}),
    ...(nameMatch ? { name: nameMatch[1] } : {}),
  }
}

export interface TruncatedSnapshot {
  text: string
  totalLines: number
  returnedLines: number
  truncated: boolean
  droppedLines: number
  /** Refs on dropped lines, in dropped-line order. */
  droppedRefs: string[]
  /** Human-readable header, or '' when nothing was dropped. */
  header: string
}

/**
 * Slice a snapshot to maxLines and — unlike a silent slice — report exactly
 * which interactive refs fell off the end. Callers must surface `header`
 * so an agent never mistakes "not in my snapshot" for "not on the page".
 */
export function truncateSnapshot(
  text: string,
  maxLines: number,
): TruncatedSnapshot {
  const lines = text ? text.split('\n') : []
  const returned = lines.slice(0, maxLines)
  const dropped = lines.slice(maxLines)
  const droppedRefs: string[] = []
  for (const line of dropped) {
    for (const match of line.matchAll(REF_PATTERN)) droppedRefs.push(match[1])
  }
  const truncated = dropped.length > 0
  return {
    text: returned.join('\n'),
    totalLines: lines.length,
    returnedLines: returned.length,
    truncated,
    droppedLines: dropped.length,
    droppedRefs,
    header: truncated
      ? `[snapshot truncated: showing ${returned.length} of ${lines.length} lines; ${droppedRefs.length} interactive ref(s) dropped${droppedRefs.length > 0 ? `: ${droppedRefs.join(', ')}` : ''} — re-snapshot with a larger maxLines, or use search_page/find_elements to reach dropped targets]`
      : '',
  }
}

export interface StableRefMapping {
  /** Old ref -> new ref, only for fingerprints unique in both snapshots. */
  mapped: Record<string, string>
  /** Fingerprints that matched more than one element on either side. */
  ambiguousFingerprints: string[]
  /** Old refs whose fingerprint did not survive (or was ambiguous). */
  unmatchedOldRefs: string[]
}

/**
 * Map refs across two snapshots of the same page (e.g. across a reload).
 * A fingerprint is role + name + states + value, ref stripped. Only
 * fingerprints that occur exactly once on both sides are mapped; ambiguous
 * or missing ones are reported, never guessed, so a caller cannot silently
 * click the wrong "Save" button after a reload.
 */
export function mapStableRefs(
  previousText: string,
  currentText: string,
): StableRefMapping {
  const previous = previousText
    .split('\n')
    .map(parseSnapshotElement)
    .filter((el) => el.ref !== undefined)
  const current = currentText
    .split('\n')
    .map(parseSnapshotElement)
    .filter((el) => el.ref !== undefined)

  const countBy = (elements: SnapshotElement[]): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const el of elements)
      counts.set(el.fingerprint, (counts.get(el.fingerprint) ?? 0) + 1)
    return counts
  }
  const previousCounts = countBy(previous)
  const currentCounts = countBy(current)

  const mapped: Record<string, string> = {}
  const ambiguous = new Set<string>()
  const unmatchedOldRefs: string[] = []
  const currentByFingerprint = new Map<string, string>()
  for (const el of current) {
    if (currentCounts.get(el.fingerprint) === 1 && el.ref)
      currentByFingerprint.set(el.fingerprint, el.ref)
  }
  for (const el of previous) {
    if (!el.ref) continue
    if (
      previousCounts.get(el.fingerprint) !== 1 ||
      currentCounts.get(el.fingerprint) !== 1
    ) {
      ambiguous.add(el.fingerprint)
      unmatchedOldRefs.push(el.ref)
      continue
    }
    const next = currentByFingerprint.get(el.fingerprint)
    if (next) mapped[el.ref] = next
    else unmatchedOldRefs.push(el.ref)
  }
  return {
    mapped,
    ambiguousFingerprints: [...ambiguous],
    unmatchedOldRefs,
  }
}

export type ObservationMode = 'ax' | 'screenshot' | 'ax+screenshot'

export interface ObservationSignals {
  snapshotFailed?: boolean
  snapshotEmpty?: boolean
  canvasPresent?: boolean
  imageHeavy?: boolean
  visualVerificationRequested?: boolean
}

export interface ObservationDecision {
  mode: ObservationMode
  reason: string
}

/**
 * Adaptive observation policy: the accessibility tree is the cheap default.
 * A screenshot is used only as a fallback when the tree failed/empty, or
 * alongside the tree for canvas / image-heavy pages / explicit visual
 * verification. Never screenshot on every step by default.
 */
export function decideObservation(
  signals: ObservationSignals,
): ObservationDecision {
  if (signals.snapshotFailed)
    return {
      mode: 'screenshot',
      reason: 'accessibility snapshot failed; falling back to screenshot',
    }
  if (signals.snapshotEmpty)
    return {
      mode: 'screenshot',
      reason: 'accessibility snapshot was empty; falling back to screenshot',
    }
  if (
    signals.canvasPresent ||
    signals.imageHeavy ||
    signals.visualVerificationRequested
  ) {
    const reasons = [
      signals.canvasPresent ? 'canvas present' : undefined,
      signals.imageHeavy ? 'image-heavy page' : undefined,
      signals.visualVerificationRequested
        ? 'visual verification requested'
        : undefined,
    ].filter(Boolean)
    return {
      mode: 'ax+screenshot',
      reason: `accessibility tree plus annotated screenshot (${reasons.join(', ')})`,
    }
  }
  return { mode: 'ax', reason: 'accessibility tree is sufficient' }
}

/** Navigation-like actions that must terminate a queued multi-action run. */
export const STALE_TERMINATING_ACTIONS: readonly string[] = [
  'url',
  'back',
  'forward',
  'reload',
  'tab-switch',
  'search',
]

export function isStaleTerminatingAction(action: string): boolean {
  return STALE_TERMINATING_ACTIONS.includes(action)
}

/** Error thrown when a queued action is attempted after a stale event. */
export class StaleDomError extends Error {
  constructor(reason: string) {
    super(
      `stale snapshot: ${reason} — queued actions were dropped; take a fresh snapshot before acting`,
    )
    this.name = 'StaleDomError'
  }
}

/**
 * Generation guard for queued multi-actions. A navigation, search, back,
 * forward, reload, or tab switch bumps the generation; any token minted
 * before that bump is rejected instead of executing against a dead DOM.
 * This is the queue-level counterpart to ref invalidation on navigation.
 */
export class StaleDomGuard {
  private generation = 0
  private lastReason?: string

  currentGeneration(): number {
    return this.generation
  }

  /** Mint a token for a queued action; it is valid only at this generation. */
  enqueue(): { generation: number } {
    return { generation: this.generation }
  }

  /** Bump the generation for a navigation-like event. */
  invalidate(reason: string): void {
    this.generation += 1
    this.lastReason = reason
  }

  /** Throw StaleDomError unless the token matches the current generation. */
  assertCurrent(token: { generation: number }): void {
    if (token.generation !== this.generation) {
      throw new StaleDomError(
        this.lastReason ?? 'page changed since the action was queued',
      )
    }
  }

  isCurrent(token: { generation: number }): boolean {
    return token.generation === this.generation
  }
}

export type WatcherEventType =
  | 'dialog'
  | 'popup'
  | 'download'
  | 'tab-crash'

export interface WatcherEvent {
  type: WatcherEventType
  timestamp: number
  page: number
  details: Record<string, unknown>
}

const MAX_WATCHER_QUEUE = 100

/**
 * Bounded, draining event queue for browser watchers. Emitting never
 * blocks a step: events queue up and a reader drains them; overflow drops
 * the oldest and is reported on the next drain, like `monitor`.
 */
export class WatcherQueue {
  private queue: WatcherEvent[] = []
  private dropped = 0

  constructor(private readonly maxSize: number = MAX_WATCHER_QUEUE) {}

  emit(event: Omit<WatcherEvent, 'timestamp'> & { timestamp?: number }): void {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift()
      this.dropped += 1
    }
    this.queue.push({
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    })
  }

  drain(): { events: WatcherEvent[]; dropped: number } {
    const events = this.queue
    const dropped = this.dropped
    this.queue = []
    this.dropped = 0
    return { events, dropped }
  }

  get size(): number {
    return this.queue.length
  }
}

/** Map a raw CDP-ish signal to a watcher event type, or null if unknown. */
export function mapWatcherSignal(
  kind:
    | 'javascriptDialogOpening'
    | 'windowOpen'
    | 'downloadWillBegin'
    | 'downloadProgress'
    | 'targetCrashed',
  page: number,
  details: Record<string, unknown> = {},
): WatcherEvent | null {
  switch (kind) {
    case 'javascriptDialogOpening':
      return { type: 'dialog', timestamp: Date.now(), page, details }
    case 'windowOpen':
      return { type: 'popup', timestamp: Date.now(), page, details }
    case 'downloadWillBegin':
    case 'downloadProgress':
      return { type: 'download', timestamp: Date.now(), page, details }
    case 'targetCrashed':
      return { type: 'tab-crash', timestamp: Date.now(), page, details }
    default:
      return null
  }
}
