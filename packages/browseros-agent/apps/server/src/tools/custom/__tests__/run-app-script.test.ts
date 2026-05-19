/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/* biome-disable suspicious/noExplicitAny style/noNonNullAssertion */
import { describe, it } from 'bun:test'
import assert from 'node:assert'
import { createRunAppScriptTool } from '../run-app-script'

describe('Run App Script Tool (compile-only smoke test)', () => {
  it('exports a tool with schema and description', () => {
    const tool = createRunAppScriptTool()
    assert.ok(tool.description && tool.inputSchema)
    const exec = (tool as unknown as { execute?: unknown }).execute
    assert.strictEqual(typeof exec, 'function')
  })
})
