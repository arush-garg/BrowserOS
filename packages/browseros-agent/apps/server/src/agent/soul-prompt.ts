/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getSoulPath } from '../lib/browseros-dir'
import { logger } from '../lib/logger'

/** Reads SOUL.md as passive prompt context without exposing Soul UI or tools. */
export async function readSoulPrompt(): Promise<string | undefined> {
  try {
    const file = Bun.file(getSoulPath())
    if (!(await file.exists())) return undefined

    const content = await file.text()
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch (error) {
    logger.warn('Failed to read SOUL.md prompt context', {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}
