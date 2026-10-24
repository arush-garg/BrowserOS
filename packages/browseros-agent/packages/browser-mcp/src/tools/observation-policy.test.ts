import { describe, expect, it } from 'bun:test'
import {
  decideObservation,
  mapStableRefs,
  mapWatcherSignal,
  parseSnapshotElement,
  StaleDomError,
  StaleDomGuard,
  truncateSnapshot,
  WatcherQueue,
  isStaleTerminatingAction,
} from './observation-policy'

describe('truncateSnapshot', () => {
  it('reports dropped refs explicitly instead of silently slicing', () => {
    const text = [
      '- button "Save" [ref=e1]',
      '- link "Home" [ref=e2]',
      '- button "Delete" [ref=e3]',
    ].join('\n')
    const result = truncateSnapshot(text, 2)
    expect(result.truncated).toBe(true)
    expect(result.totalLines).toBe(3)
    expect(result.returnedLines).toBe(2)
    expect(result.droppedLines).toBe(1)
    expect(result.droppedRefs).toEqual(['e3'])
    expect(result.header).toContain('showing 2 of 3 lines')
    expect(result.header).toContain('e3')
    expect(result.text).not.toContain('Delete')
  })

  it('returns an empty header when nothing is dropped', () => {
    const result = truncateSnapshot('- button "Save" [ref=e1]', 2000)
    expect(result.truncated).toBe(false)
    expect(result.header).toBe('')
    expect(result.droppedRefs).toEqual([])
  })
})

describe('stable ref mapping', () => {
  it('maps unique fingerprints across a reload and never guesses ambiguous ones', () => {
    const before =
      '- button "Save" [ref=e1]\n- button "Save" [ref=e2]\n- link "Home" [ref=e3]'
    const after =
      '- link "Home" [ref=e9]\n- button "Save" [ref=e7]\n- button "Save" [ref=e8]'
    const result = mapStableRefs(before, after)
    // "Home" is unique on both sides; the two "Save" buttons are ambiguous.
    expect(result.mapped).toEqual({ e3: 'e9' })
    expect(result.unmatchedOldRefs).toEqual(['e1', 'e2'])
    expect(result.ambiguousFingerprints.length).toBeGreaterThan(0)
  })

  it('parses role and name from a snapshot line', () => {
    const el = parseSnapshotElement('- button "Save draft" [disabled] [ref=e4]')
    expect(el.ref).toBe('e4')
    expect(el.role).toBe('button')
    expect(el.name).toBe('Save draft')
    expect(el.fingerprint).not.toContain('[ref=')
  })
})

describe('decideObservation', () => {
  it('defaults to the AX tree', () => {
    expect(decideObservation({}).mode).toBe('ax')
  })

  it('falls back to screenshot when the snapshot fails or is empty', () => {
    expect(decideObservation({ snapshotFailed: true }).mode).toBe('screenshot')
    expect(decideObservation({ snapshotEmpty: true }).mode).toBe('screenshot')
  })

  it('adds a screenshot for canvas, image-heavy, or visual verification', () => {
    expect(decideObservation({ canvasPresent: true }).mode).toBe('ax+screenshot')
    expect(decideObservation({ imageHeavy: true }).mode).toBe('ax+screenshot')
    expect(decideObservation({ visualVerificationRequested: true }).mode).toBe(
      'ax+screenshot',
    )
  })
})

describe('StaleDomGuard', () => {
  it('rejects tokens minted before a navigation-like invalidation', () => {
    const guard = new StaleDomGuard()
    const token = guard.enqueue()
    expect(guard.isCurrent(token)).toBe(true)
    guard.invalidate('navigate url')
    expect(guard.isCurrent(token)).toBe(false)
    expect(() => guard.assertCurrent(token)).toThrow(StaleDomError)
    const fresh = guard.enqueue()
    expect(() => guard.assertCurrent(fresh)).not.toThrow()
  })

  it('classifies navigation-like actions as terminating', () => {
    for (const action of ['url', 'back', 'forward', 'reload', 'tab-switch', 'search']) {
      expect(isStaleTerminatingAction(action)).toBe(true)
    }
    expect(isStaleTerminatingAction('click')).toBe(false)
  })
})

describe('WatcherQueue and mapWatcherSignal', () => {
  it('emits, drains, and reports overflow drops', () => {
    const queue = new WatcherQueue(2)
    queue.emit({ type: 'dialog', page: 1, details: { message: 'Sure?' } })
    queue.emit({ type: 'popup', page: 1, details: { url: 'https://x.test' } })
    queue.emit({ type: 'download', page: 1, details: { state: 'began' } })
    const { events, dropped } = queue.drain()
    expect(events.map((event) => event.type)).toEqual(['popup', 'download'])
    expect(dropped).toBe(1)
    expect(queue.drain().events).toEqual([])
  })

  it('maps CDP signals to watcher types', () => {
    expect(mapWatcherSignal('javascriptDialogOpening', 1, {})?.type).toBe('dialog')
    expect(mapWatcherSignal('windowOpen', 1, {})?.type).toBe('popup')
    expect(mapWatcherSignal('downloadWillBegin', 1, {})?.type).toBe('download')
    expect(mapWatcherSignal('targetCrashed', 1, {})?.type).toBe('tab-crash')
  })
})
