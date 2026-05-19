/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { tool } from 'ai'
import { z } from 'zod'
import { executeWithMetrics } from '../filesystem/utils'

const TOOL_NAME = 'wait'

export function createWaitTool() {
  return tool({
    description:
      "Pause execution for a specified amount of time. Use this when you need to wait for a video to play, a page to settle, or an asynchronous operation to complete that doesn't have a detectable DOM change.",
    inputSchema: z.object({
      seconds: z
        .number()
        .min(0.1)
        .max(60)
        .describe('The number of seconds to wait. Minimum 0.1s, maximum 60s.'),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_NAME, async () => {
        const { seconds } = params
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
        return {
          text: `Waited for ${seconds} seconds.`,
        }
      }),
  })
}

export const waitTool = createWaitTool()
