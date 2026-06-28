import type { FC } from 'react'
import { Outlet } from 'react-router'
import {
  ChatSessionProvider,
  useChatSessionContext,
} from '@/modules/chat/chat-session-context'
import { ChatHeader } from '@/screens/sidepanel/index/ChatHeader'

const ChatLayoutContent: FC = () => {
  const { selectedProvider, resetConversation, messages, isLoading } =
    useChatSessionContext()

  if (isLoading || !selectedProvider) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-6 text-center">
        <div className="space-y-3">
          <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <div className="space-y-1">
            <p className="font-medium text-foreground text-sm">
              Connecting to BrowserOS…
            </p>
            <p className="text-muted-foreground text-xs">
              Waiting for browser capabilities and agent data.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <ChatHeader
        selectedProvider={selectedProvider}
        onNewConversation={resetConversation}
        hasMessages={messages.length > 0}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}

export const ChatLayout: FC = () => {
  return (
    <ChatSessionProvider>
      <ChatLayoutContent />
    </ChatSessionProvider>
  )
}
