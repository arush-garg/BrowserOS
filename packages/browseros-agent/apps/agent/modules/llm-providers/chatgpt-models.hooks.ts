import { useQuery } from '@tanstack/react-query'
// Relative value import: `bun test` resolves tsconfig `@/` paths only for
// erased `import type`; a `@/` value import fails to load under bun test.
import { useAgentServerUrl } from '../browseros/agent-server-url.hooks'

/** A model the signed-in ChatGPT plan exposes, as reported by the backend. */
export interface ChatgptPlanModel {
  id: string
  name?: string
  description?: string
  contextWindow?: number
  reasoningEfforts?: string[]
  defaultEffort?: string
}

interface ChatgptModelsResponse {
  models?: ChatgptPlanModel[]
}

// The plan's model set changes with OpenAI's rollout cadence, not with a
// BrowserOS release, so it is re-read periodically rather than cached for the
// life of the extension.
const MODELS_STALE_TIME_MS = 5 * 60_000

/**
 * Models available to the signed-in ChatGPT plan. Resolves to an empty list
 * when the user is not signed in or the backend is unreachable, which callers
 * treat as "fall back to the built-in snapshot".
 */
export function useChatgptPlanModels(enabled: boolean) {
  const { baseUrl: agentServerUrl } = useAgentServerUrl()

  return useQuery<ChatgptPlanModel[]>({
    queryKey: ['chatgpt-plan-models', agentServerUrl],
    enabled: enabled && Boolean(agentServerUrl),
    staleTime: MODELS_STALE_TIME_MS,
    // A signed-out or offline user must not retry into the picker's critical
    // path; the built-in snapshot is shown instead.
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${agentServerUrl}/oauth/chatgpt-pro/models`)
      if (!res.ok) throw new Error('ChatGPT models unavailable')
      const body = (await res.json()) as ChatgptModelsResponse
      return body.models ?? []
    },
  })
}
