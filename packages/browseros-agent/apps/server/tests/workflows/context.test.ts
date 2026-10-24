import { describe, expect, test } from 'bun:test'
import {
  applyExclusionsToSites,
  createContextBundle,
  resolveRunContext,
} from '../../src/workflows/context'
import { templateToWorkflow, BUILTIN_TEMPLATES } from '../../src/workflows/templates'

function workflow() {
  return templateToWorkflow(BUILTIN_TEMPLATES[0]!, {
    market: 'CRM',
    criteria: 'price',
  })
}

describe('context bundles', () => {
  test('exclusions win over sites and lists are deduped', () => {
    const bundle = createContextBundle({
      id: 'b1',
      criteria: ['price', 'price'],
      sites: ['acme.com', 'Acme.com', 'blocked.com'],
      exclusions: ['blocked.com'],
      tone: 'concise',
      destination: 'sheet:leads',
    })
    expect(bundle.sites).toEqual(['acme.com'])
    expect(bundle.criteria).toEqual(['price'])
    expect(applyExclusionsToSites(bundle)).toEqual(['acme.com'])
  })

  test('resolveRunContext reuses the bundle verbatim across runs', () => {
    const bundle = createContextBundle({
      id: 'b1',
      criteria: ['price'],
      sites: ['acme.com'],
      exclusions: [],
      tone: 'concise',
    })
    const first = resolveRunContext(workflow(), bundle, { run: 1 })
    const second = resolveRunContext(workflow(), bundle, { run: 2 })
    expect(first.prompt).toBe(second.prompt)
    expect(first.prompt).toContain('price')
    expect(first.prompt).toContain('acme.com')
    expect(first.prompt).toContain('concise')
  })

  test('a run cannot mutate the stored bundle', () => {
    const bundle = createContextBundle({
      id: 'b1',
      criteria: ['price'],
      sites: ['acme.com'],
      exclusions: [],
    })
    const resolved = resolveRunContext(workflow(), bundle)
    resolved.bundle.criteria.push('hacked')
    resolved.bundle.sites.push('evil.com')
    expect(bundle.criteria).toEqual(['price'])
    expect(bundle.sites).toEqual(['acme.com'])
  })
})
