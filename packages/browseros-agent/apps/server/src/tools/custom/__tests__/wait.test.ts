/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { waitTool } from '../wait'
import { ToolResponse } from '../framework/response'

describe('Wait Tool', () => {
  it('exports a tool with correct definition', () => {
    expect(waitTool.name).toBe('wait')
    expect(waitTool.description).toContain('Pause execution')
    expect(waitTool.input).toBeDefined()
  })

  it('pauses execution for the requested time', async () => {
    const response = new ToolResponse()
    const seconds = 0.5
    const start = performance.now()
    
    await waitTool.handler(
      { seconds },
      {} as any,
      response
    )
    
    const duration = (performance.now() - start) / 1000
    
    // Check if it waited at least the requested time, with a small margin for timer precision
    expect(duration).toBeGreaterThanOrEqual(seconds - 0.05)
    expect(duration).toBeLessThan(seconds + 0.2)
    
    const result = response.toResult()
    expect(result.text).toBe(`Waited for ${seconds} seconds.`)
    expect(result.isError).toBe(false)
  })

  it('handles minimum wait time', async () => {
    const response = new ToolResponse()
    const seconds = 0.1
    const start = performance.now()
    
    await waitTool.handler({ seconds }, {} as any, response)
    
    const duration = (performance.now() - start) / 1000
    expect(duration).toBeGreaterThanOrEqual(seconds - 0.05)
  })
})
