/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/* biome-disable suspicious/noExplicitAny style/noNonNullAssertion */
import { describe, it } from 'bun:test'
import assert from 'node:assert'
import { createCodeExecutionTool } from '../code-exec'

describe('Code Execution Tool (compile-only smoke test)', () => {
  it('exports a tool with description and schema', () => {
    const tool = createCodeExecutionTool()
    assert.ok(tool.description && tool.inputSchema)
    const exec = (tool as unknown as { execute?: unknown }).execute
    assert.strictEqual(typeof exec, 'function')
  })
})
