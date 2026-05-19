/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ToolSet } from 'ai'
import type { ResolvedAgentConfig } from '../../agent/types'
import type { ToolContext } from '../framework'
import { createCodeExecutionTool } from './code-exec'
import { createRunAppScriptTool } from './run-app-script'
import {
  createSubagentGetResultTool,
  createSubagentSpawnTool,
} from './subagent'
import { createWebFetchTool } from './web-fetch'
import { waitTool } from './wait'

/**
 * Build a set of custom tools for the agent.
 * Includes: code execution, web fetching, subagent spawning, and Apps Script execution.
 *
 * @param ctx Tool context containing browser, directories, and session info
 * @param resolvedConfig Resolved agent configuration for subagent spawning
 * @returns ToolSet containing the 4 custom tools
 */
export function buildCustomToolSet(
  ctx?: ToolContext,
  resolvedConfig?: ResolvedAgentConfig,
): ToolSet {
  const tools: ToolSet = {
    code_execute: createCodeExecutionTool(),
    run_app_script: createRunAppScriptTool(),
    wait: waitTool,
  }

  // web_fetch requires browser context
  if (ctx?.browser) {
    tools.web_fetch = createWebFetchTool(ctx.browser)
  }

  // subagent_spawn and subagent_get_result require resolved config
  if (resolvedConfig) {
    tools.subagent_spawn = createSubagentSpawnTool(resolvedConfig)
    tools.subagent_get_result = createSubagentGetResultTool()
  }

  return tools
}
