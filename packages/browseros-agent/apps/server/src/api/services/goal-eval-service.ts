/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { randomUUID } from 'node:crypto'
import { generateText } from 'ai'
import { isAcpProvider } from '../../agent/acp-providers'
import { createLanguageModel } from '../../agent/provider-factory'
import type { ResolvedAgentConfig } from '../../agent/types'

export interface GoalEvalRequest {
  goal: string
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  resourceName?: string
}

export interface GoalEvalResponse {
  goalMet: boolean
  reason: string
}

export class GoalEvalService {
  async evaluate(
    history: ReadonlyArray<{ role: string; text: string }>,
    request: GoalEvalRequest,
  ): Promise<GoalEvalResponse> {
    // ACP providers (claude-code, codex, hermes, acp-custom) are whole-agent
    // frameworks, not stateless model calls — they cannot be used for a
    // lightweight goal-evaluation prompt.
    if (isAcpProvider(request.provider)) {
      return {
        goalMet: false,
        reason: `ACP providers (${request.provider}) are not supported for goal evaluation`,
      }
    }

    const config: ResolvedAgentConfig = {
      conversationId: `goal-eval-${randomUUID()}`,
      provider: request.provider as ResolvedAgentConfig['provider'],
      model: request.model,
      apiKey: request.apiKey,
      baseUrl: request.baseUrl,
      resourceName: request.resourceName,
    }

    const { model } = await createLanguageModel(config)

    const formattedMessages = history
      .map((entry) => {
        const role = entry.role === 'user' ? 'User' : 'Assistant'
        return `${role}: ${entry.text}`
      })
      .join('\n')

    const prompt = [
      'You are evaluating whether a goal has been achieved in a conversation.',
      '',
      `Goal: ${request.goal}`,
      '',
      'Conversation (most recent messages):',
      formattedMessages,
      '',
      'Has the goal been achieved? Reply with JSON: {"goalMet": true/false, "reason": "brief explanation"}',
    ].join('\n')

    const result = await generateText({
      model,
      messages: [{ role: 'user', content: prompt }],
    })

    return parseGoalEvalJson(result.text)
  }
}

/**
 * Extract a structured result from the model's JSON response. Tries direct
 * parsing first then falls back to regex extraction for models that wrap
 * the JSON in explanatory prose.
 */
function parseGoalEvalJson(text: string): GoalEvalResponse {
  // Direct parse
  try {
    const parsed = JSON.parse(text.trim())
    if (typeof parsed.goalMet === 'boolean') {
      return {
        goalMet: parsed.goalMet,
        reason:
          typeof parsed.reason === 'string'
            ? parsed.reason
            : String(parsed.goalMet),
      }
    }
  } catch {
    // Fall through
  }

  // Regex extraction — look for a JSON object containing "goalMet"
  const jsonMatch = text.match(/\{[\s\S]*?"goalMet"[\s\S]*?\}/)
  if (!jsonMatch) {
    return { goalMet: false, reason: 'Failed to parse evaluation result' }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      goalMet: Boolean(parsed.goalMet),
      reason:
        typeof parsed.reason === 'string'
          ? parsed.reason
          : String(parsed.goalMet),
    }
  } catch {
    return { goalMet: false, reason: 'Failed to parse evaluation result' }
  }
}
