/**
 * Unified task trace: one timeline per task tying together what
 * previously lived in three separate logs —
 *   - host-LLM turns (prompt / tool-call / response summaries),
 *   - tool decisions and their confidences (e.g. semantic_action),
 *   - AX snapshot diffs, screenshots (metadata only — never image
 *     bytes, which would bloat the trace and leak page content),
 *   - CDP errors.
 *
 * The trace is append-only and serialisable to JSONL, so a failed
 * task at step 37 can be inspected as one timeline instead of
 * correlating three logs by hand. Secrets are never recorded: any
 * field value that looks like a credential is replaced at append time
 * (see `redactValue` — key-name based, deliberately broad).
 */

export type TraceEventKind =
  | 'llm-turn'
  | 'tool-decision'
  | 'ax-diff'
  | 'screenshot'
  | 'cdp-error'
  | 'approval'
  | 'cart-review'
  | 'lease'
  | 'note'

export interface TraceEvent {
  seq: number
  taskId: string
  kind: TraceEventKind
  at: number
  /** Short human-readable summary, e.g. "clicked [e12] Search". */
  summary: string
  /** Structured detail. Screenshot events carry metadata only. */
  detail?: Record<string, unknown>
  /** Decision confidence in [0, 1], when the event carries one. */
  confidence?: number
  error?: string
}

const SENSITIVE_KEY = /(password|passwd|secret|token|api[-_]?key|auth|credential|card|ssn)/i

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[redacted: depth]'
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactValue(val, depth + 1)
    }
    return out
  }
  return value
}

export class TaskTrace {
  private events: TraceEvent[] = []
  private seq = 0

  constructor(public readonly taskId: string) {}

  append(
    kind: TraceEventKind,
    summary: string,
    opts: {
      detail?: Record<string, unknown>
      confidence?: number
      error?: string
      at?: number
    } = {},
  ): TraceEvent {
    const event: TraceEvent = {
      seq: ++this.seq,
      taskId: this.taskId,
      kind,
      at: opts.at ?? Date.now(),
      summary,
      ...(opts.detail !== undefined && {
        detail: redactValue(opts.detail) as Record<string, unknown>,
      }),
      ...(opts.confidence !== undefined && { confidence: opts.confidence }),
      ...(opts.error !== undefined && { error: opts.error }),
    }
    this.events.push(event)
    return event
  }

  llmTurn(summary: string, detail?: Record<string, unknown>): TraceEvent {
    return this.append('llm-turn', summary, { detail })
  }

  toolDecision(
    summary: string,
    confidence: number,
    detail?: Record<string, unknown>,
  ): TraceEvent {
    return this.append('tool-decision', summary, { detail, confidence })
  }

  axDiff(summary: string, detail?: Record<string, unknown>): TraceEvent {
    return this.append('ax-diff', summary, { detail })
  }

  /** Metadata only: width/height/format — never the image itself. */
  screenshot(
    summary: string,
    meta: { width?: number; height?: number; format?: string; used?: boolean },
  ): TraceEvent {
    return this.append('screenshot', summary, { detail: { ...meta } })
  }

  cdpError(summary: string, error: string): TraceEvent {
    return this.append('cdp-error', summary, { error })
  }

  /** All events in order, as one timeline. */
  timeline(): TraceEvent[] {
    return [...this.events]
  }

  byKind(kind: TraceEventKind): TraceEvent[] {
    return this.events.filter((e) => e.kind === kind)
  }

  /** The last error event, if any — the first place a debugger looks. */
  lastError(): TraceEvent | undefined {
    return [...this.events]
      .reverse()
      .find((e) => e.kind === 'cdp-error' || e.error !== undefined)
  }

  toJSONL(): string {
    return this.events.map((e) => JSON.stringify(e)).join('\n')
  }

  static fromJSONL(taskId: string, jsonl: string): TaskTrace {
    const trace = new TaskTrace(taskId)
    for (const line of jsonl.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parsed = JSON.parse(trimmed) as TraceEvent
      trace.events.push(parsed)
      trace.seq = Math.max(trace.seq, parsed.seq)
    }
    return trace
  }

  render(): string {
    return this.events
      .map((e) => {
        const conf =
          e.confidence !== undefined
            ? ` (confidence ${e.confidence.toFixed(2)})`
            : ''
        const err = e.error ? ` ERROR: ${e.error}` : ''
        return `[${e.seq}] ${e.kind}${conf}: ${e.summary}${err}`
      })
      .join('\n')
  }
}
