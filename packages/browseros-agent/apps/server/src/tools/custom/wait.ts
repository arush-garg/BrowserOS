/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod'
import { defineTool } from '../framework'
import type { ToolApprovalCategoryId } from '@browseros/shared/constants/tool-approval'

export const waitTool = defineTool({
  name: 'wait',
  description: 'Pause execution for a specified amount of time. Use this when you need to wait for a video to play, a page to settle, or an asynchronous operation to complete that doesn\'t have a detectable DOM change.',
  approvalCategory: ToolApprovalCategoryId.LOW_RISK,
  input: z.object({
    seconds: z.number().min(0.1).max(60).describe('The number of seconds to wait. Minimum 0.1s, maximum 60s.'),
  }),
  handler: async (args, _ctx, response) => {
    const { seconds } = args
    await new Promise(resolve => setTimeout(resolve, seconds * 1000))
    response.text(`Waited for ${seconds} seconds.`)
  },
})
