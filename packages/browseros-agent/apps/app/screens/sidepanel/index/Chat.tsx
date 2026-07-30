import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import {
  GOAL_CONTINUE_EVENT,
  GOAL_SET_EVENT,
  SIDEPANEL_AI_TRIGGERED_EVENT,
  SIDEPANEL_MODE_CHANGED_EVENT,
  SIDEPANEL_STOP_CLICKED_EVENT,
  SIDEPANEL_SUGGESTION_CLICKED_EVENT,
  SIDEPANEL_TAB_REMOVED_EVENT,
  SIDEPANEL_TAB_TOGGLED_EVENT,
  SIDEPANEL_VOICE_ERROR_EVENT,
  SIDEPANEL_VOICE_RECORDING_STARTED_EVENT,
  SIDEPANEL_VOICE_RECORDING_STOPPED_EVENT,
  SIDEPANEL_VOICE_TRANSCRIPTION_COMPLETED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { goalStorage } from '@/lib/goal/goal-storage'
import { evaluateGoal, toGoalEvalProvider } from '@/lib/goal/goalEval'
import { track } from '@/lib/metrics/track'
import { useSteer } from '@/lib/steer/useSteer'
import { useChatSessionContext } from '@/modules/chat/chat-session-context'
import type { ChatMode } from '@/modules/chat/chat-types'
import { useJtbdPopup } from '@/modules/jtbd-popup/jtbd-popup.hooks'
import { useLlmProviders } from '@/modules/llm-providers/llm-providers.hooks'
import { useVoiceInput } from '@/modules/voice/voice.hooks'
import {
  type ChatSessionLike,
  useVoiceLoop,
} from '@/modules/voice/voice-loop.hooks'
import { buildChatErrorProps } from './Chat.helpers'
import { ChatEmptyState } from './ChatEmptyState'
import { ChatError } from './ChatError'
import { ChatFooter } from './ChatFooter'
import { ChatMessages } from './ChatMessages'
import { IncognitoNotice } from './IncognitoNotice'

const RESTORE_LOADING_TIMEOUT_MS = 12000

/**
 * @public
 */
export const Chat = () => {
  const {
    mode,
    setMode,
    messages,
    sendMessage,
    status,
    stop,
    providers,
    agentUrlError,
    chatError,
    canSend,
    selectedProvider,
    handleSelectProvider,
    getActionForMessage,
    liked,
    onClickLike,
    disliked,
    onClickDislike,
    isRestoringConversation,
    activeTabId,
    conversationId,
    vmStatus,
    isIncognito,
    retryLastTurn,
  } = useChatSessionContext()

  const steer = useSteer({ conversationId })
  const { selectedProvider: selectedLlmProvider } = useLlmProviders()

  interface SteerMessageItem {
    id: string
    text: string
    status: 'pending' | 'injected'
  }
  const [steerMessages, setSteerMessages] = useState<SteerMessageItem[]>([])

  // When a steer is sent, optimistically add it to the chat frame as pending.
  const handleSteerSent = useCallback((text: string) => {
    setSteerMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text, status: 'pending' as const },
    ])
  }, [])

  const {
    popupVisible,
    showDontShowAgain,
    recordMessageSent,
    triggerIfEligible,
    onTakeSurvey,
    onDismiss: onDismissJtbdPopup,
  } = useJtbdPopup()

  const voice = useVoiceInput()
  const chatSessionRef = useRef<ChatSessionLike | null>(null)
  chatSessionRef.current = { sendMessage, stop, status, messages }
  const voiceLoop = useVoiceLoop({ chatSessionRef })

  const [input, setInput] = useState('')
  const [attachedTabs, setAttachedTabs] = useState<chrome.tabs.Tab[]>([])
  const [mounted, setMounted] = useState(false)
  const [restoreTimedOut, setRestoreTimedOut] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    ;(async () => {
      const currentTab = (
        await chrome.tabs.query({
          active: true,
          currentWindow: true,
        })
      ).filter((tab) => tab.url?.startsWith('http'))
      setAttachedTabs(currentTab)
    })()
  }, [])

  useEffect(() => {
    if (!isRestoringConversation) {
      setRestoreTimedOut(false)
      return
    }

    const timeoutId = setTimeout(() => {
      setRestoreTimedOut(true)
    }, RESTORE_LOADING_TIMEOUT_MS)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [isRestoringConversation])

  // Trigger JTBD popup when AI finishes responding
  const previousChatStatus = useRef(status)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only trigger on status change
  useEffect(() => {
    const aiWasProcessing =
      previousChatStatus.current === 'streaming' ||
      previousChatStatus.current === 'submitted'
    const aiJustFinished = aiWasProcessing && status === 'ready'

    if (aiJustFinished && messages.length > 0) {
      triggerIfEligible()
    }
    previousChatStatus.current = status
  }, [status])

  // Goal keep-going: when AI finishes and a goal is active, ask the server whether
  // the goal is met. Continue only when evaluation says the goal is not yet met.
  // Any failure (no server, bad response, network error) falls back to injecting
  // a keep-going message so an active goal never silently stalls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only trigger on status change
  useEffect(() => {
    const aiWasProcessing =
      previousChatStatus.current === 'streaming' ||
      previousChatStatus.current === 'submitted'
    const aiJustFinished = aiWasProcessing && status === 'ready'
    const aiErrored = aiWasProcessing && status === 'error'

    if (!aiJustFinished && !aiErrored) return

    goalStorage.getValue().then(async (goal) => {
      if (!goal?.active) return
      if (aiErrored) {
        goalStorage.setValue({ ...goal, active: false })
        return
      }

      const continueMessage = `Keep going with the goal: ${goal.goal}`
      const provider = toGoalEvalProvider(
        selectedLlmProvider,
        selectedProvider?.agentId,
      )
      if (!provider) {
        track(GOAL_CONTINUE_EVENT)
        sendMessage({ text: continueMessage })
        return
      }

      const result = await evaluateGoal({
        goal: goal.goal,
        sessionId: conversationId,
        provider,
      })

      if (result.evaluated && result.goalMet) {
        goalStorage.setValue({ ...goal, active: false })
        return
      }

      track(GOAL_CONTINUE_EVENT)
      sendMessage({ text: continueMessage })
    })
  }, [status])

  // Insert transcript into input when transcription completes
  // biome-ignore lint/correctness/useExhaustiveDependencies: only trigger on transcript/transcribing change
  useEffect(() => {
    if (voice.transcript && !voice.isTranscribing) {
      setInput((prev) => {
        const separator = prev.trim() ? ' ' : ''
        return prev + separator + voice.transcript
      })
      track(SIDEPANEL_VOICE_TRANSCRIPTION_COMPLETED_EVENT)
      voice.clearTranscript()
    }
  }, [voice.transcript, voice.isTranscribing])

  // Track voice errors
  useEffect(() => {
    if (voice.error) {
      track(SIDEPANEL_VOICE_ERROR_EVENT, { error: voice.error })
    }
  }, [voice.error])

  const handleModeChange = (newMode: ChatMode) => {
    track(SIDEPANEL_MODE_CHANGED_EVENT, { from: mode, to: newMode })
    setMode(newMode)
  }

  const handleStop = () => {
    track(SIDEPANEL_STOP_CLICKED_EVENT)
    stop()
  }

  const toggleTabSelection = (tab: chrome.tabs.Tab) => {
    setAttachedTabs((prev) => {
      const isSelected = prev.some((t) => t.id === tab.id)
      track(SIDEPANEL_TAB_TOGGLED_EVENT, {
        action: isSelected ? 'removed' : 'added',
      })
      if (isSelected) {
        return prev.filter((t) => t.id !== tab.id)
      }
      return [...prev, tab]
    })
  }

  const removeTab = (tabId?: number) => {
    track(SIDEPANEL_TAB_REMOVED_EVENT)
    setAttachedTabs((prev) => prev.filter((t) => t.id !== tabId))
  }

  const executeMessage = (customMessageText?: string) => {
    const messageText = customMessageText ? customMessageText : input.trim()
    if (!messageText) return

    // Handle /goal slash command
    if (messageText.startsWith('/goal ')) {
      const goalText = messageText.slice(6).trim()
      if (goalText) {
        goalStorage.setValue({
          goal: goalText,
          active: true,
          createdAt: Date.now(),
        })
        track(GOAL_SET_EVENT)
      }
      setInput('')
      setAttachedTabs([])
      return
    }

    recordMessageSent()

    if (attachedTabs.length) {
      const action = createBrowserOSAction({
        mode,
        message: messageText,
        tabs: attachedTabs,
      })
      sendMessage({ text: messageText, action })
    } else {
      sendMessage({ text: messageText })
    }
    setInput('')
    setAttachedTabs([])
  }

  // Interrupt the agent, then send text as a normal message.
  const handleInterruptAndSend = useCallback(
    (text: string) => {
      stop()
      recordMessageSent()
      if (attachedTabs.length) {
        const action = createBrowserOSAction({
          mode,
          message: text,
          tabs: attachedTabs,
        })
        sendMessage({ text, action })
      } else {
        sendMessage({ text })
      }
      setAttachedTabs([])
    },
    [stop, sendMessage, mode, attachedTabs, recordMessageSent],
  )

  // When the agent starts streaming, mark pending steer messages as injected (solid).
  const prevChatStatusRef = useRef(status)
  useEffect(() => {
    if (status === 'streaming' && prevChatStatusRef.current !== 'streaming') {
      setSteerMessages((prev) =>
        prev.map((m) =>
          m.status === 'pending' ? { ...m, status: 'injected' as const } : m,
        ),
      )
    }
    prevChatStatusRef.current = status
  }, [status])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (messages.length === 0) {
      track(SIDEPANEL_AI_TRIGGERED_EVENT, {
        mode,
        tabs_count: attachedTabs.length,
      })
    }
    executeMessage()
  }

  const handleSuggestionClick = (suggestion: string) => {
    track(SIDEPANEL_SUGGESTION_CLICKED_EVENT, { mode })
    executeMessage(suggestion)
  }

  const handleStartRecording = async () => {
    const started = await voice.startRecording()
    if (started) {
      track(SIDEPANEL_VOICE_RECORDING_STARTED_EVENT)
    }
  }

  const handleStopRecording = async () => {
    await voice.stopRecording()
    track(SIDEPANEL_VOICE_RECORDING_STOPPED_EVENT)
  }

  const voiceState = {
    isRecording: voice.isRecording,
    isTranscribing: voice.isTranscribing,
    audioLevels: voice.audioLevels,
    error: voice.error,
    onStartRecording: handleStartRecording,
    onStopRecording: handleStopRecording,
  }

  const chatErrorProps = buildChatErrorProps({
    chatError,
    selectedProvider,
    retryLastTurn,
  })

  return (
    <>
      <main className="mt-4 flex h-full flex-1 flex-col space-y-4 overflow-y-auto">
        {isRestoringConversation ? (
          <div className="flex flex-1 items-center justify-center">
            {restoreTimedOut ? (
              <ChatError
                error={
                  new Error(
                    'Loading took longer than expected. Try sending a message to re-establish the connection.',
                  )
                }
                providerType={selectedProvider?.type}
              />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : messages.length === 0 ? (
          <ChatEmptyState
            mode={mode}
            mounted={mounted}
            onSuggestionClick={handleSuggestionClick}
          />
        ) : (
          <ChatMessages
            messages={messages}
            status={status}
            steerMessages={steerMessages}
            getActionForMessage={getActionForMessage}
            liked={liked}
            onClickLike={onClickLike}
            disliked={disliked}
            onClickDislike={onClickDislike}
            showJtbdPopup={popupVisible}
            showDontShowAgain={showDontShowAgain}
            onTakeSurvey={onTakeSurvey}
            onDismissJtbdPopup={onDismissJtbdPopup}
          />
        )}
        {agentUrlError && (
          <ChatError
            error={agentUrlError}
            providerType={selectedProvider?.type}
          />
        )}
        {chatErrorProps && <ChatError {...chatErrorProps} />}
      </main>

      {isIncognito && <IncognitoNotice />}

      <ChatFooter
        providers={providers}
        selectedProvider={selectedProvider}
        onSelectProvider={handleSelectProvider}
        mode={mode}
        onModeChange={handleModeChange}
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        status={status}
        onStop={handleStop}
        sendDisabled={!canSend}
        attachedTabs={attachedTabs}
        onToggleTab={toggleTabSelection}
        onRemoveTab={removeTab}
        voice={voiceState}
        activeTabId={activeTabId}
        steer={steer}
        onSteerSent={handleSteerSent}
        onInterruptAndSend={handleInterruptAndSend}
        voiceLoop={voiceLoop}
        onOpenVoiceMode={voiceLoop.open}
      />
    </>
  )
}
