import { describe, expect, it } from 'bun:test'
import {
  goalTerms,
  selectRelevantByTokens,
  selectRelevantLines,
} from './snapshot-relevance'

function bigSnapshot(): string {
  const noise = Array.from(
    { length: 200 },
    (_, i) => `    - generic "filler row ${i}"`,
  )
  return [
    '- RootWebArea "Shop"',
    '  - navigation "Main"',
    ...noise,
    '  - main',
    '    - button "Place order" [ref=e42]',
  ].join('\n')
}

describe('selectRelevantLines', () => {
  it('returns the snapshot untouched when it already fits', () => {
    // Arrange
    const text = '- RootWebArea "Shop"\n  - button "Buy" [ref=e1]'

    // Act
    const result = selectRelevantLines(text, { budgetChars: 1_000 })

    // Assert
    expect(result.text).toBe(text)
    expect(result.trimmed).toBe(false)
    expect(result.elidedLines).toBe(0)
  })

  it('keeps the actionable tail a prefix cut would have dropped', () => {
    const result = selectRelevantLines(bigSnapshot(), { budgetChars: 400 })

    expect(result.trimmed).toBe(true)
    expect(result.text).toContain('button "Place order" [ref=e42]')
    expect(result.text.length).toBeLessThanOrEqual(400 + 40)
  })

  it('keeps the ancestors of every node it keeps', () => {
    const result = selectRelevantLines(bigSnapshot(), { budgetChars: 400 })
    const lines = result.text.split('\n')
    const orderIndex = lines.findIndex((l) => l.includes('Place order'))

    expect(orderIndex).toBeGreaterThan(0)
    expect(lines.slice(0, orderIndex).join('\n')).toContain('- main')
    expect(lines[0]).toContain('RootWebArea')
  })

  it('says how much it dropped instead of eliding silently', () => {
    const result = selectRelevantLines(bigSnapshot(), { budgetChars: 400 })

    expect(result.text).toMatch(/… \d+ nodes elided/)
    expect(result.elidedLines).toBeGreaterThan(0)
    expect(result.keptLines + result.elidedLines).toBe(result.totalLines)
  })

  it('prefers nodes that match the goal over generic interactive ones', () => {
    const text = [
      '- RootWebArea "Shop"',
      ...Array.from(
        { length: 60 },
        (_, i) => `  - link "Category ${i}" [ref=e${i}]`,
      ),
      '  - button "Track my refund" [ref=e900]',
    ].join('\n')

    const result = selectRelevantLines(text, {
      budgetChars: 200,
      goal: 'track the refund for my order',
    })

    expect(result.text).toContain('Track my refund')
  })

  it('ranks disabled controls below live ones', () => {
    const text = [
      '- RootWebArea "Form"',
      '  - button "Submit" [disabled] [ref=e1]',
      '  - button "Submit" [ref=e2]',
    ].join('\n')

    const result = selectRelevantLines(text, { budgetChars: 60 })

    expect(result.text).toContain('[ref=e2]')
    expect(result.text).not.toContain('[ref=e1]')
  })

  it('sizes by estimated tokens when asked', () => {
    const result = selectRelevantByTokens(bigSnapshot(), { budgetTokens: 100 })

    expect(result.trimmed).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(300 + 40)
  })
})

describe('goalTerms', () => {
  it('drops stopwords and short fragments', () => {
    expect(goalTerms('Click the button to find my refund')).toEqual([
      'button',
      'refund',
    ])
  })

  it('returns nothing without a goal', () => {
    expect(goalTerms(undefined)).toEqual([])
  })
})
