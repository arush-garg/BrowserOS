import { describe, expect, test } from 'bun:test'
import { createContextBundle } from '../../src/workflows/context'
import { buildRunPlan } from '../../src/workflows/run-plan'
import { parseSkillMarkdown } from '../../src/workflows/skills'
import { BUILTIN_TEMPLATES, templateToWorkflow } from '../../src/workflows/templates'

describe('buildRunPlan', () => {
  test('combines workflow, reused context, active skills, routes, budgets', () => {
    const workflow = templateToWorkflow(BUILTIN_TEMPLATES[0]!, {
      market: 'CRM',
      criteria: 'price',
    })
    const bundle = createContextBundle({
      id: 'b1',
      criteria: ['price'],
      sites: ['acme.com'],
      exclusions: [],
      tone: 'concise',
    })
    const plan = buildRunPlan({
      workflow,
      bundle,
      skills: [
        parseSkillMarkdown(
          '---\nname: safety\ntrigger: always\n---\nNever auto-send.',
        ),
        parseSkillMarkdown(
          '---\nname: other\ntrigger: keyword\nkeywords: [unrelated]\n---\nNope.',
        ),
      ],
      routes: { textModel: 'cheap', visionModel: 'vision' },
      budgetLimits: { maxSteps: 50 },
    })
    expect(plan.contextPrompt).toContain('price')
    expect(plan.activeSkillNames).toEqual(['safety'])
    expect(plan.skillsPrompt).toContain('Never auto-send')
    expect(plan.skillsPrompt).not.toContain('Nope')
    expect(plan.routes.textModel).toBe('cheap')
    expect(plan.budgetLimits.maxSteps).toBe(50)
  })

  test('rejects an invalid workflow instead of planning it', () => {
    const workflow = templateToWorkflow(BUILTIN_TEMPLATES[0]!, {
      market: 'CRM',
      criteria: 'price',
    })
    expect(() =>
      buildRunPlan({
        workflow: { ...workflow, steps: [] },
        routes: { textModel: 'cheap', visionModel: 'vision' },
      }),
    ).toThrow('Invalid workflow')
  })
})
