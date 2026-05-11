import {
  createContext,
  type FC,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react'
import { useSyncRemoteIntegrations } from '@/lib/mcp/useSyncRemoteIntegrations'
import {
  type ChatSessionOptions,
  useChatSession,
} from '../index/useChatSession'

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
    const listener = (info: chrome.tabs.TabActiveInfo) => {
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
  return (
    <ChatSessionContext.Provider value={session}>
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
