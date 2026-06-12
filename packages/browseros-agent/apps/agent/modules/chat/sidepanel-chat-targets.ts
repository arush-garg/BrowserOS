import { storage } from '@wxt-dev/storage'
import type { LlmProviderConfig, ProviderType } from '@/lib/llm-providers/types'
import type {
  HarnessAdapterDescriptor,
  HarnessAgent,
  HarnessAgentAdapter,
} from '@/modules/agents/agent-harness-types'
// Relative (not `@/`) so this module stays loadable under `bun test`, which
// resolves tsconfig `@/` aliases for erased type imports only, not values.
import { visibleHarnessAgents } from '../../lib/chat/adapter-visibility'
import {
  isChatProviderType,
  resolveChatProvider,
} from '../../lib/llm-providers/provider-runtime'

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

export interface BuildSidepanelChatTargetsInput {
  providers: LlmProviderConfig[]
  adapters: HarnessAdapterDescriptor[]
  agents?: HarnessAgent[]
  hermesAgentSupported?: boolean
}

export interface ResolveSidepanelChatTargetInput {
  targets: SidepanelChatTarget[]
  defaultProviderId: string
  selection?: SidepanelChatTargetSelection | null
}

export interface SidepanelChatTargetSelectionWriter {
  setValue(value: SidepanelChatTargetSelection | null): Promise<void>
}

export interface SidepanelChatTargetSelectionReader {
  getValue(): Promise<SidepanelChatTargetSelection | null>
}

export interface SidepanelChatTargetSelectionWatcher {
  watch(
    callback: (selection: SidepanelChatTargetSelection | null) => void,
  ): () => void
}

type SidepanelChatTargetSelectionStore = SidepanelChatTargetSelectionReader &
  SidepanelChatTargetSelectionWriter &
  SidepanelChatTargetSelectionWatcher

let sidepanelChatTargetSelectionStorage:
  | SidepanelChatTargetSelectionStore
  | undefined

export function buildSidepanelChatTargets({
  providers,
  adapters,
  agents = [],
  hermesAgentSupported = false,
}: BuildSidepanelChatTargetsInput): SidepanelChatTarget[] {
  return [
    ...providers
      .filter((provider) => isChatProviderType(provider.type))
      .map(toLlmTarget),
    ...visibleHarnessAgents(agents, hermesAgentSupported).map((agent) =>
      toAcpTargetForAgent(agent, adapters),
    ),
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

  const llmTargets = targets.filter((target) => target.kind === 'llm')
  const provider = resolveChatProvider(
    llmTargets.map((target) => target.provider),
    defaultProviderId,
  )
  return provider
    ? llmTargets.find((target) => target.id === provider.id)
    : undefined
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
 * Wraps chatTargetSelectionStorage into the store interface used by
 * the ACP helpers below. Returns a singleton so watch/listener
 * lifetime is well-defined.
 */
async function getSidepanelChatTargetSelectionStorage(): Promise<SidepanelChatTargetSelectionStore> {
  if (!sidepanelChatTargetSelectionStorage) {
    sidepanelChatTargetSelectionStorage = {
      getValue: async () => {
        const map = await chatTargetSelectionStorage.getValue()
        const entries = Object.values(map)
        return entries.length > 0 ? (entries[0] ?? null) : null
      },
      setValue: async (value) => {
        if (value) {
          // Store as a single-entry map (backed by per-tab map storage)
          const map = await chatTargetSelectionStorage.getValue()
          const tabIds = Object.keys(map)
          const key = tabIds[0] ?? 'default'
          map[key] = value
          await chatTargetSelectionStorage.setValue(map)
        } else {
          await chatTargetSelectionStorage.setValue({})
        }
      },
      watch: (callback) =>
        chatTargetSelectionStorage.watch((map) => {
          const entries = Object.values(map ?? {})
          callback(entries.length > 0 ? (entries[0] ?? null) : null)
        }),
    }
  }
  return sidepanelChatTargetSelectionStorage
}

/** Writes a selection identity (or null to clear) without needing a full target. */
export async function saveSidepanelChatTargetSelection(
  selection: SidepanelChatTargetSelection | null,
  store?: SidepanelChatTargetSelectionWriter,
): Promise<void> {
  const targetStore = store ?? (await getSidepanelChatTargetSelectionStorage())
  await targetStore.setValue(selection)
}

/** Clears the persisted selection only when it points at the given agent. */
export async function clearSidepanelChatTargetSelectionForAgent(
  agentId: string,
  store?: SidepanelChatTargetSelectionReader &
    SidepanelChatTargetSelectionWriter,
): Promise<void> {
  const targetStore = store ?? (await getSidepanelChatTargetSelectionStorage())
  const selection = await targetStore.getValue()
  if (selection?.kind === 'acp' && selection.id === agentId) {
    await targetStore.setValue(null)
  }
}

/**
 * Subscribes to selection changes. The production store loads lazily, so the
 * subscription may attach a tick later; the returned unsubscribe is always
 * synchronous and safe to call before attachment completes.
 */
export function watchSidepanelChatTargetSelection(
  callback: (selection: SidepanelChatTargetSelection | null) => void,
  store?: SidepanelChatTargetSelectionWatcher,
): () => void {
  if (store) return store.watch(callback)

  let cancelled = false
  let unwatch: (() => void) | undefined
  getSidepanelChatTargetSelectionStorage()
    .then((targetStore) => {
      if (cancelled) return
      unwatch = targetStore.watch(callback)
    })
    // Failed storage import leaves the watch inert; this module stays
    // sentry-free for bun-test loadability, and the load path surfaces the
    // same failure to callers, who report it.
    .catch(() => undefined)
  return () => {
    cancelled = true
    unwatch?.()
  }
}
export async function loadSidepanelChatTargetSelection(
  tabId?: number,
): Promise<SidepanelChatTargetSelection | null> {
  const map = await chatTargetSelectionStorage.getValue()
  if (tabId === undefined) return null
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
