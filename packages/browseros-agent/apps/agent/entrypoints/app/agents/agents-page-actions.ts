import type { NavigateFunction } from 'react-router'
import {
  AGENT_CREATED_EVENT,
  AGENT_DELETED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import type {
  HarnessAgent,
  HarnessAgentAdapter,
} from '../../../modules/agents/agent-harness-types'
import type {
  AgentListItem,
  CreateAgentRuntime,
} from '../../../modules/agents/agents-page-types'

export interface AgentPageActionInput {
  createRuntime: CreateAgentRuntime
  harnessModelId: string
  harnessReasoningEffort: string
  navigate: NavigateFunction
  newName: string
  createHarnessAgent: (input: {
    name: string
    adapter: HarnessAgentAdapter
    modelId?: string
    reasoningEffort?: string
    providerType?: string
    apiKey?: string
    baseUrl?: string
  }) => Promise<HarnessAgent>
  deleteHarnessAgent: (agentId: string) => Promise<unknown>
  setCreateError: (error: string | null) => void
  setCreateOpen: (open: boolean) => void
  setDeletingAgentKey: (key: string | null) => void
  setNewName: (name: string) => void
  setPageError: (error: string | null) => void
}

export function createAgentPageActions(input: AgentPageActionInput) {
  const runWithPageErrorHandling = async (fn: () => Promise<unknown>) => {
    input.setPageError(null)
    try {
      await fn()
    } catch (err) {
      input.setPageError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleHarnessCreate = async () => {
    if (!input.newName.trim()) return

    // Hermes runs the user's local binary against ~/.hermes, so it needs
    // no BrowserOS provider/key — only an optional model to launch with
    // (`hermes -m <model>`). 'default'/empty means use the ~/.hermes model.
    const effectiveModelId =
      input.harnessModelId && input.harnessModelId !== 'default'
        ? input.harnessModelId
        : undefined

    input.setCreateError(null)
    try {
      const agent = await input.createHarnessAgent({
        name: input.newName.trim(),
        adapter: input.createRuntime as HarnessAgentAdapter,
        modelId: effectiveModelId,
        reasoningEffort: input.harnessReasoningEffort || undefined,
      })
      input.setCreateOpen(false)
      input.setNewName('')
      track(AGENT_CREATED_EVENT, {
        runtime: input.createRuntime,
        model_id: effectiveModelId,
        reasoning_effort: input.harnessReasoningEffort || undefined,
      })
      input.navigate(`/agents/${agent.id}`)
    } catch (err) {
      input.setCreateError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreate = () => {
    const createByRuntime: Record<CreateAgentRuntime, () => Promise<void>> = {
      claude: handleHarnessCreate,
      codex: handleHarnessCreate,
      hermes: handleHarnessCreate,
    }
    void createByRuntime[input.createRuntime]()
  }

  const handleDelete = async (agent: AgentListItem) => {
    input.setDeletingAgentKey(agent.key)
    await runWithPageErrorHandling(async () => {
      await input.deleteHarnessAgent(agent.agentId)
      track(AGENT_DELETED_EVENT, {
        runtime: agent.source,
        agent_id: agent.agentId,
      })
    })
    input.setDeletingAgentKey(null)
  }

  return {
    handleCreate,
    handleDelete,
    runWithPageErrorHandling,
  }
}
