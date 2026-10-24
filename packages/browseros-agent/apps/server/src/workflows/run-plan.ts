/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { resolveRunContext } from './context'
import { renderSkillsPrompt, selectSkills } from './skills'
import { validateWorkflow } from './templates'
import type {
  BudgetLimits,
  ContextBundle,
  ModelRoutes,
  Skill,
  Workflow,
} from './types'

export interface RunPlan {
  workflowId: string
  workflowName: string
  goal: string
  contextPrompt: string
  skillsPrompt: string
  activeSkillNames: string[]
  routes: ModelRoutes
  budgetLimits: BudgetLimits
  runInputs: Record<string, unknown>
}

/**
 * Build everything a single run needs from stored artefacts, without
 * re-prompting: validated workflow + reused context bundle + only the
 * skills active for this task + model routes + budget ceilings. The
 * caller (agent loop / scheduler) then executes the plan; this module
 * never touches a browser tab.
 */
export function buildRunPlan(opts: {
  workflow: Workflow
  bundle?: ContextBundle
  runInputs?: Record<string, unknown>
  skills?: Skill[]
  skillTask?: string
  skillTaskName?: string
  skillSite?: string
  routes: ModelRoutes
  budgetLimits?: BudgetLimits
}): RunPlan {
  const errors = validateWorkflow(opts.workflow)
  if (errors.length > 0) {
    throw new Error(`Invalid workflow: ${errors.join('; ')}`)
  }
  const resolved = resolveRunContext(
    opts.workflow,
    opts.bundle,
    opts.runInputs ?? {},
  )
  const activeSkills = selectSkills(opts.skills ?? [], {
    task: opts.skillTask ?? opts.workflow.goal,
    taskName: opts.skillTaskName,
    site: opts.skillSite,
  })
  return {
    workflowId: opts.workflow.id,
    workflowName: opts.workflow.name,
    goal: opts.workflow.goal,
    contextPrompt: resolved.prompt,
    skillsPrompt: renderSkillsPrompt(activeSkills),
    activeSkillNames: activeSkills.map((s) => s.name),
    routes: opts.routes,
    budgetLimits: opts.budgetLimits ?? {},
    runInputs: resolved.runInputs,
  }
}
