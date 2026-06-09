/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ToolSet } from 'ai'
import type { ResolvedAgentConfig } from '../../agent/types'
import type { ToolContext } from '../legacy/framework'
import { createCodeExecutionTool } from './code-exec'
import {
  createEditGoogleDocTool,
  createEditGoogleSheetTool,
  createEditGoogleSlidesTool,
  createReadGoogleDocTool,
  createReadGoogleSheetTool,
  createReadGoogleSlidesTool,
} from './google-apps'
import { createRunAppScriptTool } from './run-app-script'
import {
  createSubagentGetResultTool,
  createSubagentSpawnTool,
} from './subagent'
import { waitTool } from './wait'
import { createWebFetchTool } from './web-fetch'

/**
 * Build a set of custom tools for the agent.
 * Includes: code execution, web fetching, subagent spawning, Apps Script execution,
 * and Google Workspace (Docs, Sheets, Slides) read/edit tools.
 *
 * @param ctx Tool context containing browser, directories, and session info
 * @param resolvedConfig Resolved agent configuration for subagent spawning
 * @returns ToolSet containing the custom tools
 */
export function buildCustomToolSet(
  ctx?: ToolContext,
  resolvedConfig?: ResolvedAgentConfig,
): ToolSet {
  const tools: ToolSet = {
    code_execute: createCodeExecutionTool(),
    run_app_script: createRunAppScriptTool(),
    wait: waitTool,
    read_google_doc: createReadGoogleDocTool(),
    read_google_sheet: createReadGoogleSheetTool(),
    read_google_slides: createReadGoogleSlidesTool(),
    edit_google_doc: createEditGoogleDocTool(),
    edit_google_sheet: createEditGoogleSheetTool(),
    edit_google_slides: createEditGoogleSlidesTool(),
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
