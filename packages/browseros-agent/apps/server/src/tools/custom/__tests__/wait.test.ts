/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { waitTool } from '../wait'

describe('Wait Tool', () => {
  it('exports a tool with correct definition', () => {
    expect(waitTool).toBeDefined()
    expect(waitTool.description).toContain('Pause execution')
  })

  it('pauses execution for the requested time', async () => {
    const seconds = 0.5
    const start = performance.now()

    const result = await waitTool.execute({ seconds })

    const duration = (performance.now() - start) / 1000

    // Check if it waited at least the requested time, with a small margin for timer precision
    expect(duration).toBeGreaterThanOrEqual(seconds - 0.05)
    expect(duration).toBeLessThan(seconds + 0.2)

    if (typeof result === 'string') {
      expect(result).toContain(`Waited for ${seconds} seconds`)
    } else if ('text' in result) {
      expect(result.text).toContain(`Waited for ${seconds} seconds`)
    }
  })

  it('handles minimum wait time', async () => {
    const seconds = 0.1
    const start = performance.now()

    await waitTool.execute({ seconds })

    const duration = (performance.now() - start) / 1000
    expect(duration).toBeGreaterThanOrEqual(seconds - 0.05)
  })
})
