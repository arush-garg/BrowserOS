/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Append-only event log for the apps/server agent loop.
 *
 * Every action, observation, error, decision, and plan change is one
 * immutable, sequence-numbered event. State is rebuilt by replaying the
 * log — never by editing it — so a crashed or restarted run can be
 * inspected and resumed from its own evidence instead of from chat
 * history. The JSONL form is the persistence format: one JSON object
 * per line, in sequence order.
 *
 * This module is dependency-free. It deliberately has no file I/O:
 * callers own where the JSONL lives (disk, session store, dashboard).
 */

export type AgentEventKind =
  | 'action'
  | 'observation'
  | 'error'
  | 'decision'
  | 'plan'

export interface AgentEvent {
  /** 1-based, contiguous sequence number assigned on append. */
  seq: number
  /** ISO-8601 timestamp assigned on append. */
  timestamp: string
  kind: AgentEventKind
  /** Free-form payload; must be JSON-serializable. */
  detail: Record<string, unknown>
}

export interface AppendEventOptions {
  /** Override the append timestamp (tests / replay). Defaults to now. */
  timestamp?: string
}

const EVENT_KINDS: readonly AgentEventKind[] = [
  'action',
  'observation',
  'error',
  'decision',
  'plan',
]

function isAgentEventKind(value: unknown): value is AgentEventKind {
  return (
    typeof value === 'string' &&
    (EVENT_KINDS as readonly string[]).includes(value)
  )
}

function isJsonSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value)
    return true
  } catch {
    return false
  }
}

export class EventLog {
  private readonly _events: AgentEvent[] = []

  get length(): number {
    return this._events.length
  }

  /**
   * Append one event. Returns a frozen copy; the stored event is never
   * mutated afterwards, and there is intentionally no update/delete API.
   */
  append(
    kind: AgentEventKind,
    detail: Record<string, unknown>,
    options: AppendEventOptions = {},
  ): Readonly<AgentEvent> {
    if (!isAgentEventKind(kind)) {
      throw new Error(`Unknown agent event kind: ${String(kind)}`)
    }
    if (!isJsonSerializable(detail)) {
      throw new Error('Agent event detail must be JSON-serializable')
    }
    const event: AgentEvent = {
      seq: this._events.length + 1,
      timestamp: options.timestamp ?? new Date().toISOString(),
      kind,
      detail: JSON.parse(JSON.stringify(detail)) as Record<string, unknown>,
    }
    this._events.push(event)
    return Object.freeze({ ...event, detail: { ...event.detail } })
  }

  /** All events in sequence order (copies, so replay cannot mutate the log). */
  replay(): AgentEvent[] {
    return this._events.map((event) => ({
      ...event,
      detail: { ...event.detail },
    }))
  }

  /** Events of one kind, in sequence order. */
  ofKind(kind: AgentEventKind): AgentEvent[] {
    return this.replay().filter((event) => event.kind === kind)
  }

  /** One JSON object per line, in sequence order. Empty log -> empty string. */
  toJSONL(): string {
    return this._events.map((event) => JSON.stringify(event)).join('\n')
  }

  /**
   * Rebuild a log from JSONL. Rejects malformed lines, unknown kinds,
   * and any sequence that is not 1, 2, 3, ... contiguous — a gap means
   * the persisted log is truncated or corrupted, and silently accepting
   * it would make replay lie about what happened.
   */
  static fromJSONL(jsonl: string): EventLog {
    const log = new EventLog()
    const lines = jsonl.split('\n').filter((line) => line.trim() !== '')
    for (const [index, line] of lines.entries()) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line) as unknown
      } catch {
        throw new Error(`Invalid JSONL agent event at line ${index + 1}`)
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(`Invalid agent event at line ${index + 1}`)
      }
      const record = parsed as Record<string, unknown>
      if (record.seq !== index + 1) {
        throw new Error(
          `Agent event sequence gap at line ${index + 1}: expected seq ${index + 1}, got ${String(record.seq)}`,
        )
      }
      if (!isAgentEventKind(record.kind)) {
        throw new Error(`Unknown agent event kind at line ${index + 1}`)
      }
      if (
        typeof record.timestamp !== 'string' ||
        typeof record.detail !== 'object' ||
        record.detail === null ||
        Array.isArray(record.detail)
      ) {
        throw new Error(`Invalid agent event shape at line ${index + 1}`)
      }
      log._events.push({
        seq: record.seq,
        timestamp: record.timestamp,
        kind: record.kind,
        detail: record.detail as Record<string, unknown>,
      })
    }
    return log
  }
}

export function createEventLog(): EventLog {
  return new EventLog()
}
