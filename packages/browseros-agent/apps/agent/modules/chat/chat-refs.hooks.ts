import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useDeepCompareEffect from 'use-deep-compare-effect'
import { Feature } from '@/lib/browseros/capabilities'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import { type McpServer, useMcpServers } from '@/lib/mcp/mcpServerStorage'
import { usePersonalization } from '@/lib/personalization/personalizationStorage'
import {
  useAgentAdapters,
  useHarnessAgents,
} from '@/modules/agents/agents.hooks'
import { useCapabilities } from '@/modules/browseros/capabilities.hooks'
import { useLlmProviders } from '@/modules/llm-providers/llm-providers.hooks'
import {
  buildSidepanelChatTargets,
  chatTargetSelectionStorage,
  loadSidepanelChatTargetSelection,
  persistSidepanelChatTargetSelection,
  resolveSidepanelChatTarget,
  type SidepanelChatTarget,
  type SidepanelChatTargetSelection,
} from './sidepanel-chat-targets'

const constructMcpServers = (servers: McpServer[]) => {
  return servers
    .filter((eachServer) => eachServer.type === 'managed')
    .map((each) => each.managedServerName)
}

const constructCustomServers = (servers: McpServer[]) => {
  return servers
    .filter((eachServer) => eachServer.type === 'custom')
    .map((each) => ({
      name: each.displayName,
      url: each.config?.url,
    }))
}

interface UseChatRefsOptions {
  activeTabId?: number | null
}

export const useChatRefs = ({ activeTabId }: UseChatRefsOptions = {}) => {
  const { servers: mcpServers } = useMcpServers()
  const {
    providers: llmProviders,
    selectedProvider: selectedLlmProvider,
    setDefaultProvider,
    isLoading: isLoadingProviders,
  } = useLlmProviders()
  const { adapters, loading: isLoadingAdapters } = useAgentAdapters()
  const { harnessAgents, loading: isLoadingAgents } = useHarnessAgents()
  const { supports } = useCapabilities()
  const hermesAgentSupported = supports(Feature.HERMES_AGENT_SUPPORT)
  const { personalization } = usePersonalization()

  const [targetSelection, setTargetSelection] =
    useState<SidepanelChatTargetSelection | null>(null)

  // Load per-tab selection when activeTabId changes
  useEffect(() => {
    if (activeTabId == null) {
      setTargetSelection(null)
      return
    }
    let cancelled = false
    loadSidepanelChatTargetSelection(activeTabId).then((selection) => {
      if (!cancelled) setTargetSelection(selection)
    })
    return () => {
      cancelled = true
    }
  }, [activeTabId])

  // Watch for external changes to the per-tab selection storage
  useEffect(() => {
    const unwatch = chatTargetSelectionStorage.watch((map) => {
      if (activeTabId == null) return
      const key = String(activeTabId)
      setTargetSelection(map[key] ?? null)
    })
    return unwatch
  }, [activeTabId])

  const chatTargets = useMemo(
    () =>
      buildSidepanelChatTargets({
        providers: llmProviders,
        adapters,
        agents: harnessAgents,
        hermesAgentSupported,
      }),
    [llmProviders, adapters, harnessAgents, hermesAgentSupported],
  )

  const selectedChatTarget = useMemo(
    () =>
      resolveSidepanelChatTarget({
        targets: chatTargets,
        defaultProviderId: selectedLlmProvider?.id ?? llmProviders[0]?.id ?? '',
        selection: targetSelection,
      }),
    [chatTargets, llmProviders, selectedLlmProvider, targetSelection],
  )

  const selectedLlmProviderRef = useRef<LlmProviderConfig | null>(
    selectedLlmProvider,
  )
  const selectedChatTargetRef = useRef<SidepanelChatTarget | undefined>(
    selectedChatTarget,
  )
  const enabledMcpServersRef = useRef(constructMcpServers(mcpServers))
  const enabledCustomServersRef = useRef(constructCustomServers(mcpServers))
  const personalizationRef = useRef(personalization)

  useDeepCompareEffect(() => {
    selectedLlmProviderRef.current = selectedLlmProvider
    enabledMcpServersRef.current = constructMcpServers(mcpServers)
    enabledCustomServersRef.current = constructCustomServers(mcpServers)
  }, [selectedLlmProvider, mcpServers])

  useEffect(() => {
    selectedChatTargetRef.current = selectedChatTarget
  }, [selectedChatTarget])

  useEffect(() => {
    personalizationRef.current = personalization
  }, [personalization])

  const selectChatTarget = useCallback(
    async (target: SidepanelChatTarget | undefined) => {
      selectedChatTargetRef.current = target
      setTargetSelection(target ? { kind: target.kind, id: target.id } : null)
      if (activeTabId != null) {
        await persistSidepanelChatTargetSelection(target, activeTabId)
      }
    },
    [activeTabId],
  )

  return {
    selectedLlmProviderRef,
    selectedChatTargetRef,
    enabledMcpServersRef,
    enabledCustomServersRef,
    personalizationRef,
    llmProviders,
    setDefaultProvider,
    chatTargets,
    selectedChatTarget,
    selectChatTarget,
    selectedLlmProvider,
    isLoadingProviders:
      isLoadingProviders || isLoadingAdapters || isLoadingAgents,
  }
}
