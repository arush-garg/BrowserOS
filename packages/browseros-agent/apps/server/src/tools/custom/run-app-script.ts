/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { tool } from 'ai'
import { z } from 'zod'
import { AppsScriptClient } from '../../lib/clients/klavis/apps-script-client'
import { logger } from '../../lib/logger'
import { executeWithMetrics, toModelOutput } from '../filesystem/utils'

const TOOL_NAME = 'custom_run_app_script'

export function createRunAppScriptTool() {
  const client = new AppsScriptClient()

  return tool({
    description:
      'Run a Google Apps Script workflow for Google Docs, Sheets, or Slides. Executes custom scripts with optional parameters.',
    inputSchema: z.object({
      app: z
        .enum(['docs', 'sheets', 'slides'])
        .describe('The Google app to target (docs, sheets, or slides)'),
      script: z.string().describe('The Apps Script code to execute'),
      scriptParams: z
        .any()
        .optional()
        .describe(
          'Optional parameters to pass to the script function as an array',
        ),
      runAs: z
        .string()
        .optional()
        .describe(
          'Optional email address of the user to run the script as (requires appropriate permissions)',
        ),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_NAME, async () => {
        try {
          // Validate input
          if (!params.script || params.script.trim().length === 0) {
            return {
              text: 'Error: script parameter is required and cannot be empty',
              isError: true,
            }
          }

          // Call the Apps Script client
          const response = await client.runAppsScript(
            params.runAs || 'current-user',
            {
              app: params.app,
              script: params.script,
              scriptParams: params.scriptParams,
              runAs: params.runAs,
            },
          )

          // Handle API error responses
          if (response.error) {
            const errorMsg = `Apps Script execution failed: ${response.error.message} (Code: ${response.error.code})`
            logger.error('Apps Script execution error', {
              app: params.app,
              code: response.error.code,
              message: response.error.message,
              details: response.error.details,
            })
            return {
              text: errorMsg,
              isError: true,
            }
          }

          // Format and return the result
          const result = response.result
          let resultText: string

          if (result === null || result === undefined) {
            resultText = '(Script completed with no result)'
          } else if (typeof result === 'string') {
            resultText = result
          } else if (typeof result === 'object') {
            resultText = JSON.stringify(result, null, 2)
          } else {
            resultText = String(result)
          }

          return {
            text: `Apps Script execution successful:\n\n${resultText}`,
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error)
          logger.error('Apps Script tool execution failed', {
            tool: TOOL_NAME,
            error: errorMsg,
            app: params.app,
          })
          return {
            text: `Failed to execute Apps Script: ${errorMsg}`,
            isError: true,
          }
        }
      }),
    toModelOutput,
  })
}
