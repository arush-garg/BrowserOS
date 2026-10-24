import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FilePageLeaseStore,
  MemoryPageLeaseStore,
  assertPageLease,
  acquirePageLease,
  getPageLease,
  releasePageLease,
} from './page-lease'

describe('page leases with TTL', () => {
  it('an expired lease is automatically free', () => {
    const store = new MemoryPageLeaseStore()
    store.acquire(1, 'agent-a', { ttlMs: 1000, now: 1000 })
    expect(store.get(1, 1500)?.owner).toBe('agent-a')
    expect(store.get(1, 2500)).toBeUndefined()
    const reacquired = store.acquire(1, 'agent-b', { now: 2500 })
    expect(reacquired.ok).toBe(true)
    expect(reacquired.owner).toBe('agent-b')
  })

  it('an unexpired lease still blocks a different owner', () => {
    const store = new MemoryPageLeaseStore()
    store.acquire(2, 'agent-a', { ttlMs: 60_000, now: 1000 })
    const attempt = store.acquire(2, 'agent-b', { now: 2000 })
    expect(attempt.ok).toBe(false)
    expect(attempt.owner).toBe('agent-a')
  })

  it('sweepExpired removes only expired leases and reports the count', () => {
    const store = new MemoryPageLeaseStore()
    store.acquire(3, 'agent-a', { ttlMs: 1000, now: 1000 })
    store.acquire(4, 'agent-b', { ttlMs: 60_000, now: 1000 })
    expect(store.sweepExpired(2000)).toBe(1)
    expect(store.get(3, 2000)).toBeUndefined()
    expect(store.get(4, 2000)?.owner).toBe('agent-b')
  })

  it('re-acquiring as the same owner refreshes the lease', () => {
    const store = new MemoryPageLeaseStore()
    store.acquire(5, 'agent-a', { ttlMs: 1000, now: 1000 })
    const refreshed = store.acquire(5, 'agent-a', { ttlMs: 60_000, now: 1500 })
    expect(refreshed.ok).toBe(true)
    expect(store.get(5, 2000)?.owner).toBe('agent-a')
  })

  it('release still requires ownership', () => {
    const store = new MemoryPageLeaseStore()
    store.acquire(6, 'agent-a', { now: 1000 })
    expect(store.release(6, 'agent-b', 1001)).toBe(false)
    expect(store.release(6, 'agent-a', 1001)).toBe(true)
  })

  it('file store: a second instance sees the lease, and expiry frees it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-lease-test-'))
    const file = join(dir, 'leases.json')
    const first = new FilePageLeaseStore(file)
    const second = new FilePageLeaseStore(file)
    first.acquire(7, 'agent-a', { ttlMs: 1000, now: 1000 })
    expect(second.get(7, 1500)?.owner).toBe('agent-a')
    expect(second.acquire(7, 'agent-b', { now: 1500 }).ok).toBe(false)
    // After expiry, the other "process" can acquire without a release.
    expect(second.acquire(7, 'agent-b', { now: 2500 }).ok).toBe(true)
    expect(first.get(7, 2500)?.owner).toBe('agent-b')
  })

  it('default module store keeps the old tabs API working', () => {
    const acquired = acquirePageLease(99, 'tabs-test-owner', { ttlMs: 60_000 })
    expect(acquired.ok).toBe(true)
    expect(getPageLease(99)?.owner).toBe('tabs-test-owner')
    expect(assertPageLease(99, 'other-owner')).toContain('tabs-test-owner')
    expect(assertPageLease(99, 'tabs-test-owner')).toBeUndefined()
    expect(releasePageLease(99, 'tabs-test-owner')).toBe(true)
    expect(getPageLease(99)).toBeUndefined()
  })
})
