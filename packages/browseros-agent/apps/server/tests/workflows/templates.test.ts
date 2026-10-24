import { describe, expect, test } from 'bun:test'
import {
  BUILTIN_TEMPLATES,
  templateToWorkflow,
  trajectoryToWorkflow,
  validateWorkflow,
} from '../../src/workflows/templates'

describe('templateToWorkflow', () => {
  test('substitutes slots in goal and step inputs', () => {
    const template = BUILTIN_TEMPLATES.find((t) => t.id === 'market-map')!
    const wf = templateToWorkflow(template, {
      market: 'CRM tools',
      criteria: 'price, integrations',
    })
    expect(wf.goal).toContain('CRM tools')
    expect(wf.goal).toContain('price, integrations')
    expect(wf.steps[0]?.input['query']).toBe('CRM tools vendors')
    expect(wf.source).toEqual({ kind: 'template', templateId: 'market-map' })
    expect(validateWorkflow(wf)).toEqual([])
  })

  test('uses defaults for optional slots and throws on missing required', () => {
    const template = BUILTIN_TEMPLATES.find(
      (t) => t.id === 'competitor-readout',
    )!
    const wf = templateToWorkflow(template, { company: 'Acme' })
    expect(wf.goal).toContain('pricing, product, hiring')
    expect(() =>
      templateToWorkflow(template, {} as never),
    ).toThrow('Missing required template inputs: company')
  })

  test('flags undeclared placeholders in validation', () => {
    const wf = templateToWorkflow(BUILTIN_TEMPLATES[0]!, {
      market: 'x',
      criteria: 'y',
    })
    const bad = { ...wf, steps: [{ id: 's1', tool: 'search', input: { q: '{{nope}}' } }] }
    expect(validateWorkflow(bad)).toContain(
      'Step s1 references undeclared input slot: nope',
    )
  })
})

describe('trajectoryToWorkflow', () => {
  test('serializes steps, drops outputs and credential inputs', () => {
    const wf = trajectoryToWorkflow({
      name: 'My search run',
      trajectory: {
        goal: 'Find pricing for Acme',
        steps: [
          {
            tool: 'navigate',
            input: { url: 'https://example.com/pricing', password: 'hunter2' },
            output: 'secret page data',
          },
          { tool: 'extract', input: { query: 'pricing' } },
        ],
      },
      inputs: [],
      outputSchema: [{ name: 'pricing', type: 'string', required: true }],
    })
    expect(wf.steps).toHaveLength(2)
    expect(wf.steps[0]?.input).toEqual({ url: 'https://example.com/pricing' })
    expect(JSON.stringify(wf)).not.toContain('hunter2')
    expect(JSON.stringify(wf)).not.toContain('secret page data')
    expect(wf.source?.kind).toBe('trajectory')
  })

  test('rejects empty trajectories and empty goals', () => {
    expect(() =>
      trajectoryToWorkflow({
        name: 'empty',
        trajectory: { goal: 'x', steps: [] },
        inputs: [],
        outputSchema: [],
      }),
    ).toThrow('empty trajectory')
    expect(() =>
      trajectoryToWorkflow({
        name: 'empty',
        trajectory: { goal: '  ', steps: [{ tool: 'x', input: {} }] },
        inputs: [],
        outputSchema: [],
      }),
    ).toThrow('goal is empty')
  })
})
