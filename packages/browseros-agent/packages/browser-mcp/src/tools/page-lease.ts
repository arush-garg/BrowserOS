/**
 * Canonical page-lease interface (TS side).
 *
 * A page lease records which agent/human owns a page, when it was
 * acquired, and when it expires. Leases are a safety label with teeth:
 * an expired lease is automatically free, so a crashed agent can never
 * permanently orphan a page — the failure mode the previous
 * process-local Map (no TTL, no expiry) had.
 *
 * Canonical record shape (shared with the Rust ownership-claims layer,
 * `apps/claw-server-rust/src/api/mcp/effects/ownership_claims.rs`,
 * which carries the same fields under different names: owner =
 * session, acquiredAt = claimed_at, expiresAt = claim TTL,
 * releasedAt = released_at):
 *
 *   { page, owner, acquiredAt, expiresAt, releasedAt? }
 *
 * This file is step 1 of unification: one canonical interface + TTL +
 * a file-backed store as the cross-process enforcement path. The Rust
 * and TS-server implementations are NOT rewritten here; they should
 * adopt this record shape (and its TTL semantics) next, rather than
 * growing a third divergent lease format.
 *
 * Cross-process note: the file store is advisory, not a distributed
 * lock — two processes racing in the same millisecond can both read
 * "free". What it does guarantee, and what the in-memory Map could
 * not, is that a lease written by one process is visible to another,
 * and that an expired lease is free to every process without any
 * owner having to release it. A lock directory (mkdir, exclusive)
 * serialises writers within one machine; see FilePageLeaseStore.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_LEASE_TTL_MS = 30 * 60 * 1000 // 30 minutes

export interface PageLease {
  page: number
  owner: string
  acquiredAt: number
  expiresAt: number
  releasedAt?: number
}

export interface PageLeaseStore {
  acquire(
    page: number,
    owner: string,
    opts?: { ttlMs?: number; now?: number },
  ): { ok: boolean; owner: string; lease?: PageLease }
  release(page: number, owner: string, now?: number): boolean
  get(page: number, now?: number): PageLease | undefined
  sweepExpired(now?: number): number
}

/** In-memory store with TTL. The default store used by `tabs`. */
export class MemoryPageLeaseStore implements PageLeaseStore {
  private leases = new Map<number, PageLease>()

  acquire(
    page: number,
    owner: string,
    opts: { ttlMs?: number; now?: number } = {},
  ): { ok: boolean; owner: string; lease?: PageLease } {
    const now = opts.now ?? Date.now()
    this.sweepExpired(now)
    const existing = this.leases.get(page)
    if (existing && existing.owner !== owner)
      return { ok: false, owner: existing.owner, lease: existing }
    const lease: PageLease = {
      page,
      owner,
      acquiredAt: now,
      expiresAt: now + (opts.ttlMs ?? DEFAULT_LEASE_TTL_MS),
    }
    this.leases.set(page, lease)
    return { ok: true, owner, lease }
  }

  release(page: number, owner: string, now = Date.now()): boolean {
    const existing = this.leases.get(page)
    if (!existing || existing.owner !== owner) return false
    this.leases.delete(page)
    void now
    return true
  }

  get(page: number, now = Date.now()): PageLease | undefined {
    const lease = this.leases.get(page)
    if (lease && lease.expiresAt <= now) {
      this.leases.delete(page)
      return undefined
    }
    return lease
  }

  sweepExpired(now = Date.now()): number {
    let removed = 0
    for (const [page, lease] of this.leases) {
      if (lease.expiresAt <= now) {
        this.leases.delete(page)
        removed += 1
      }
    }
    return removed
  }
}

/**
 * File-backed store: leases persist as JSON in one file so a second
 * process (or a restarted server) sees them. Writers serialise on a
 * lock directory; reads are lock-free and always apply expiry, so a
 * stale file can never hold a page hostage. Intended for the
 * cross-process path; the in-memory store remains the default for the
 * single-process MCP server.
 */
export class FilePageLeaseStore implements PageLeaseStore {
  constructor(
    private filePath: string = join(tmpdir(), 'browseros-page-leases.json'),
  ) {}

  private lockPath(): string {
    return `${this.filePath}.lock`
  }

  private withLock<T>(fn: () => T): T {
    const lock = this.lockPath()
    const deadline = Date.now() + 2000
    while (true) {
      try {
        mkdirSync(lock)
        break
      } catch {
        if (Date.now() > deadline)
          throw new Error(`Timed out acquiring page-lease lock at ${lock}`)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
      }
    }
    try {
      return fn()
    } finally {
      try {
        rmSync(lock, { recursive: true, force: true })
      } catch {
        // Best effort: a leftover lock dir only delays the next writer
        // until its own deadline; expiry still frees the lease itself.
      }
    }
  }

  private readAll(): Record<string, PageLease> {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Record<
        string,
        PageLease
      >
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  private writeAll(all: Record<string, PageLease>): void {
    const tmp = `${this.filePath}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(all), 'utf-8')
    renameSync(tmp, this.filePath)
  }

  acquire(
    page: number,
    owner: string,
    opts: { ttlMs?: number; now?: number } = {},
  ): { ok: boolean; owner: string; lease?: PageLease } {
    const now = opts.now ?? Date.now()
    return this.withLock(() => {
      const all = this.readAll()
      const existing = all[String(page)]
      if (existing && existing.expiresAt > now && existing.owner !== owner)
        return { ok: false, owner: existing.owner, lease: existing }
      const lease: PageLease = {
        page,
        owner,
        acquiredAt: now,
        expiresAt: now + (opts.ttlMs ?? DEFAULT_LEASE_TTL_MS),
      }
      all[String(page)] = lease
      this.writeAll(all)
      return { ok: true, owner, lease }
    })
  }

  release(page: number, owner: string, now = Date.now()): boolean {
    void now
    return this.withLock(() => {
      const all = this.readAll()
      const existing = all[String(page)]
      if (!existing || existing.owner !== owner) return false
      delete all[String(page)]
      this.writeAll(all)
      return true
    })
  }

  get(page: number, now = Date.now()): PageLease | undefined {
    const lease = this.readAll()[String(page)]
    if (lease && lease.expiresAt <= now) return undefined
    return lease
  }

  sweepExpired(now = Date.now()): number {
    return this.withLock(() => {
      const all = this.readAll()
      let removed = 0
      for (const [key, lease] of Object.entries(all)) {
        if (lease.expiresAt <= now) {
          delete all[key]
          removed += 1
        }
      }
      if (removed > 0) this.writeAll(all)
      return removed
    })
  }
}

// ---------------------------------------------------------------------------
// Default store + backward-compatible function API (used by `tabs`)
// ---------------------------------------------------------------------------

const defaultStore = new MemoryPageLeaseStore()

export function acquirePageLease(
  page: number,
  owner: string,
  opts: { ttlMs?: number; now?: number } = {},
): { ok: boolean; owner: string; lease?: PageLease } {
  return defaultStore.acquire(page, owner, opts)
}

export function releasePageLease(
  page: number,
  owner: string,
  now?: number,
): boolean {
  return defaultStore.release(page, owner, now)
}

export function getPageLease(page: number, now?: number): PageLease | undefined {
  return defaultStore.get(page, now)
}

export function sweepExpiredPageLeases(now?: number): number {
  return defaultStore.sweepExpired(now)
}

export function assertPageLease(
  page: number,
  owner?: string,
  now?: number,
): string | undefined {
  const lease = defaultStore.get(page, now)
  if (!lease || lease.owner === owner) return undefined
  return `page ${page} is leased by ${lease.owner}`
}
