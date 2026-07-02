import { describe, expect, it } from 'bun:test'
import {
  onboardingFormDefaults,
  onboardingFormSchema,
} from './onboarding-v2.schemas'

describe('onboardingFormSchema', () => {
  it('accepts the default values', () => {
    const parsed = onboardingFormSchema.parse(onboardingFormDefaults)
    expect(parsed.selectedSourceId).toBe('chrome-work')
  })

  it('rejects an empty selection with a helpful message', () => {
    const result = onboardingFormSchema.safeParse({ selectedSourceId: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Pick an import source.')
    }
  })

  it('accepts dynamic Chromium source ids', () => {
    const result = onboardingFormSchema.safeParse({
      selectedSourceId: 'source-42',
    })
    expect(result.success).toBe(true)
  })
})
