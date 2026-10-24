/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Verified-finish gate for the apps/server agent loop.
 *
 * An agent may not claim `done` on its own assertion. It must pass this
 * gate: the current page evidence has to match the finish requirements
 * (URL, visible text, element text, extracted values), and — when a plan
 * is supplied — every non-abandoned subtask must be `verified`.
 *
 * Text matching is case-insensitive containment (page text varies in
 * casing); extracted values are compared after trimming, exactly, because
 * a date, price, or identifier that merely resembles the goal is not the
 * goal. URL matching is a plain substring check.
 */

import type { TaskPlan } from './plan'

export interface FinishEvidence {
  /** Current page URL, if known. */
  url?: string
  /** Visible page text, if known. */
  pageText?: string
  /** Visible text of specific elements the agent claims prove success. */
  elementTexts?: string[]
  /** Values extracted for the task, keyed by field name. */
  extractedValues?: Record<string, string>
}

export interface FinishRequirements {
  /** URL must contain this substring (e.g. '/confirmation'). */
  requiredUrlContains?: string
  /** Each string must appear (case-insensitively) in pageText. */
  requiredTextContains?: string[]
  /** Each string must appear (case-insensitively) in some element text. */
  requiredElementTextContains?: string[]
  /** Each field must equal the expected value after trimming. */
  requiredExtracted?: Record<string, string>
}

export interface FinishGateResult {
  passed: boolean
  /** Human-readable reasons for failure; empty when passed. */
  missing: string[]
}

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/** Evidence-only check, without any plan state. */
export function verifyFinishEvidence(
  requirements: FinishRequirements,
  evidence: FinishEvidence,
): FinishGateResult {
  const missing: string[] = []

  if (requirements.requiredUrlContains !== undefined) {
    if (
      evidence.url === undefined ||
      !evidence.url.includes(requirements.requiredUrlContains)
    ) {
      missing.push(
        `URL does not contain "${requirements.requiredUrlContains}"`,
      )
    }
  }

  for (const needle of requirements.requiredTextContains ?? []) {
    if (
      evidence.pageText === undefined ||
      !containsCaseInsensitive(evidence.pageText, needle)
    ) {
      missing.push(`Page text does not contain "${needle}"`)
    }
  }

  const elementTexts = evidence.elementTexts ?? []
  for (const needle of requirements.requiredElementTextContains ?? []) {
    if (
      !elementTexts.some((text) => containsCaseInsensitive(text, needle))
    ) {
      missing.push(`No element text contains "${needle}"`)
    }
  }

  for (const [field, expected] of Object.entries(
    requirements.requiredExtracted ?? {},
  )) {
    const actual = evidence.extractedValues?.[field]
    if (actual === undefined || actual.trim() !== expected.trim()) {
      missing.push(
        `Extracted value "${field}" is ${actual === undefined ? 'missing' : `"${actual}"`}, expected "${expected}"`,
      )
    }
  }

  return { passed: missing.length === 0, missing }
}

/**
 * Full gate: evidence must pass, and when a plan is supplied it must be
 * finishable (every non-abandoned subtask verified, at least one verified).
 * When no plan is supplied, the evidence check alone decides.
 */
export function verifyFinish(
  requirements: FinishRequirements,
  evidence: FinishEvidence,
  plan?: TaskPlan,
): FinishGateResult {
  const result = verifyFinishEvidence(requirements, evidence)
  if (plan !== undefined && !plan.canFinish()) {
    result.missing.push(
      'Plan is not finishable: some subtasks are still open, in progress, or merely completed (not verified)',
    )
    result.passed = false
  }
  return result
}
