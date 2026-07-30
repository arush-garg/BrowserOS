import { env } from '@/lib/env'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'

/** Fields describing how to reach an LLM for goal evaluation. */
export interface GoalEvalProvider {
  readonly providerType: string
  readonly modelId: string
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly resourceName?: string
  /** Harness agent id used as the URL path segment. */
  readonly agentId: string
}

export interface GoalEvalRequest {
  readonly goal: string
  readonly sessionId?: string
  readonly provider: GoalEvalProvider
}

export interface GoalEvalResponse {
  readonly goalMet: boolean
  readonly reason: string
}

export interface GoalEvalResult {
  readonly goalMet: boolean
  readonly evaluated: boolean
}

/**
 * Ask the server whether an active goal is met given the current conversation.
 * Returns `{ evaluated: false }` when the server is unreachable or responds
 * non-OK, so the caller can fall back to always injecting a keep-going message.
 */
export async function evaluateGoal(
  request: GoalEvalRequest,
): Promise<GoalEvalResult> {
  const port = env.VITE_BROWSEROS_SERVER_PORT
  if (!port) return { goalMet: false, evaluated: false }

  const { goal, sessionId, provider } = request
  const baseUrl = `http://127.0.0.1:${port}`
  const endpoint = `/agents/${encodeURIComponent(provider.agentId)}/goal/eval`

  const body: Record<string, unknown> = {
    goal,
    provider: provider.providerType,
    model: provider.modelId,
  }
  if (sessionId) body.sessionId = sessionId
  if (provider.apiKey) body.apiKey = provider.apiKey
  if (provider.baseUrl) body.baseUrl = provider.baseUrl
  if (provider.resourceName) body.resourceName = provider.resourceName

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)

  if (!response?.ok) {
    return { goalMet: false, evaluated: false }
  }

  const data = (await response
    .json()
    .catch(() => null)) as GoalEvalResponse | null
  if (!data || typeof data.goalMet !== 'boolean') {
    return { goalMet: false, evaluated: false }
  }

  return { goalMet: data.goalMet, evaluated: true }
}

/** Build a {@link GoalEvalProvider} from a resolved LLM provider config and optional harness agent id.
 *
 * Provider must have a `type` and `modelId` — those are required to reach the
 * server's model factory. Agent id is optional: model-backed providers
 * (Anthropic, OpenAI, etc.) use the sentinel `_`; ACP providers (Claude Code,
 * Codex) pass their harness agent id but the server will skip them anyway.
 */
export function toGoalEvalProvider(
  config: LlmProviderConfig | null | undefined,
  agentId: string | undefined,
): GoalEvalProvider | null {
  if (!config) return null
  return {
    providerType: config.type,
    modelId: config.modelId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    resourceName: config.resourceName,
    agentId: agentId ?? '_',
  }
}
