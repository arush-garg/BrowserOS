/**
 * @license
 * Copyright 2025 BrowserOS
 *
 * Steer Queue — Test Suite
 *
 * Tests for the in-process FIFO steer queue used to inject mid-turn
 * guidance into the agent conversation.
 */

import { describe, expect, it } from 'bun:test'
import { SteerQueue } from '../../src/agent/steer-queue'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueue(): SteerQueue {
  return new SteerQueue()
}

// ---------------------------------------------------------------------------
// enqueue / drain
// ---------------------------------------------------------------------------

describe('enqueue + drain', () => {
  it('returns ok=true with a steerId on successful enqueue', () => {
    const q = makeQueue()
    const result = q.enqueue('conv-1', 'go left')
    expect(result.ok).toBe(true)
    if (result.ok) expect(typeof result.steerId).toBe('string')
  })

  it('drain returns enqueued messages and empties the queue', () => {
    const q = makeQueue()
    q.enqueue('conv-1', 'first steer')
    q.enqueue('conv-1', 'second steer')

    const drained = q.drain('conv-1')
    expect(drained).toHaveLength(2)
    expect(drained[0].text).toBe('first steer')
    expect(drained[1].text).toBe('second steer')

    // Queue should now be empty
    expect(q.peek('conv-1')).toHaveLength(0)
    expect(q.drain('conv-1')).toEqual([])
  })

  it('drain on empty queue returns empty array', () => {
    const q = makeQueue()
    expect(q.drain('nonexistent')).toEqual([])
  })

  it('drain is keyed by conversationId — other queues are unaffected', () => {
    const q = makeQueue()
    q.enqueue('conv-a', 'a1')
    q.enqueue('conv-b', 'b1')

    const aSteers = q.drain('conv-a')
    expect(aSteers).toHaveLength(1)
    expect(aSteers[0].text).toBe('a1')

    const bSteers = q.drain('conv-b')
    expect(bSteers).toHaveLength(1)
    expect(bSteers[0].text).toBe('b1')

    // Draining 'a' again returns empty
    expect(q.drain('conv-a')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// peek
// ---------------------------------------------------------------------------

describe('peek', () => {
  it('returns pending steers without consuming them', () => {
    const q = makeQueue()
    q.enqueue('conv-1', 'keep me')

    expect(q.peek('conv-1')).toHaveLength(1)
    // Still there after peek
    expect(q.peek('conv-1')).toHaveLength(1)
    expect(q.drain('conv-1')).toHaveLength(1)
  })

  it('returns empty array for unknown conversation', () => {
    const q = makeQueue()
    expect(q.peek('ghost')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('removes all pending steers for a conversation', () => {
    const q = makeQueue()
    q.enqueue('conv-1', 'steer-1')
    q.enqueue('conv-1', 'steer-2')
    q.clear('conv-1')

    expect(q.peek('conv-1')).toHaveLength(0)
    expect(q.drain('conv-1')).toEqual([])
  })

  it('clear is a no-op for unknown conversation', () => {
    const q = makeQueue()
    q.clear('ghost') // should not throw
    expect(q.has('ghost')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// has
// ---------------------------------------------------------------------------

describe('has', () => {
  it('returns true when queue has messages', () => {
    const q = makeQueue()
    q.enqueue('conv-1', 'x')
    expect(q.has('conv-1')).toBe(true)
  })

  it('returns false when queue is empty', () => {
    const q = makeQueue()
    expect(q.has('conv-1')).toBe(false)
    q.enqueue('conv-1', 'x')
    q.drain('conv-1')
    expect(q.has('conv-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// capacity limit
// ---------------------------------------------------------------------------

describe('capacity limit', () => {
  it('rejects enqueue when queue has MAX_PER_CONVERSATION messages', () => {
    const q = makeQueue()
    for (let i = 0; i < 10; i++) {
      const result = q.enqueue('conv-1', `steer-${i}`)
      expect(result.ok).toBe(true)
    }
    // 10th enqueue should succeed, 11th should fail
    const full = q.enqueue('conv-1', 'overflow')
    expect(full.ok).toBe(false)
    if (!full.ok) expect(full.error).toContain('queue full')
  })

  it('capacity is per-conversation — draining one does not free another', () => {
    const q = makeQueue()
    for (let i = 0; i < 10; i++) {
      q.enqueue('conv-a', `a-${i}`)
    }
    const q2 = q.enqueue('conv-a', 'overflow')
    expect(q2.ok).toBe(false)

    // Drain conv-a, then add again
    q.drain('conv-a')
    const ok = q.enqueue('conv-a', 'new')
    expect(ok.ok).toBe(true)
  })
})
