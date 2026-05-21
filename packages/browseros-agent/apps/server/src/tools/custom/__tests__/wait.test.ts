/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import type { ToolExecutionOptions } from 'ai'
import { waitTool } from '../wait'

const testToolOptions: ToolExecutionOptions = {
  toolCallId: 'test-tool-call',
  messages: [],
}

function executeWaitTool(input: { seconds: number }) {
  const execute = waitTool.execute
  if (!execute) throw new Error('waitTool.execute is not defined')
  return execute(input, testToolOptions) as Promise<string>
}

describe('Wait Tool', () => {
  it('exports a tool with correct definition', () => {
    expect(waitTool).toBeDefined()
    expect(waitTool.description).toContain('Pause execution')
  })

  it('pauses execution for the requested time', async () => {
    const seconds = 0.5
    const start = performance.now()

    const result = await executeWaitTool({ seconds })

    const duration = (performance.now() - start) / 1000

    // Check if it waited at least the requested time, with a small margin for timer precision
    expect(duration).toBeGreaterThanOrEqual(seconds - 0.05)
    expect(duration).toBeLessThan(seconds + 0.2)

    expect(result).toContain(`Waited for ${seconds}`)
  })

  it('handles minimum wait time', async () => {
    const seconds = 0.1
    const start = performance.now()

    await executeWaitTool({ seconds })

    const duration = (performance.now() - start) / 1000
    expect(duration).toBeGreaterThanOrEqual(seconds - 0.05)
  })

  it('uses correct pluralization', async () => {
    const result1 = await executeWaitTool({ seconds: 1 })
    expect(result1).toBe('Waited for 1 second.')

    const result2 = await executeWaitTool({ seconds: 2 })
    expect(result2).toBe('Waited for 2 seconds.')
  })
})
