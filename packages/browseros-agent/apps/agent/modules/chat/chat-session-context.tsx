import {
  createContext,
  type FC,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useSyncRemoteIntegrations } from '@/modules/mcp/sync-remote-integrations.hooks'
import { type ChatSessionOptions, useChatSession } from './chat-session.hooks'

type ChatSessionContextValue = ReturnType<typeof useChatSession>

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null)

/** * Tracks the currently active browser tab ID via chrome.tabs.onActivated. * Shared across the sidepanel so all components use the same tab context. */
const useActiveTabId = (): number | null => {
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  useEffect(() => {
    const getActiveTab = async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        })
        if (tab?.id != null) setActiveTabId(tab.id)
      } catch {
        /* ignore */
      }
    }
    getActiveTab()
    const listener = (info: { tabId: number; windowId: number }) => {
      setActiveTabId(info.tabId)
    }
    chrome.tabs.onActivated.addListener(listener)
    return () => {
      chrome.tabs.onActivated.removeListener(listener)
    }
  }, [])
  return activeTabId
}

export const ChatSessionProvider: FC<
  { children: ReactNode } & Omit<ChatSessionOptions, 'activeTabId'>
> = ({ children, ...options }) => {
  const { hasSynced } = useSyncRemoteIntegrations()
  const activeTabId = useActiveTabId()
  const session = useChatSession({
    ...options,
    activeTabId,
    isIntegrationsSynced: hasSynced,
  })
  // Memoize the context value so consumer components don't cascade-render
  // when an ancestor (ThemeProvider, etc.) forces a re-render without any
  // actual chat state change. The hook return already changes identity on
  // every message / status update, so this only helps for idle re-renders,
  // but those are exactly the ones that trigger "Maximum update depth" loops.
  const value = useMemo(
    () => session,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      session.messages,
      session.status,
      session.chatError,
      session.conversationId,
      session,
    ],
  )
  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  )
}

export const useChatSessionContext = () => {
  const context = useContext(ChatSessionContext)
  if (!context) {
    throw new Error(
      'useChatSessionContext must be used within a ChatSessionProvider',
    )
  }
  return context
}
