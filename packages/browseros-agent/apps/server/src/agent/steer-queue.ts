export interface SteerMessage {
  id: string
  text: string
  enqueuedAt: number
}

const MAX_PER_CONVERSATION = 10

/**
 * In-process FIFO queue of steer messages keyed by conversationId.
 * Steers are queued by the /chat/:conversationId/steer endpoint and drained
 * inside prepareStep (before each model call) so the model sees them
 * immediately after the most recent tool result.
 *
 * Thread safety: Bun runs JS single-threaded; no locks required.
 */
export class SteerQueue {
  private readonly queues = new Map<string, SteerMessage[]>()

  enqueue(
    conversationId: string,
    text: string,
  ): { ok: true; steerId: string } | { ok: false; error: string } {
    const queue = this.queues.get(conversationId) ?? []
    if (queue.length >= MAX_PER_CONVERSATION) {
      return {
        ok: false,
        error:
          'Steer queue full — wait for the agent to process pending steers',
      }
    }
    const msg: SteerMessage = {
      id: crypto.randomUUID(),
      text,
      enqueuedAt: Date.now(),
    }
    queue.push(msg)
    this.queues.set(conversationId, queue)
    return { ok: true, steerId: msg.id }
  }

  /** Atomically returns and clears all pending steers. Call from prepareStep. */
  drain(conversationId: string): SteerMessage[] {
    const queue = this.queues.get(conversationId)
    if (!queue || queue.length === 0) return []
    this.queues.delete(conversationId)
    return queue
  }

  /** Returns pending steers without consuming them (for status checks). */
  peek(conversationId: string): SteerMessage[] {
    return this.queues.get(conversationId) ?? []
  }

  /** Remove all pending steers — call on session delete / conversation reset. */
  clear(conversationId: string): void {
    this.queues.delete(conversationId)
  }

  has(conversationId: string): boolean {
    return (this.queues.get(conversationId)?.length ?? 0) > 0
  }
}
