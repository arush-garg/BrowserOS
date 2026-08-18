import { Lock } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  BREADCRUMB_LOGIN_RESUMED_EVENT,
  BREADCRUMB_LOGIN_VIEWED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { useChatSessionContext } from '@/modules/chat/chat-session-context'
import type { NudgeData } from './getMessageSegments'

type CardPhase = 'prompt' | 'resolved'

export interface LoginRequiredCardProps {
  data: NudgeData
  isLastMessage: boolean
}

export const LoginRequiredCard: FC<LoginRequiredCardProps> = ({
  data,
  isLastMessage,
}) => {
  const [phase, setPhase] = useState<CardPhase>(
    isLastMessage ? 'prompt' : 'resolved',
  )

  const { sendMessage } = useChatSessionContext()

  const url = (data.url as string) ?? ''
  const title = (data.title as string) ?? ''
  const reason = (data.reason as string) ?? ''

  useEffect(() => {
    if (!isLastMessage && phase !== 'resolved') {
      setPhase('resolved')
    }
  }, [isLastMessage, phase])

  const handleResume = () => {
    track(BREADCRUMB_LOGIN_RESUMED_EVENT)
    setPhase('resolved')
    sendMessage({
      text: 'I have logged in, continue with the task',
    })
  }

  const handleCancel = () => {
    track(BREADCRUMB_LOGIN_VIEWED_EVENT, { cancelled: true })
    setPhase('resolved')
    sendMessage({
      text: 'Cancel the login — continue without authenticating',
    })
  }

  if (phase === 'resolved') {
    return (
      <div className="rounded-lg border border-border/30 bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Lock className="h-3.5 w-3.5" />
          <span>{title ? `${title} —` : 'Login'} completed, continuing</span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <Lock className="h-5 w-5 shrink-0 text-[var(--accent-orange)]" />
        <div>
          <p className="font-medium text-sm">Authentication required</p>
          {title && (
            <p className="mt-0.5 text-muted-foreground text-xs">{title}</p>
          )}
          {url && (
            <p className="mt-1 truncate text-muted-foreground text-xs">{url}</p>
          )}
          {reason && (
            <p className="mt-1 text-muted-foreground text-xs">{reason}</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={handleResume}>
          I have logged in, continue
        </Button>
        <Button size="sm" variant="ghost" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
