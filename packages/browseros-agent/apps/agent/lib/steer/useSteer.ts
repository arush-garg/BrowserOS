/**
 * @fileoverview Steer hook — sends mid-turn guidance to the agent via
 * POST /chat/:conversationId/steer and tracks the queued status.
 */
import { useCallback, useRef, useState } from 'react'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

export type SteerStatus =
  | 'idle'
  | 'sending'
  | 'queued_active_turn'
  | 'queued_next_turn'
  | 'error'

interface EnqueueSteerResult {
  ok: true
  steerId: string
  status: 'queued_active_turn' | 'queued_next_turn'
}
interface EnqueueSteerError {
  ok: false
  error: string
}

async function enqueueSteer(
  conversationId: string,
  message: string,
  signal?: AbortSignal,
): Promise<EnqueueSteerResult | EnqueueSteerError> {
  let baseUrl: string
  try {
    baseUrl = await getAgentServerUrl()
  } catch {
    return { ok: false as const, error: 'Failed to resolve agent server URL' }
  }

  const url = `${baseUrl}/chat/${conversationId}/steer`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message }),
    signal,
  })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const json = await res.json()
      if (json?.message) message = json.message
    } catch {}
    return { ok: false, error: message }
  }

  const json = await res.json()
  return {
    ok: true,
    steerId: json.steerId as string,
    status: json.status as 'queued_active_turn' | 'queued_next_turn',
  }
}

export interface UseSteerOptions {
  conversationId: string
}

export interface UseSteerReturn {
  /** Whether the steer input row is visible */
  isExpanded: boolean
  /** Toggle the steer input row */
  toggleExpanded: () => void
  /** Collapse the steer input row */
  closeExpanded: () => void
  /** Current steer status */
  status: SteerStatus
  /** Last error message, cleared on next call */
  error: string | null
  /**
   * Send a steer message. The status transitions through:
   * sending → queued_active_turn | queued_next_turn | error
   */
  sendSteer: (text: string) => void
  /** Abort an in-flight request */
  abort: () => void
}

export function useSteer({ conversationId }: UseSteerOptions): UseSteerReturn {
  const [isExpanded, setIsExpanded] = useState(false)
  const [status, setStatus] = useState<SteerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const closeExpanded = useCallback(() => {
    setIsExpanded(false)
  }, [])

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const sendSteer = useCallback(
    (text: string) => {
      if (!text.trim()) return

      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      setError(null)
      setStatus('sending')

      enqueueSteer(conversationId, text.trim(), controller.signal)
        .then((result) => {
          if (result.ok) {
            setStatus(result.status)
            setIsExpanded(false)
          } else {
            setStatus('error')
            setError(result.error)
          }
        })
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return
          setStatus('error')
          setError(err instanceof Error ? err.message : String(err))
        })
    },
    [conversationId],
  )

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
    setStatus('idle')
  }, [])

  return {
    isExpanded,
    toggleExpanded,
    closeExpanded,
    status,
    error,
    sendSteer,
    abort,
  }
}
