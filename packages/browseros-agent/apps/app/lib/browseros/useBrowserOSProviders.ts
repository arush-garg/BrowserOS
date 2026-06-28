import { useEffect, useState } from 'react'
import { getAgentServerUrl } from './helpers'

const AGENT_URL_LOAD_TIMEOUT_MS = 60000
const AGENT_URL_RETRY_ATTEMPTS = 5

interface UseAgentServerUrlResult {
  baseUrl: string | null
  isLoading: boolean
  error: Error | null
  isRetrying: boolean
}

/**
 * @public
 */
export function useAgentServerUrl(): UseAgentServerUrlResult {
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [_reloadToken, setReloadToken] = useState(0)
  const [attemptCount, setAttemptCount] = useState(0)
  const [isRetrying, setIsRetrying] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timeoutId: NodeJS.Timeout | null = null
    const controller = new AbortController()

    const loadUrl = async () => {
      try {
        setError(null)
        setIsRetrying(false)
        const url = await getAgentServerUrl()
        if (!cancelled) {
          setBaseUrl(url)
          setIsLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          // Set timeout for this attempt if not already set
          if (!timeoutId) {
            timeoutId = setTimeout(() => {
              if (!cancelled && !baseUrl) {
                setError(e instanceof Error ? e : new Error(String(e)))
                setIsLoading(false)
              }
            }, AGENT_URL_LOAD_TIMEOUT_MS)
          }
        }
      }
    }

    loadUrl()

    return () => {
      cancelled = true
      controller.abort()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [baseUrl])

  // Auto-retry with backoff to recover from startup races.
  useEffect(() => {
    if (baseUrl || !error) return
    if (attemptCount >= AGENT_URL_RETRY_ATTEMPTS) return

    const delayMs = Math.min(1200 * (attemptCount + 1), 8000)
    const retryId = setTimeout(() => {
      setAttemptCount((prev) => prev + 1)
      setIsRetrying(true)
      setReloadToken((prev) => prev + 1)
    }, delayMs)

    return () => {
      clearTimeout(retryId)
    }
  }, [baseUrl, error, attemptCount])

  // Only expose error after all retries exhausted or if truly critical.
  const shouldShowError =
    error && attemptCount >= AGENT_URL_RETRY_ATTEMPTS && !baseUrl && !isLoading

  return {
    baseUrl,
    isLoading: isLoading || isRetrying,
    error: shouldShowError ? error : null,
    isRetrying,
  }
}
