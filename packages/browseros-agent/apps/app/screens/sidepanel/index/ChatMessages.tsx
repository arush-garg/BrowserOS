import type { UIMessage } from 'ai'
import { Bot } from 'lucide-react'
import { type FC, Fragment } from 'react'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import type { ChatAction } from '@/lib/chat-actions/types'
import { cn } from '@/lib/utils'
import { ChatMessageActions } from './ChatMessageActions'
import { ConnectAppCard } from './ConnectAppCard'
import { getMessageSegments } from './getMessageSegments'
import { JtbdPopup } from './JtbdPopup'
import { LoginRequiredCard } from './LoginRequiredCard'
import { ScheduleSuggestionCard } from './ScheduleSuggestionCard'
import { ToolBatch } from './ToolBatch'
import { UserActionMessage } from './UserActionMessage'

export interface SteerMessageItem {
  id: string
  text: string
  status: 'pending' | 'injected'
  /** Index into the messages array after which this steer should appear. */
  afterMessageIndex: number
}

export interface ChatMessagesProps {
  messages: UIMessage[]
  status: 'streaming' | 'submitted' | 'ready' | 'error'
  steerMessages?: SteerMessageItem[]
  getActionForMessage?: (message: UIMessage) => ChatAction | undefined
  liked: Record<string, boolean>
  onClickLike: (messageId: string) => void
  disliked: Record<string, boolean>
  onClickDislike: (messageId: string, comment?: string) => void
  showJtbdPopup: boolean
  showDontShowAgain: boolean
  onTakeSurvey: (opts?: { dontShowAgain?: boolean }) => void
  onDismissJtbdPopup: (dontShowAgain: boolean) => void
}

export const ChatMessages: FC<ChatMessagesProps> = ({
  messages,
  status,
  getActionForMessage,
  liked,
  disliked,
  onClickLike,
  onClickDislike,
  steerMessages,
  showJtbdPopup,
  showDontShowAgain,
  onTakeSurvey,
  onDismissJtbdPopup,
}) => {
  const isStreaming = status === 'streaming' || status === 'submitted'

  return (
    <>
      <Conversation className="ph-mask">
        <ConversationContent>
          {messages.map((message, messageIndex) => {
            const action = getActionForMessage?.(message)
            const isLastMessage = messageIndex === messages.length - 1
            const segments = getMessageSegments(
              message,
              isLastMessage,
              isStreaming,
            )
            const toolBatches = segments.filter((s) => s.type === 'tool-batch')
            const lastToolBatchKey = toolBatches[toolBatches.length - 1]?.key

            const messageText = segments
              ?.filter((each) => each.type === 'text')
              ?.map((each) => each.text)
              ?.join('\n\n')

            const likeAction = () => onClickLike(message.id)
            const dislikeAction = (comment?: string) =>
              onClickDislike(message.id, comment)

            // Steers sent after this message but before the next one
            const steersAfterThis = steerMessages?.filter(
              (s) => s.afterMessageIndex === messageIndex,
            )

            return (
              <Fragment key={message.id}>
                <Message from={message.role}>
                  <MessageContent>
                    {action ? (
                      <UserActionMessage action={action} />
                    ) : (
                      segments.map((segment) => {
                        switch (segment.type) {
                          case 'text':
                            return (
                              <MessageResponse key={segment.key}>
                                {segment.text}
                              </MessageResponse>
                            )
                          case 'reasoning':
                            return (
                              <Reasoning
                                key={segment.key}
                                className="w-full"
                                isStreaming={segment.isStreaming}
                              >
                                <ReasoningTrigger />
                                <ReasoningContent>
                                  {segment.text}
                                </ReasoningContent>
                              </Reasoning>
                            )
                          case 'tool-batch':
                            return (
                              <ToolBatch
                                key={segment.key}
                                tools={segment.tools}
                                isLastBatch={segment.key === lastToolBatchKey}
                                isLastMessage={isLastMessage}
                                isStreaming={isStreaming}
                              />
                            )
                          case 'nudge':
                            return segment.nudgeType ===
                              'schedule_suggestion' ? (
                              <ScheduleSuggestionCard
                                key={segment.key}
                                data={segment.data}
                                isLastMessage={isLastMessage}
                              />
                            ) : segment.nudgeType === 'login_required' ? (
                              <LoginRequiredCard
                                key={segment.key}
                                data={segment.data}
                                isLastMessage={isLastMessage}
                              />
                            ) : (
                              <ConnectAppCard
                                key={segment.key}
                                data={segment.data}
                                isLastMessage={isLastMessage}
                              />
                            )
                          default:
                            return null
                        }
                      })
                    )}
                  </MessageContent>
                </Message>
                {message.role === 'assistant' &&
                (!isLastMessage || !isStreaming) ? (
                  <ChatMessageActions
                    messageId={message.id}
                    messageText={messageText}
                    liked={liked[message.id] ?? false}
                    disliked={disliked[message.id] ?? false}
                    onClickLike={likeAction}
                    onClickDislike={dislikeAction}
                  />
                ) : null}
                {steersAfterThis?.map((msg) => (
                  <Fragment key={msg.id}>
                    <Message from="user">
                      <MessageContent>
                        <div
                          className={cn(
                            'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
                            msg.status === 'pending'
                              ? 'border-2 border-[var(--accent-orange)]/50 border-dashed bg-muted/30 text-muted-foreground italic'
                              : 'border border-border/50 border-solid bg-muted/50',
                          )}
                        >
                          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
                          <span>{msg.text}</span>
                        </div>
                      </MessageContent>
                    </Message>
                  </Fragment>
                ))}
              </Fragment>
            )
          })}
          {showJtbdPopup && (
            <JtbdPopup
              onTakeSurvey={onTakeSurvey}
              onDismiss={onDismissJtbdPopup}
              showDontShowAgain={showDontShowAgain}
            />
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {isStreaming && (
        <div className="flex animate-fadeInUp gap-2 px-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-orange)] text-white">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <div className="flex items-center gap-1 rounded-xl rounded-tl-none border border-border/50 bg-card px-3 py-2.5 shadow-sm">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-orange)] [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-orange)] [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-orange)]" />
          </div>
        </div>
      )}
      <div />
    </>
  )
}
