/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ContextBundle, Workflow } from './types'

function normalizeList(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(trimmed)
    }
  }
  return out
}

/** Create a bundle; exclusions always win over sites (case-insensitive). */
export function createContextBundle(input: {
  id: string
  workflowId?: string
  criteria: string[]
  sites: string[]
  exclusions: string[]
  tone?: string
  destination?: string
  notes?: string
}): ContextBundle {
  const exclusions = normalizeList(input.exclusions)
  const excluded = new Set(exclusions.map((e) => e.toLowerCase()))
  return {
    id: input.id,
    workflowId: input.workflowId,
    criteria: normalizeList(input.criteria),
    sites: normalizeList(input.sites).filter(
      (site) => !excluded.has(site.toLowerCase()),
    ),
    exclusions,
    tone: input.tone?.trim() || undefined,
    destination: input.destination?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
  }
}

/** Sites after exclusions are applied (same rule as creation). */
export function applyExclusionsToSites(bundle: ContextBundle): string[] {
  const excluded = new Set(bundle.exclusions.map((e) => e.toLowerCase()))
  return bundle.sites.filter((site) => !excluded.has(site.toLowerCase()))
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export interface ResolvedRunContext {
  /** Deep copy of the bundle, so a run can never mutate the stored bundle. */
  bundle: ContextBundle
  sites: string[]
  /** Prompt-ready context block, reused verbatim on every run. */
  prompt: string
  runInputs: Record<string, unknown>
}

/**
 * Resolve the context for one run. The bundle is carried forward unchanged
 * (a deep copy); run inputs are separate and never overwrite bundle fields.
 * This is what stops a scheduled workflow from re-prompting the user for
 * criteria, sites, tone, or destination on every run.
 */
export function resolveRunContext(
  workflow: Workflow,
  bundle: ContextBundle | undefined,
  runInputs: Record<string, unknown> = {},
): ResolvedRunContext {
  if (!bundle) {
    return {
      bundle: {
        id: 'no-bundle',
        workflowId: workflow.id,
        criteria: [],
        sites: [],
        exclusions: [],
      },
      sites: [],
      prompt: `Workflow: ${workflow.name}\nGoal: ${workflow.goal}`,
      runInputs: deepClone(runInputs),
    }
  }
  const copy = deepClone(bundle)
  const sites = applyExclusionsToSites(copy)
  const lines = [
    `Workflow context (reused, do not re-ask for this):`,
    `Criteria: ${copy.criteria.join('; ') || '(none)'}`,
    `Sites: ${sites.join(', ') || '(none)'}`,
    `Excluded: ${copy.exclusions.join(', ') || '(none)'}`,
  ]
  if (copy.tone) lines.push(`Tone: ${copy.tone}`)
  if (copy.destination) lines.push(`Destination: ${copy.destination}`)
  if (copy.notes) lines.push(`Notes: ${copy.notes}`)
  return { bundle: copy, sites, prompt: lines.join('\n'), runInputs: deepClone(runInputs) }
}
