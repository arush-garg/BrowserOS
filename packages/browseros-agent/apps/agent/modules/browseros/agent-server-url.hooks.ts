import { useEffect, useRef, useState } from 'react'
// Relative value import: `bun test` resolves tsconfig `@/` paths only for
// erased `import type`; a `@/` value import fails to load under bun test.
import { getAgentServerUrl } from '../../lib/browseros/helpers'

const MAX_AGENT_SERVER_URL_ATTEMPTS = 10
const AGENT_SERVER_URL_RETRY_DELAY_MS = 1000

export type UseAgentServerUrlResult =
  | { baseUrl: string; isLoading: false; error: null }
  | { baseUrl?: never; isLoading: true; error: null }
  | { baseUrl?: never; isLoading: false; error: Error }

/**
 * Resolves the local BrowserOS server URL used by React surfaces.
 * The host is always loopback; retries cover startup races while BrowserOS
 * publishes the port preference.
 *
 * Retries are staggered with longer backoff to cover slow BrowserOS startup
 * (the pref API may be unavailable for seconds after process launch).
 * A stale-resolution guard prevents resolved values from clobbering state
 * after the effect unmounts (e.g. React 18 StrictMode double-mount).
 */
export function useAgentServerUrl(): UseAgentServerUrlResult {
  const [state, setState] = useState<UseAgentServerUrlResult>({
    isLoading: true,
    error: null,
  })

  // Guard against stale resolution after unmount (React 18 StrictMode)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    async function loadUrl(attempt: number) {
      if (cancelledRef.current) return

      try {
        const url = await getAgentServerUrl()
        if (!cancelledRef.current) {
          setState({ baseUrl: url, isLoading: false, error: null })
        }
      } catch (e) {
        if (cancelledRef.current) return

        if (attempt < MAX_AGENT_SERVER_URL_ATTEMPTS) {
          retryTimer = setTimeout(() => {
            void loadUrl(attempt + 1)
          }, AGENT_SERVER_URL_RETRY_DELAY_MS)
          // Stay in loading state while retrying — the previous
          // behaviour jumped to error after just 3 attempts (1.5 s),
          // which is too short for the BrowserOS pref API to
          // become available during cold startup.  Keep spinning
          // until we either succeed or exhaust the full budget.
          return
        }
        setState({
          isLoading: false,
          error: e instanceof Error ? e : new Error(String(e)),
        })
      }
    }

    void loadUrl(1)

    return () => {
      cancelledRef.current = true
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
    }
  }, [])

  return state
}
