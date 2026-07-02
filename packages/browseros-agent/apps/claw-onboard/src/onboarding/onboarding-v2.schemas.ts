/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FieldErrors, Resolver, ResolverResult } from 'react-hook-form'
import { DEFAULT_BROWSEROS_IMPORT_SOURCE_ID } from './onboarding-v2.helpers'

export interface OnboardingFormValues {
  selectedSourceId: string
}

interface OnboardingFormIssue {
  message: string
  path: ['selectedSourceId']
}

interface OnboardingFormError {
  issues: OnboardingFormIssue[]
}

export const onboardingFormDefaults: OnboardingFormValues = {
  selectedSourceId: DEFAULT_BROWSEROS_IMPORT_SOURCE_ID,
}

function validateFormValues(
  value: unknown,
):
  | { success: true; data: OnboardingFormValues }
  | { success: false; error: OnboardingFormError } {
  const selectedSourceId =
    typeof value === 'object' && value !== null && 'selectedSourceId' in value
      ? (value as { selectedSourceId?: unknown }).selectedSourceId
      : undefined
  if (typeof selectedSourceId === 'string' && selectedSourceId.length > 0) {
    return { success: true, data: { selectedSourceId } }
  }
  return {
    success: false,
    error: {
      issues: [
        { message: 'Pick an import source.', path: ['selectedSourceId'] },
      ],
    },
  }
}

export const onboardingFormSchema = {
  parse(value: unknown): OnboardingFormValues {
    const result = validateFormValues(value)
    if (result.success) return result.data
    throw result.error
  },
  safeParse: validateFormValues,
}

/** Validates the dynamic Chromium source id without bundling Zod into WebUI resources. */
export const onboardingFormResolver: Resolver<OnboardingFormValues> = (
  values,
): ResolverResult<OnboardingFormValues> => {
  const result = onboardingFormSchema.safeParse(values)
  if (result.success) {
    return { values: result.data, errors: {} }
  }
  const errors: FieldErrors<OnboardingFormValues> = {
    selectedSourceId: {
      type: 'required',
      message: result.error.issues[0]?.message,
    },
  }
  return {
    values: {},
    errors,
  }
}
