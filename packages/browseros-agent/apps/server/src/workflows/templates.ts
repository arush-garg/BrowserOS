/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
  OutputSchemaField,
  Trajectory,
  Workflow,
  WorkflowInputSlot,
  WorkflowStep,
  WorkflowTemplate,
} from './types'

export const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'market-map',
    name: 'Market map',
    description: 'Map the vendors in a market and rank them against criteria.',
    goal: 'Build a market map for {{market}} and rank vendors against: {{criteria}}.',
    inputs: [
      { name: 'market', type: 'string', required: true },
      { name: 'criteria', type: 'string', required: true },
    ],
    outputSchema: [
      { name: 'vendors', type: 'string[]', required: true },
      { name: 'ranking', type: 'string', required: true },
    ],
    steps: [
      {
        id: 'step-1',
        tool: 'search',
        input: { query: '{{market}} vendors' },
        description: 'Find vendors in the market.',
      },
      {
        id: 'step-2',
        tool: 'extract',
        input: { criteria: '{{criteria}}' },
        description: 'Extract and rank vendors against the criteria.',
      },
    ],
  },
  {
    id: 'competitor-readout',
    name: 'Competitor readout',
    description: 'Summarise what a competitor changed recently.',
    goal: 'Produce a competitor readout for {{company}} covering {{topics}}.',
    inputs: [
      { name: 'company', type: 'string', required: true },
      { name: 'topics', type: 'string', required: false, defaultValue: 'pricing, product, hiring' },
    ],
    outputSchema: [
      { name: 'summary', type: 'string', required: true },
      { name: 'changes', type: 'string[]', required: false },
    ],
    steps: [
      {
        id: 'step-1',
        tool: 'search',
        input: { query: '{{company}} recent changes' },
        description: 'Find recent competitor activity.',
      },
    ],
  },
  {
    id: 'vendor-ranking',
    name: 'Vendor ranking',
    description: 'Rank a list of vendors against fixed criteria.',
    goal: 'Rank these vendors: {{vendors}}. Criteria: {{criteria}}.',
    inputs: [
      { name: 'vendors', type: 'string[]', required: true },
      { name: 'criteria', type: 'string', required: true },
    ],
    outputSchema: [{ name: 'ranking', type: 'string', required: true }],
    steps: [
      {
        id: 'step-1',
        tool: 'extract',
        input: { vendors: '{{vendors}}', criteria: '{{criteria}}' },
        description: 'Rank the vendors.',
      },
    ],
  },
  {
    id: 'lead-scoring',
    name: 'Lead scoring',
    description: 'Score leads against criteria and record the result.',
    goal: 'Score leads for {{audience}} against: {{criteria}}.',
    inputs: [
      { name: 'audience', type: 'string', required: true },
      { name: 'criteria', type: 'string', required: true },
    ],
    outputSchema: [
      { name: 'scores', type: 'string', required: true },
      { name: 'topLeads', type: 'string[]', required: false },
    ],
    steps: [
      {
        id: 'step-1',
        tool: 'extract',
        input: { audience: '{{audience}}', criteria: '{{criteria}}' },
        description: 'Score the leads.',
      },
    ],
  },
]

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

export function templatePlaceholders(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (match[1] && !names.includes(match[1])) names.push(match[1])
  }
  return names
}

function substitute(
  value: unknown,
  values: Record<string, string | number | string[]>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (_m, name: string) => {
      const v = values[name]
      if (v === undefined) return `{{${name}}}`
      return Array.isArray(v) ? v.join(', ') : String(v)
    })
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, values))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        substitute(v, values),
      ]),
    )
  }
  return value
}

function resolveValues(
  slots: WorkflowInputSlot[],
  provided: Record<string, string | number | string[]>,
): Record<string, string | number | string[]> {
  const missing: string[] = []
  const resolved: Record<string, string | number | string[]> = {}
  for (const slot of slots) {
    if (provided[slot.name] !== undefined) {
      resolved[slot.name] = provided[slot.name]
    } else if (slot.defaultValue !== undefined) {
      resolved[slot.name] = slot.defaultValue
    } else if (slot.required) {
      missing.push(slot.name)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required template inputs: ${missing.join(', ')}`)
  }
  return resolved
}

/** Instantiate a template into a runnable workflow. Throws on missing inputs. */
export function templateToWorkflow(
  template: WorkflowTemplate,
  provided: Record<string, string | number | string[]>,
  opts?: { id?: string; name?: string; now?: number },
): Workflow {
  const values = resolveValues(template.inputs, provided)
  const steps: WorkflowStep[] = template.steps.map((step) => ({
    ...step,
    input: substitute(step.input, values) as Record<string, unknown>,
  }))
  return {
    id: opts?.id ?? `wf-${template.id}`,
    name: opts?.name ?? template.name,
    description: template.description,
    goal: substitute(template.goal, values) as string,
    inputs: template.inputs,
    outputSchema: template.outputSchema,
    steps,
    source: { kind: 'template', templateId: template.id },
    createdAt: opts?.now ?? Date.now(),
  }
}

const SECRET_KEY = /password|passwd|secret|token|api[-_]?key|authorization|credential/i

function sanitizeInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY.test(key)) continue
    out[key] = value
  }
  return out
}

/**
 * Turn a successful run's trajectory into a named, re-runnable workflow.
 * Step outputs are deliberately dropped (they may contain page/personal
 * data); credential-shaped inputs are dropped too. The caller supplies the
 * input slots and output schema for the new workflow.
 */
export function trajectoryToWorkflow(opts: {
  name: string
  trajectory: Trajectory
  inputs: WorkflowInputSlot[]
  outputSchema: OutputSchemaField[]
  description?: string
  id?: string
  now?: number
}): Workflow {
  const { trajectory } = opts
  if (!trajectory.goal.trim()) throw new Error('Trajectory goal is empty')
  if (trajectory.steps.length === 0) {
    throw new Error('Cannot create a workflow from an empty trajectory')
  }
  return {
    id: opts.id ?? `wf-${opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: opts.name,
    description: opts.description,
    goal: trajectory.goal,
    inputs: opts.inputs,
    outputSchema: opts.outputSchema,
    steps: trajectory.steps.map((step, i) => ({
      id: `step-${i + 1}`,
      tool: step.tool,
      input: sanitizeInput(step.input),
    })),
    source: { kind: 'trajectory', trajectoryGoal: trajectory.goal },
    createdAt: opts.now ?? Date.now(),
  }
}

/** Validate a workflow; returns error strings, empty when valid. */
export function validateWorkflow(workflow: Workflow): string[] {
  const errors: string[] = []
  if (!workflow.name.trim()) errors.push('Workflow name is empty')
  if (!workflow.goal.trim()) errors.push('Workflow goal is empty')
  if (workflow.steps.length === 0) errors.push('Workflow has no steps')
  const slotNames = new Set<string>()
  for (const slot of workflow.inputs) {
    if (slotNames.has(slot.name)) errors.push(`Duplicate input slot: ${slot.name}`)
    slotNames.add(slot.name)
  }
  const fieldNames = new Set<string>()
  for (const field of workflow.outputSchema) {
    if (fieldNames.has(field.name)) {
      errors.push(`Duplicate output field: ${field.name}`)
    }
    fieldNames.add(field.name)
  }
  for (const step of workflow.steps) {
    if (!step.tool.trim()) errors.push(`Step ${step.id} has no tool`)
    const texts: string[] = []
    const collect = (v: unknown): void => {
      if (typeof v === 'string') texts.push(v)
      else if (Array.isArray(v)) v.forEach(collect)
      else if (v !== null && typeof v === 'object') {
        Object.values(v as Record<string, unknown>).forEach(collect)
      }
    }
    collect(step.input)
    for (const text of texts) {
      for (const name of templatePlaceholders(text)) {
        if (!slotNames.has(name)) {
          errors.push(
            `Step ${step.id} references undeclared input slot: ${name}`,
          )
        }
      }
    }
  }
  for (const name of templatePlaceholders(workflow.goal)) {
    if (!slotNames.has(name)) {
      errors.push(`Goal references undeclared input slot: ${name}`)
    }
  }
  return errors
}
