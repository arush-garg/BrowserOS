/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Transcript condenser for the apps/server agent loop.
 *
 * When a transcript crosses a token threshold (or an event-count
 * threshold), the head (system prompt / original task) and the recent
 * tail are kept verbatim, and the middle is replaced by a single
 * summary message. The summary is produced by an injected summarizer —
 * in production that is the cheap model; in tests and offline use it is
 * the deterministic fallback below, which never calls a model.
 *
 * This is deliberately separate from `compaction.ts`: compaction drops
 * or prunes messages to fit a window, this preserves the middle as a
 * summary so later steps can still reason about what happened.
 *
 * Message shape is kept generic ({ role, content }) so this module has
 * no dependency on the AI SDK's message types; callers map
 * ModelMessage -> transcript messages before condensing and back after.
 */

export interface TranscriptMessage {
  role: string
  content: string
}

export interface CondenseOptions {
  /** Condense when estimated tokens exceed this. Defaults to 100_000. */
  thresholdTokens?: number
  /** Also condense when the transcript exceeds this many messages. */
  maxMessages?: number
  /** Messages kept verbatim from the start. Defaults to 1. */
  keepHead?: number
  /** Messages kept verbatim from the end. Defaults to 4. */
  keepTail?: number
  /**
   * Summarizer for the middle slice. Receives the middle messages and
   * returns the summary text. Defaults to a deterministic extractive
   * fallback (first ~120 chars of each middle message).
   */
  summarizer?: (
    middle: TranscriptMessage[],
  ) => string | Promise<string>
  /** Token estimator; defaults to ceil(chars / 4). */
  estimateTokens?: (messages: TranscriptMessage[]) => number
}

export interface CondenseResult {
  messages: TranscriptMessage[]
  condensed: boolean
  /** The summary text used, if condensation happened. */
  summary?: string
  /** Estimated tokens before condensation, if condensation happened. */
  estimatedTokensBefore?: number
}

function defaultEstimateTokens(messages: TranscriptMessage[]): number {
  const chars = messages.reduce(
    (total, message) => total + message.role.length + message.content.length,
    0,
  )
  return Math.ceil(chars / 4)
}

function defaultSummarizer(middle: TranscriptMessage[]): string {
  const parts = middle.map((message) => {
    const text = message.content.replace(/\s+/g, ' ').trim().slice(0, 120)
    return `[${message.role}] ${text}`
  })
  return `Summary of ${middle.length} earlier messages: ${parts.join(' | ')}`
}

export async function condenseTranscript(
  messages: TranscriptMessage[],
  options: CondenseOptions = {},
): Promise<CondenseResult> {
  const thresholdTokens = options.thresholdTokens ?? 100_000
  const maxMessages = options.maxMessages ?? Number.POSITIVE_INFINITY
  const keepHead = options.keepHead ?? 1
  const keepTail = options.keepTail ?? 4
  const estimateTokens = options.estimateTokens ?? defaultEstimateTokens
  const summarizer = options.summarizer ?? defaultSummarizer

  const estimatedTokens = estimateTokens(messages)
  const overTokenThreshold = estimatedTokens > thresholdTokens
  const overMessageThreshold = messages.length > maxMessages
  if (!overTokenThreshold && !overMessageThreshold) {
    return { messages: messages.map((message) => ({ ...message })), condensed: false }
  }

  // Nothing to summarize if head + tail already cover the transcript.
  if (messages.length <= keepHead + keepTail) {
    return { messages: messages.map((message) => ({ ...message })), condensed: false }
  }

  const head = messages.slice(0, keepHead)
  const middle = messages.slice(keepHead, messages.length - keepTail)
  const tail = messages.slice(messages.length - keepTail)
  const summary = await summarizer(middle.map((message) => ({ ...message })))

  return {
    messages: [
      ...head.map((message) => ({ ...message })),
      { role: 'system', content: `[condensed summary] ${summary}` },
      ...tail.map((message) => ({ ...message })),
    ],
    condensed: true,
    summary,
    estimatedTokensBefore: estimatedTokens,
  }
}
