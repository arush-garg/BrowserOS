/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Subagent spawning and execution tool.
 * Allows the main agent to spawn subagents with custom instructions and provider/model selection.
 */

import type { ToolSet } from 'ai'
import { generateText, streamText, tool } from 'ai'
import { z } from 'zod'
import { createLanguageModel } from '../../agent/provider-factory'
import type { ResolvedAgentConfig } from '../../agent/types'
import { logger } from '../../lib/logger'
import { metrics } from '../../lib/metrics'

const TOOL_NAME_SPAWN = 'subagent_spawn'
const TOOL_NAME_GET_RESULT = 'subagent_get_result'

interface SubagentJob {
  jobId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
  error?: string
  createdAt: number
}

// In-memory job store for async subagent executions
const jobStore = new Map<string, SubagentJob>()

// Clean up old jobs after 1 hour
function cleanupOldJobs(): void {
  const oneHourAgo = Date.now() - 3600000
  for (const [jobId, job] of jobStore.entries()) {
    if (job.createdAt < oneHourAgo) {
      jobStore.delete(jobId)
    }
  }
}

// Generate a unique job ID
function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

// Helper to resolve provider/model from params or context
function resolveProviderConfig(
  params: { provider?: string; model?: string },
  sessionConfig: ResolvedAgentConfig,
): { provider: string; model: string } {
  return {
    provider: params.provider || sessionConfig.provider,
    model: params.model || sessionConfig.model,
  }
}

// Helper to create subagent config for LM creation
function createSubagentConfig(
  baseConfig: ResolvedAgentConfig,
  provider: string,
  model: string,
): ResolvedAgentConfig {
  return {
    ...baseConfig,
    provider: provider as unknown as ResolvedAgentConfig['provider'],
    model,
  }
}

function formatSubagentResult(params: {
  text?: string
  reasoningText?: string
}): string {
  const sections: string[] = []

  if (params.text?.trim()) {
    sections.push(`Final result:\n${params.text.trim()}`)
  }

  if (params.reasoningText?.trim()) {
    sections.push(`Reasoning:\n${params.reasoningText.trim()}`)
  }

  return sections.join('\n\n').trim()
}

function previewText(text: string | undefined, maxLength = 240): string {
  if (!text) {
    return ''
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/**
 * Spawn a subagent synchronously or asynchronously with custom instructions.
 */
export function createSubagentSpawnTool(resolvedConfig: ResolvedAgentConfig) {
  return tool({
    description:
      'Spawn a subagent to handle a specific task with custom instructions and optional provider/model override. ' +
      'Supports both synchronous execution (default) and asynchronous job spawning. ' +
      'For sync mode, returns the result directly. For async mode, returns a jobId that can be polled.',
    inputSchema: z.object({
      provider: z
        .string()
        .optional()
        .describe(
          'Optional provider ID (e.g., "openai", "anthropic"). Defaults to session provider.',
        ),
      model: z
        .string()
        .optional()
        .describe(
          'Optional model ID (e.g., "gpt-4o-mini"). Defaults to session model.',
        ),
      instructions: z
        .string()
        .describe('System instructions/prompt for the subagent'),
      tools: z
        .array(z.string())
        .optional()
        .describe(
          'Optional allowlist of tool names the subagent can use. Not enforced in this sync implementation.',
        ),
      maxSteps: z
        .number()
        .int()
        .optional()
        .default(20)
        .describe(
          'Maximum reasoning steps (for future use with agentic subagents)',
        ),
      runMode: z
        .enum(['sync', 'async'])
        .optional()
        .default('sync')
        .describe(
          'Execution mode: "sync" for immediate result, "async" to spawn a background job',
        ),
    }),
    execute: async (params) => {
      const startTime = performance.now()
      try {
        const { provider, model } = resolveProviderConfig(
          params,
          resolvedConfig,
        )
        const subagentConfig = createSubagentConfig(
          resolvedConfig,
          provider,
          model,
        )

        if (params.runMode === 'async') {
          return await executeAsyncSubagent(subagentConfig, params)
        } else {
          return await executeSyncSubagent(subagentConfig, params, startTime)
        }
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error)
        logger.error('Subagent spawn execution failed', {
          tool: TOOL_NAME_SPAWN,
          error: errorText,
        })
        metrics.log('tool_executed', {
          tool_name: TOOL_NAME_SPAWN,
          duration_ms: Math.round(performance.now() - startTime),
          success: false,
          error_message: errorText,
          source: 'chat',
        })
        return {
          type: 'text' as const,
          value: `Error spawning subagent: ${errorText}`,
        }
      }
    },
  })
}

/**
 * Synchronous subagent execution via generateText.
 */
async function executeSyncSubagent(
  config: ResolvedAgentConfig,
  params: {
    instructions: string
    tools?: string[]
    maxSteps?: number
    runMode?: 'sync' | 'async'
  },
  startTime: number,
) {
  try {
    const { model: lm } = await createLanguageModel(config)

    const result = await generateText({
      model: lm,
      system: params.instructions,
      messages: [
        {
          role: 'user',
          content: params.instructions,
        },
      ],
    })

    const formattedResult = formatSubagentResult({
      text: result.text,
      reasoningText: result.reasoningText,
    })

    metrics.log('tool_executed', {
      tool_name: TOOL_NAME_SPAWN,
      duration_ms: Math.round(performance.now() - startTime),
      success: true,
      source: 'chat',
    })

    logger.debug('Sync subagent execution completed', {
      tool: TOOL_NAME_SPAWN,
      textPreview: previewText(result.text),
      reasoningPreview: previewText(result.reasoningText),
    })

    return {
      type: 'text' as const,
      value: formattedResult || 'Subagent completed without output',
    }
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    logger.error('Sync subagent execution failed', {
      tool: TOOL_NAME_SPAWN,
      error: errorText,
    })
    metrics.log('tool_executed', {
      tool_name: TOOL_NAME_SPAWN,
      duration_ms: Math.round(performance.now() - startTime),
      success: false,
      error_message: errorText,
      source: 'chat',
    })
    return { type: 'error-text' as const, value: errorText }
  }
}

/**
 * Asynchronous subagent execution via streamText.
 * Spawns a background job and returns jobId immediately.
 */
async function executeAsyncSubagent(
  config: ResolvedAgentConfig,
  params: {
    instructions: string
    tools?: string[]
    maxSteps?: number
    runMode?: 'sync' | 'async'
  },
) {
  const jobId = generateJobId()
  cleanupOldJobs()

  const job: SubagentJob = {
    jobId,
    status: 'pending',
    createdAt: Date.now(),
  }
  jobStore.set(jobId, job)

  // Spawn async execution without awaiting
  ;(async () => {
    const startTime = performance.now()
    try {
      job.status = 'running'
      const { model: lm } = await createLanguageModel(config)

      const stream = streamText({
        model: lm,
        system: params.instructions,
        messages: [
          {
            role: 'user',
            content: params.instructions,
          },
        ],
      })

      const [text, reasoningText] = await Promise.all([
        stream.text,
        stream.reasoningText,
      ])

      job.result = formatSubagentResult({ text, reasoningText })
      job.status = 'completed'

      metrics.log('tool_executed', {
        tool_name: TOOL_NAME_SPAWN,
        duration_ms: Math.round(performance.now() - startTime),
        success: true,
        source: 'chat',
      })

      logger.debug('Async subagent job completed', {
        jobId,
        durationMs: Math.round(performance.now() - startTime),
        textPreview: previewText(text),
        reasoningPreview: previewText(reasoningText),
      })
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      job.error = errorText
      job.status = 'failed'

      metrics.log('tool_executed', {
        tool_name: TOOL_NAME_SPAWN,
        duration_ms: Math.round(performance.now() - startTime),
        success: false,
        error_message: errorText,
        source: 'chat',
      })

      logger.error('Async subagent job failed', {
        jobId,
        error: errorText,
      })
    }
  })()

  return {
    type: 'text' as const,
    value: `Subagent job spawned with ID: ${jobId}. Use subagent_get_result to poll for results.`,
  }
}

/**
 * Fetch results of an async subagent job.
 */
export function createSubagentGetResultTool() {
  return tool({
    description:
      'Fetch the result of an async subagent job. Returns the result if completed, error if failed, or status if still running.',
    inputSchema: z.object({
      jobId: z
        .string()
        .describe('The job ID returned by subagent_spawn in async mode'),
    }),
    execute: async (params) => {
      const startTime = performance.now()
      try {
        const job = jobStore.get(params.jobId)

        if (!job) {
          metrics.log('tool_executed', {
            tool_name: TOOL_NAME_GET_RESULT,
            duration_ms: Math.round(performance.now() - startTime),
            success: false,
            error_message: 'Job not found',
            source: 'chat',
          })
          return {
            type: 'error-text' as const,
            value: `Job not found: ${params.jobId}`,
          }
        }

        if (job.status === 'pending' || job.status === 'running') {
          metrics.log('tool_executed', {
            tool_name: TOOL_NAME_GET_RESULT,
            duration_ms: Math.round(performance.now() - startTime),
            success: true,
            source: 'chat',
          })
          return {
            type: 'text' as const,
            value: `Job ${params.jobId} is still ${job.status}. Check again later.`,
          }
        }

        if (job.status === 'failed') {
          metrics.log('tool_executed', {
            tool_name: TOOL_NAME_GET_RESULT,
            duration_ms: Math.round(performance.now() - startTime),
            success: false,
            error_message: job.error,
            source: 'chat',
          })
          return {
            type: 'error-text' as const,
            value: `Job ${params.jobId} failed: ${job.error}`,
          }
        }

        // Status is 'completed'
        metrics.log('tool_executed', {
          tool_name: TOOL_NAME_GET_RESULT,
          duration_ms: Math.round(performance.now() - startTime),
          success: true,
          source: 'chat',
        })

        return {
          type: 'text' as const,
          value: job.result || 'Job completed without output',
        }
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error)
        logger.error('Get subagent result execution failed', {
          tool: TOOL_NAME_GET_RESULT,
          error: errorText,
        })
        metrics.log('tool_executed', {
          tool_name: TOOL_NAME_GET_RESULT,
          duration_ms: Math.round(performance.now() - startTime),
          success: false,
          error_message: errorText,
          source: 'chat',
        })
        return { type: 'error-text' as const, value: errorText }
      }
    },
  })
}

/**
 * Export both tools as a ToolSet for integration into the agent.
 */
export function buildCustomToolSet(config: ResolvedAgentConfig): ToolSet {
  return {
    subagent_spawn: createSubagentSpawnTool(config),
    subagent_get_result: createSubagentGetResultTool(),
  }
}
