import { describe, expect, test } from 'bun:test'
import { verifyFinish, verifyFinishEvidence } from './finish-gate'
import { createTaskPlan } from './plan'

describe('verifyFinishEvidence', () => {
  test('passes when URL, text, element text, and extracted values all match', () => {
    const result = verifyFinishEvidence(
      {
        requiredUrlContains: '/confirmation',
        requiredTextContains: ['Order confirmed'],
        requiredElementTextContains: ['Total: $42'],
        requiredExtracted: { orderTotal: '$42' },
      },
      {
        url: 'https://shop.example.com/checkout/confirmation',
        pageText: 'Thank you! Your order confirmed.',
        elementTexts: ['Total: $42', 'Shipping: free'],
        extractedValues: { orderTotal: ' $42 ' },
      },
    )
    expect(result).toEqual({ passed: true, missing: [] })
  })

  test('fails with a reason per missing requirement', () => {
    const result = verifyFinishEvidence(
      {
        requiredUrlContains: '/confirmation',
        requiredTextContains: ['Order confirmed'],
        requiredExtracted: { orderTotal: '$42' },
      },
      {
        url: 'https://shop.example.com/cart',
        pageText: 'Your cart is empty.',
        extractedValues: { orderTotal: '$41' },
      },
    )
    expect(result.passed).toBe(false)
    expect(result.missing).toHaveLength(3)
    expect(result.missing.join('\n')).toContain('URL does not contain')
    expect(result.missing.join('\n')).toContain('Page text does not contain')
    expect(result.missing.join('\n')).toContain('Extracted value "orderTotal"')
  })

  test('text matching is case-insensitive, extracted matching is exact after trim', () => {
    expect(
      verifyFinishEvidence(
        { requiredTextContains: ['ORDER CONFIRMED'] },
        { pageText: 'order confirmed' },
      ).passed,
    ).toBe(true)
    expect(
      verifyFinishEvidence(
        { requiredExtracted: { date: '2026-11-06' } },
        { extractedValues: { date: '2026-11-07' } },
      ).passed,
    ).toBe(false)
  })

  test('missing evidence counts as failure, not as a crash', () => {
    const result = verifyFinishEvidence(
      { requiredUrlContains: '/confirmation', requiredTextContains: ['done'] },
      {},
    )
    expect(result.passed).toBe(false)
    expect(result.missing).toHaveLength(2)
  })
})

describe('verifyFinish with a plan', () => {
  test('passes only when evidence passes AND the plan is finishable', () => {
    const plan = createTaskPlan('Book a flight', ['Search'])
    plan.startSubtask('subtask-1')
    plan.completeSubtask('subtask-1')
    // Evidence is fine, but the subtask is only completed, not verified.
    expect(
      verifyFinish({}, { pageText: 'anything' }, plan).passed,
    ).toBe(false)
    plan.verifySubtask('subtask-1')
    expect(
      verifyFinish({}, { pageText: 'anything' }, plan),
    ).toEqual({ passed: true, missing: [] })
  })

  test('evidence failure still fails even with a verified plan', () => {
    const plan = createTaskPlan('Book a flight', ['Search'])
    plan.startSubtask('subtask-1')
    plan.completeSubtask('subtask-1')
    plan.verifySubtask('subtask-1')
    const result = verifyFinish(
      { requiredUrlContains: '/confirmation' },
      { url: 'https://example.com/cart' },
      plan,
    )
    expect(result.passed).toBe(false)
    expect(result.missing).toHaveLength(1)
  })
})
