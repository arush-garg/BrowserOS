import { describe, expect, test } from 'bun:test'
import { mergeResults, runFanOut, shardList } from '../../src/workflows/fanout'

describe('shardList', () => {
  test('balances shards and caps workers at item count', () => {
    const shards = shardList([1, 2, 3, 4, 5, 6, 7], 3)
    expect(shards.map((s) => s.items.length)).toEqual([3, 2, 2])
    expect(shards.map((s) => s.tabId)).toEqual([
      'worker-0-tab',
      'worker-1-tab',
      'worker-2-tab',
    ])
    expect(shardList([1, 2], 5)).toHaveLength(2)
    expect(shardList([], 3)).toEqual([])
    expect(() => shardList([1], 0)).toThrow('workerCount')
  })
})

describe('mergeResults', () => {
  test('dedupes by key, first wins, case-insensitive', () => {
    const merged = mergeResults(
      [
        [{ id: 'Acme' }, { id: 'Beta' }],
        [{ id: 'acme' }, { id: 'Gamma' }],
      ],
      (r) => r.id,
    )
    expect(merged.rows.map((r) => r.id)).toEqual(['Acme', 'Beta', 'Gamma'])
    expect(merged.duplicates).toBe(1)
    expect(merged.perWorkerCounts).toEqual([2, 2])
  })
})

describe('runFanOut', () => {
  test('workers get isolated tabs and deep-copied context', async () => {
    const seen: { tabId: string; mutated: boolean }[] = []
    const result = await runFanOut(
      ['a', 'b', 'c', 'd'],
      2,
      async (ctx) => {
        // Mutating this worker's context must not leak to the other worker.
        ;(ctx.context as { notes: string[] }).notes.push(ctx.tabId)
        seen.push({ tabId: ctx.tabId, mutated: true })
        return ctx.items.map((item) => ({ id: item }))
      },
      { notes: [] as string[] },
      (r) => r.id,
    )
    expect(result.rows.map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(result.errors).toEqual([])
    expect(seen.map((s) => s.tabId).sort()).toEqual([
      'worker-0-tab',
      'worker-1-tab',
    ])
  })

  test('one failing worker does not kill the other shards', async () => {
    const result = await runFanOut(
      ['a', 'b'],
      2,
      async (ctx) => {
        if (ctx.workerIndex === 0) throw new Error('boom')
        return ctx.items.map((item) => ({ id: item }))
      },
      {},
      (r) => r.id,
    )
    expect(result.rows.map((r) => r.id)).toEqual(['b'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toBe('boom')
  })
})
