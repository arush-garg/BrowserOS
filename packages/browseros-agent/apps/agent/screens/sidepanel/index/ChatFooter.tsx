import { Bot, ChevronDown, Folder, Layers, PlugZap, X } from 'lucide-react'
import type { FC, FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChatProviderSelector } from '@/components/chat/ChatProviderSelector'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { AppSelector } from '@/components/elements/AppSelector'
import { WorkspaceSelector } from '@/components/elements/workspace-selector'
import { McpServerIcon } from '@/components/mcp/McpServerIcon'
import { Feature } from '@/lib/browseros/capabilities'
import { BrowserOSIcon, ProviderIcon } from '@/lib/llm-providers/providerIcons'
import type { ProviderType } from '@/lib/llm-providers/types'
import { useMcpServers } from '@/lib/mcp/mcpServerStorage'
import {
  type SelectedTextData,
  selectedTextStorage,
} from '@/lib/selected-text/selectedTextStorage'
import type { UseSteerReturn } from '@/lib/steer/useSteer'
import { cn } from '@/lib/utils'
import { useCapabilities } from '@/modules/browseros/capabilities.hooks'
import type { ChatMode } from '@/modules/chat/chat-types'
import { useGetUserMCPIntegrations } from '@/modules/mcp/user-integrations.hooks'
import type { VoiceInputState } from '@/modules/voice/voice.hooks'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'
import { ChatAttachedTabs } from './ChatAttachedTabs'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ChatModeToggle } from './ChatModeToggle'
import { ChatSelectedText } from './ChatSelectedText'

export interface ChatFooterProps {
  providers: Provider[]
  selectedProvider: Provider
  onSelectProvider: (provider: Provider) => void
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  input: string
  onInputChange: (value: string) => void
  onSubmit: (e: FormEvent) => void
  status: 'streaming' | 'submitted' | 'ready' | 'error'
  onStop: () => void
  sendDisabled?: boolean
  attachedTabs: chrome.tabs.Tab[]
  onToggleTab: (tab: chrome.tabs.Tab) => void
  onRemoveTab: (tabId?: number) => void
  voice?: VoiceInputState
  activeTabId?: number | null
  steer?: UseSteerReturn
}

export const ChatFooter: FC<ChatFooterProps> = ({
  providers,
  selectedProvider,
  onSelectProvider,
  mode,
  onModeChange,
  input,
  onInputChange,
  onSubmit,
  status,
  onStop,
  sendDisabled,
  attachedTabs,
  onToggleTab,
  onRemoveTab,
  voice,
  activeTabId,
  steer,
}) => {
  const { selectedFolder } = useWorkspace()
  const { supports } = useCapabilities()
  const { servers: mcpServers } = useMcpServers()
  const { data: userMCPIntegrations } = useGetUserMCPIntegrations()
  const chatInputRef = useRef<ChatInputHandle>(null)
  const steerInputRef = useRef<HTMLInputElement>(null)
  const [selectionMap, setSelectionMap] = useState<
    Record<string, SelectedTextData>
  >({})

  // Watch selected text storage (per-tab map)
  useEffect(() => {
    selectedTextStorage.getValue().then(setSelectionMap)
    const unwatch = selectedTextStorage.watch(setSelectionMap)
    return () => unwatch()
  }, [])

  const visibleSelectedText = activeTabId
    ? (selectionMap[String(activeTabId)] ?? null)
    : null
  const [isTabMentionOpen, setIsTabMentionOpen] = useState(false)

  useEffect(() => {
    const focusInput = () => {
      const active = document.activeElement
      const isInteractiveElementFocused =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        active instanceof HTMLButtonElement
      if (!isInteractiveElementFocused) {
        chatInputRef.current?.focus()
      }
    }

    if (document.hasFocus()) {
      focusInput()
    }

    window.addEventListener('focus', focusInput)
    return () => window.removeEventListener('focus', focusInput)
  }, [])

  // Clear pending steer text when chat starts streaming (steer was injected)
  useEffect(() => {
    if (status === 'streaming') {
      steer?.clearPendingText()
    }
  }, [status, steer])

  const connectedManagedServers = mcpServers.filter((s) => {
    if (s.type !== 'managed' || !s.managedServerName) return false
    return userMCPIntegrations?.integrations?.find(
      (i) => i.name === s.managedServerName,
    )?.is_authenticated
  })

  return (
    <footer className="border-border/40 border-t bg-background/80 backdrop-blur-md">
      <ChatAttachedTabs tabs={attachedTabs} onRemoveTab={onRemoveTab} />
      {visibleSelectedText && (
        <ChatSelectedText
          selectedText={visibleSelectedText}
          onDismiss={() => {
            if (!activeTabId) return
            const key = String(activeTabId)
            selectedTextStorage.getValue().then((map) => {
              const { [key]: _, ...rest } = map
              selectedTextStorage.setValue(rest)
            })
          }}
        />
      )}

      <div className="p-3">
        <div className="flex items-center gap-2">
          <ChatProviderSelector
            providers={providers}
            selectedProvider={selectedProvider}
            onSelectProvider={onSelectProvider}
          >
            <button
              type="button"
              className="group relative inline-flex cursor-pointer items-center gap-2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-accent"
              title="Change AI Provider"
            >
              {selectedProvider.kind === 'acp' ? (
                <Bot className="h-4 w-4" />
              ) : selectedProvider.type === 'browseros' ? (
                <BrowserOSIcon size={16} />
              ) : (
                <ProviderIcon
                  type={selectedProvider.type as ProviderType}
                  size={16}
                />
              )}
              <span className="font-medium text-sm">
                {selectedProvider.name}
              </span>
              <ChevronDown className="h-3 w-3" />
            </button>
          </ChatProviderSelector>

          <div className="h-4 w-px bg-border/50" />

          <ChatModeToggle mode={mode} onModeChange={onModeChange} />

          <div className="h-4 w-px bg-border/50" />

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => chatInputRef.current?.toggleTabMention()}
              data-tab-mention-trigger
              data-state={isTabMentionOpen ? 'open' : 'closed'}
              aria-expanded={isTabMentionOpen}
              aria-haspopup="dialog"
              className="flex cursor-pointer items-center gap-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-accent"
              title="Attach tabs (@)"
            >
              <Layers className="h-4 w-4" />
              {attachedTabs.length > 0 && (
                <span className="font-medium text-[var(--accent-orange)] text-xs">
                  {attachedTabs.length}
                </span>
              )}
              <ChevronDown className="h-3 w-3" />
            </button>

            {supports(Feature.WORKSPACE_FOLDER_SUPPORT) && (
              <WorkspaceSelector side="top">
                <button
                  type="button"
                  className={cn(
                    'flex cursor-pointer items-center gap-1 rounded-lg p-1.5 transition-colors hover:bg-muted/50 data-[state=open]:bg-accent',
                    selectedFolder
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  title={
                    selectedFolder
                      ? selectedFolder.name
                      : 'Select workspace folder'
                  }
                >
                  <div className="relative">
                    <Folder className="h-4 w-4" />
                    {selectedFolder && (
                      <div className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[var(--accent-orange)]" />
                    )}
                  </div>
                  <ChevronDown className="h-3 w-3" />
                </button>
              </WorkspaceSelector>
            )}

            {supports(Feature.MANAGED_MCP_SUPPORT) && (
              <AppSelector side="top">
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-accent"
                  title="Connect apps"
                >
                  {connectedManagedServers.length > 0 ? (
                    <>
                      <div className="flex items-center -space-x-1">
                        {connectedManagedServers.slice(0, 3).map((s) => (
                          <div
                            key={s.id}
                            className="rounded-full ring-2 ring-background"
                          >
                            <McpServerIcon
                              serverName={s.managedServerName ?? ''}
                              size={14}
                            />
                          </div>
                        ))}
                      </div>
                      {connectedManagedServers.length > 3 && (
                        <span className="font-medium text-xs">
                          +{connectedManagedServers.length - 3}
                        </span>
                      )}
                    </>
                  ) : (
                    <PlugZap className="h-4 w-4" />
                  )}
                  <ChevronDown className="h-3 w-3" />
                </button>
              </AppSelector>
            )}
          </div>
        </div>

        {voice?.error && (
          <div className="mt-1 text-destructive text-xs">{voice.error}</div>
        )}

        {steer?.isExpanded && (
          <div className="flex flex-col gap-2 p-2 pt-0">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">Steer:</span>
              <input
                ref={steerInputRef}
                type="text"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Enter steer message..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    steer?.sendSteer(e.currentTarget.value)
                    e.currentTarget.value = ''
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const value = steerInputRef.current?.value ?? ''
                  steer?.sendSteer(value)
                  if (steerInputRef.current) steerInputRef.current.value = ''
                }}
                className="rounded-md bg-muted px-4 py-2 font-medium text-sm transition-colors hover:bg-muted/80"
              >
                Send
              </button>
            </div>
            {steer?.status === 'sending' && (
              <span className="text-muted-foreground text-xs">
                Sending steer!...
              </span>
            )}
            {steer?.status === 'queued_active_turn' && (
              <span className="text-green-500 text-xs">
                Steer queued for active turn.
              </span>
            )}
            {steer?.status === 'queued_next_turn' && (
              <span className="text-xs text-yellow-500">
                Steer queued for next turn.
              </span>
            )}
            {steer?.error && (
              <span className="text-red-500 text-xs">Error: {steer.error}</span>
            )}
          </div>
        )}

        {steer?.lastSentText && steer.status !== 'idle' && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-border/30 bg-muted/30 px-3 py-2">
            <Bot className="h-3 w-3 shrink-0 text-muted-foreground/50" />
            <p className="flex-1 truncate text-muted-foreground/70 text-sm italic">
              {steer.lastSentText}
            </p>
            <button
              type="button"
              onClick={steer.clearPendingText}
              className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <ChatInput
          input={input}
          status={status}
          mode={mode}
          sendDisabled={sendDisabled}
          onInputChange={onInputChange}
          onSubmit={onSubmit}
          onStop={onStop}
          selectedTabs={attachedTabs}
          onToggleTab={onToggleTab}
          onTabMentionOpenChange={setIsTabMentionOpen}
          voice={voice}
          steer={steer}
          ref={chatInputRef}
        />
      </div>
    </footer>
  )
}
