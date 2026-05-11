import { storage } from '@wxt-dev/storage'
import type {
  HarnessAdapterDescriptor,
  HarnessAgent,
  HarnessAgentAdapter,
} from '@/entrypoints/app/agents/agent-harness-types'
import type { LlmProviderConfig, ProviderType } from '@/lib/llm-providers/types'

/** Legacy key — kept for migration, no longer used for reads/writes. */
const SIDEPANEL_CHAT_TARGET_SELECTION_KEY =
  'browseros:sidepanel-chat-target-selection'

/**
 * Per-tab provider selection map, keyed by tab ID string.
 * Follows the same pattern as selectedTextStorage.
 */
export const chatTargetSelectionStorage = storage.defineItem<
  Record<string, SidepanelChatTargetSelection>
>('local:chatTargetSelectionMap', { defaultValue: {} })

export type SidepanelTargetKind = 'llm' | 'acp'

export type SidepanelChatTarget =
  | {
      kind: 'llm'
      id: string
      name: string
      type: ProviderType
      provider: LlmProviderConfig
    }
  | {
      kind: 'acp'
      id: string
      name: string
      type: 'acp'
      agentId: string
      adapter: HarnessAgentAdapter
      adapterName: string
      modelId: string
      modelLabel: string
      modelControl: HarnessAdapterDescriptor['modelControl']
      recommended?: boolean
      reasoningEffort: string
      reasoningEffortLabel?: string
    }

export type SidepanelChatTargetSelection = Pick<
  SidepanelChatTarget,
  'kind' | 'id'
>

interface BuildSidepanelChatTargetsInput {
  providers: LlmProviderConfig[]
  adapters: HarnessAdapterDescriptor[]
  agents?: HarnessAgent[]
}

interface ResolveSidepanelChatTargetInput {
  targets: SidepanelChatTarget[]
  defaultProviderId: string
  selection?: SidepanelChatTargetSelection | null
}

export function buildSidepanelChatTargets({
  providers,
  adapters,
  agents = [],
}: BuildSidepanelChatTargetsInput): SidepanelChatTarget[] {
  return [
    ...providers.map(toLlmTarget),
    ...agents.map((agent) => toAcpTargetForAgent(agent, adapters)),
  ]
}

function toAcpTargetForAgent(
  agent: HarnessAgent,
  adapters: HarnessAdapterDescriptor[],
): SidepanelChatTarget {
  const adapter = adapters.find((entry) => entry.id === agent.adapter)
  const modelId = agent.modelId ?? adapter?.defaultModelId ?? 'default'
  const reasoningEffort =
    agent.reasoningEffort ?? adapter?.defaultReasoningEffort ?? 'medium'
  const model = adapter?.models.find((entry) => entry.id === modelId)
  const reasoning = adapter?.reasoningEfforts.find(
    (effort) => effort.id === reasoningEffort,
  )
  return {
    kind: 'acp',
    id: agent.id,
    name: agent.name,
    type: 'acp',
    agentId: agent.id,
    adapter: agent.adapter,
    adapterName: adapter?.name ?? formatAdapterName(agent.adapter),
    modelId,
    modelLabel: model?.label ?? modelId,
    modelControl: adapter?.modelControl ?? 'best-effort',
    recommended: model?.recommended,
    reasoningEffort,
    reasoningEffortLabel: reasoning?.label,
  }
}

function formatAdapterName(adapter: HarnessAgentAdapter): string {
  if (adapter === 'claude') return 'Claude Code'
  if (adapter === 'codex') return 'Codex'
  if (adapter === 'openclaw') return 'OpenClaw'
  if (adapter === 'hermes') return 'Hermes'
  return adapter
}

export function resolveSidepanelChatTarget({
  targets,
  defaultProviderId,
  selection,
}: ResolveSidepanelChatTargetInput): SidepanelChatTarget | undefined {
  if (selection) {
    const selected = targets.find(
      (target) => target.kind === selection.kind && target.id === selection.id,
    )
    if (selected) return selected
  }
  return (
    targets.find(
      (target) => target.kind === 'llm' && target.id === defaultProviderId,
    ) ?? targets.find((target) => target.kind === 'llm')
  )
}

export function toLlmProviderConfig(
  target: SidepanelChatTarget | undefined,
): LlmProviderConfig | undefined {
  return target?.kind === 'llm' ? target.provider : undefined
}

/**
 * Persist the chat target selection for a specific tab.
 * Uses chrome.storage.local via @wxt-dev/storage for cross-context persistence.
 */
export async function persistSidepanelChatTargetSelection(
  target: SidepanelChatTarget | undefined,
  tabId: number,
): Promise<void> {
  const map = await chatTargetSelectionStorage.getValue()
  const key = String(tabId)
  if (target) {
    map[key] = { kind: target.kind, id: target.id }
  } else {
    delete map[key]
  }
  await chatTargetSelectionStorage.setValue(map)
}

/**
 * Load the chat target selection for a specific tab.
 * Falls back to legacy sessionStorage for migration, then returns null.
 */
export async function loadSidepanelChatTargetSelection(
  tabId: number,
): Promise<SidepanelChatTargetSelection | null> {
  const map = await chatTargetSelectionStorage.getValue()
  const key = String(tabId)
  if (map[key]) return map[key]
  // Migration: try legacy sessionStorage once
  try {
    const stored = window.sessionStorage.getItem(
      SIDEPANEL_CHAT_TARGET_SELECTION_KEY,
    )
    if (stored) {
      const legacy = JSON.parse(stored) as SidepanelChatTargetSelection
      // Migrate to per-tab storage and clear legacy
      map[key] = legacy
      await chatTargetSelectionStorage.setValue(map)
      window.sessionStorage.removeItem(SIDEPANEL_CHAT_TARGET_SELECTION_KEY)
      return legacy
    }
  } catch {
    // ignore
  }
  return null
}

function toLlmTarget(provider: LlmProviderConfig): SidepanelChatTarget {
  return {
    kind: 'llm',
    id: provider.id,
    name: provider.name,
    type: provider.type,
    provider,
  }
}
