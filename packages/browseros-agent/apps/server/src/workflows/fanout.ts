/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface FanOutShard<T> {
  workerIndex: number
  /** Isolated tab identity for this worker; workers never share a tab. */
  tabId: string
  items: T[]
}

export interface FanOutWorkerContext<T, C> {
  workerIndex: number
  tabId: string
  items: T[]
  /** Deep copy of the caller's context: a worker mutating it cannot leak
   *  into another worker or back into the parent. */
  context: C
}

export interface MergedResult<R> {
  rows: R[]
  duplicates: number
  perWorkerCounts: number[]
  errors: { workerIndex: number; error: string }[]
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Split items into balanced shards; more workers than items yields one shard per item. */
export function shardList<T>(items: T[], workerCount: number): FanOutShard<T>[] {
  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error('workerCount must be an integer >= 1')
  }
  if (items.length === 0) return []
  const shards = Math.min(workerCount, items.length)
  const base = Math.floor(items.length / shards)
  const remainder = items.length % shards
  const out: FanOutShard<T>[] = []
  let offset = 0
  for (let i = 0; i < shards; i++) {
    const size = base + (i < remainder ? 1 : 0)
    out.push({
      workerIndex: i,
      tabId: `worker-${i}-tab`,
      items: items.slice(offset, offset + size),
    })
    offset += size
  }
  return out
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Synthesis / merge step: concatenate worker rows in worker order and
 * deduplicate by key, first occurrence wins. Deduplication is by the
 * caller's key function (id, URL, or title), never by object identity.
 */
export function mergeResults<R>(
  workerRows: R[][],
  keyFn: (row: R) => string,
): Omit<MergedResult<R>, 'errors'> {
  const seen = new Set<string>()
  const rows: R[] = []
  let duplicates = 0
  const perWorkerCounts: number[] = []
  for (const workerRow of workerRows) {
    perWorkerCounts.push(workerRow.length)
    for (const row of workerRow) {
      const key = normalizeKey(keyFn(row))
      if (seen.has(key)) {
        duplicates++
        continue
      }
      seen.add(key)
      rows.push(row)
    }
  }
  return { rows, duplicates, perWorkerCounts }
}

/**
 * Run workers in parallel over shards, each with an isolated tab and a
 * deep-copied context, then merge. A failing worker does not kill the
 * other shards: its error is recorded and its rows are simply absent.
 */
export async function runFanOut<T, C, R>(
  items: T[],
  workerCount: number,
  worker: (ctx: FanOutWorkerContext<T, C>) => Promise<R[]>,
  context: C,
  keyFn: (row: R) => string,
): Promise<MergedResult<R>> {
  const shards = shardList(items, workerCount)
  const results = await Promise.all(
    shards.map(async (shard) => {
      try {
        const rows = await worker({
          workerIndex: shard.workerIndex,
          tabId: shard.tabId,
          items: shard.items,
          context: deepClone(context),
        })
        return { workerIndex: shard.workerIndex, rows, error: undefined as string | undefined }
      } catch (error) {
        return {
          workerIndex: shard.workerIndex,
          rows: [] as R[],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  )
  results.sort((a, b) => a.workerIndex - b.workerIndex)
  const merged = mergeResults(
    results.map((r) => r.rows),
    keyFn,
  )
  return {
    ...merged,
    errors: results
      .filter((r) => r.error !== undefined)
      .map((r) => ({ workerIndex: r.workerIndex, error: r.error as string })),
  }
}
