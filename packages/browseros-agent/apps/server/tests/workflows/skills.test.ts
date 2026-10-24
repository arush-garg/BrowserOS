import { describe, expect, test } from 'bun:test'
import {
  parseSkillMarkdown,
  renderSkillsPrompt,
  selectSkills,
} from '../../src/workflows/skills'

const ALWAYS = `---
name: safety-rules
trigger: always
---
# Safety
Never auto-send messages.
`

const KEYWORD = `---
name: checkout-rules
trigger: keyword
keywords: [checkout, payment]
---
# Checkout
Verify the cart total before paying.
`

const TASK = `---
name: flight-booking
trigger: task
tasks: [book-flight]
---
# Flights
Prefer aisle seats.
`

const SITE = `---
name: gmail-triage
trigger: site
sites: [mail.google.com]
---
# Gmail
Triage inbox first.
`

describe('parseSkillMarkdown', () => {
  test('parses frontmatter and body', () => {
    const skill = parseSkillMarkdown(KEYWORD, 'skills/checkout.md')
    expect(skill.name).toBe('checkout-rules')
    expect(skill.trigger).toBe('keyword')
    expect(skill.keywords).toEqual(['checkout', 'payment'])
    expect(skill.content).toContain('Verify the cart total')
    expect(skill.source).toBe('skills/checkout.md')
  })

  test('normalizes always-on and falls back to heading name', () => {
    const skill = parseSkillMarkdown(ALWAYS)
    expect(skill.trigger).toBe('always')
    const plain = parseSkillMarkdown('# My skill\nBody text.')
    expect(plain.name).toBe('My skill')
    expect(plain.trigger).toBe('keyword')
  })
})

describe('selectSkills', () => {
  const skills = [KEYWORD, TASK, SITE, ALWAYS].map((m) =>
    parseSkillMarkdown(m),
  )

  test('always-on skills are always active; others only on trigger', () => {
    const active = selectSkills(skills, {
      task: 'book a flight and checkout',
      taskName: 'book-flight',
      site: 'https://mail.google.com/inbox',
    })
    expect(active.map((s) => s.name)).toEqual([
      'safety-rules',
      'checkout-rules',
      'flight-booking',
      'gmail-triage',
    ])
  })

  test('inactive skills are not injected', () => {
    const active = selectSkills(skills, { task: 'write a summary' })
    expect(active.map((s) => s.name)).toEqual(['safety-rules'])
    expect(renderSkillsPrompt(active)).toContain('Never auto-send')
    expect(renderSkillsPrompt(active)).not.toContain('Verify the cart total')
    expect(renderSkillsPrompt([])).toBe('')
  })
})
