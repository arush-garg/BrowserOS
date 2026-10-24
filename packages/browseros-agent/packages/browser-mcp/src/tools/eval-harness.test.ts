import { describe, expect, it } from 'bun:test'
import {
  FakeBrowser,
  GOLDEN_CASES,
  goldenPages,
  runEvalCase,
  runEvalSuite,
} from './eval-harness'

describe('deterministic eval harness', () => {
  it('passes all golden cases on the fake browser (no Chrome, no network)', () => {
    const results = runEvalSuite(GOLDEN_CASES, () => new FakeBrowser(goldenPages()))
    expect(results.map((r) => r.name)).toEqual([
      'form-fill',
      'multi-tab-comparison',
      'checkout-up-to-payment',
    ])
    for (const result of results) {
      expect(result.passed).toBe(true)
      expect(result.failures).toEqual([])
    }
  })

  it('fails a mutated trajectory instead of passing it', () => {
    const mutated = {
      ...GOLDEN_CASES[0],
      steps: [
        { action: 'navigate', url: 'https://example.test/form' },
        { action: 'fill', field: 'name', value: 'Wrong' },
        { action: 'assertField', field: 'name', value: 'Ada' },
      ],
    } as typeof GOLDEN_CASES[0]
    const result = runEvalCase(mutated, new FakeBrowser(goldenPages()))
    expect(result.passed).toBe(false)
    expect(result.failures.join(' ')).toContain('Wrong')
  })

  it('fails a case that attempts payment — eval stops at review', () => {
    const paying = {
      name: 'checkout-pays',
      goal: 'Pay (forbidden in eval)',
      steps: [
        { action: 'navigate', url: 'https://example.test/checkout' },
        { action: 'click', target: 'pay' },
        { action: 'assertNoPayment' },
      ],
    } as typeof GOLDEN_CASES[0]
    const result = runEvalCase(paying, new FakeBrowser(goldenPages()))
    expect(result.passed).toBe(false)
    expect(result.failures.join(' ')).toContain('payment was attempted')
  })

  it('fails on an unknown field instead of silently passing', () => {
    const bad = {
      ...GOLDEN_CASES[0],
      steps: [{ action: 'fill', field: 'nope', value: 'x' }],
    } as typeof GOLDEN_CASES[0]
    const result = runEvalCase(bad, new FakeBrowser(goldenPages()))
    expect(result.passed).toBe(false)
  })
})
