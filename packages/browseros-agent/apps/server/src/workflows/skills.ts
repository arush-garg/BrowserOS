/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Skill, SkillContext, SkillTrigger } from './types'

function parseList(value: string): string[] {
  const trimmed = value.trim()
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed
  return inner
    .split(',')
    .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

function normalizeTrigger(raw: string | undefined): SkillTrigger {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'always' || v === 'always-on') return 'always'
  if (v === 'keyword' || v === 'keywords') return 'keyword'
  if (v === 'task') return 'task'
  if (v === 'site' || v === 'sites') return 'site'
  return 'keyword'
}

/**
 * Parse a skill file: YAML-ish frontmatter between leading `---` markers,
 * then Markdown body. Frontmatter keys understood: name, trigger
 * (always / always-on / keyword / task / site), keywords, task / tasks,
 * site / sites. Unknown keys are ignored. A file without frontmatter is a
 * keyword skill named from its first `# heading`, or `unnamed-skill`.
 */
export function parseSkillMarkdown(markdown: string, source?: string): Skill {
  const lines = markdown.split('\n')
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (end > 0) {
      const fields: Record<string, string> = {}
      for (const line of lines.slice(1, end)) {
        const colon = line.indexOf(':')
        if (colon > 0) {
          fields[line.slice(0, colon).trim().toLowerCase()] =
            line.slice(colon + 1).trim()
        }
      }
      const content = lines.slice(end + 1).join('\n').trim()
      const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
      return {
        name: fields['name'] ?? heading ?? 'unnamed-skill',
        trigger: normalizeTrigger(fields['trigger']),
        keywords: fields['keywords'] ? parseList(fields['keywords']) : undefined,
        taskNames: fields['task'] ?? fields['tasks']
          ? parseList(fields['task'] ?? fields['tasks'] ?? '')
          : undefined,
        sites: fields['site'] ?? fields['sites']
          ? parseList(fields['site'] ?? fields['sites'] ?? '')
          : undefined,
        content,
        source,
      }
    }
  }
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return {
    name: heading ?? 'unnamed-skill',
    trigger: 'keyword',
    content: markdown.trim(),
    source,
  }
}

function normalizeSite(site: string): string {
  return site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? ''
}

/**
 * Select only the skills active for this run, in stable order: always-on
 * first, then the others in input order. Inactive skills are never injected
 * into the prompt, which is what keeps per-site knowledge from bloating
 * every run.
 */
export function selectSkills(skills: Skill[], ctx: SkillContext): Skill[] {
  const taskLower = ctx.task.toLowerCase()
  const taskNameLower = ctx.taskName?.toLowerCase()
  const siteNorm = ctx.site ? normalizeSite(ctx.site) : undefined
  const active: Skill[] = []
  const seen = new Set<string>()
  const push = (skill: Skill): void => {
    if (!seen.has(skill.name)) {
      seen.add(skill.name)
      active.push(skill)
    }
  }
  for (const skill of skills) {
    if (skill.trigger === 'always') push(skill)
  }
  for (const skill of skills) {
    if (skill.trigger === 'keyword') {
      const hit = (skill.keywords ?? []).some((k) =>
        taskLower.includes(k.toLowerCase()),
      )
      if (hit) push(skill)
    } else if (skill.trigger === 'task') {
      const hit =
        taskNameLower !== undefined &&
        (skill.taskNames ?? []).some(
          (t) =>
            t.toLowerCase() === taskNameLower ||
            taskNameLower.startsWith(t.toLowerCase()),
        )
      if (hit) push(skill)
    } else if (skill.trigger === 'site') {
      const hit =
        siteNorm !== undefined &&
        (skill.sites ?? []).some((s) => normalizeSite(s) === siteNorm)
      if (hit) push(skill)
    }
  }
  return active
}

/** Render only active skills as a prompt block (empty string when none). */
export function renderSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) return ''
  return skills.map((s) => `## Skill: ${s.name}\n${s.content}`).join('\n\n')
}
