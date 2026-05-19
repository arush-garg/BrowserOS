import { env } from '@/lib/env'
import { getBrowserOSAdapter } from './adapter'
import { Capabilities, Feature } from './capabilities'
import { BROWSEROS_PREFS } from './prefs'

const PREF_READ_TIMEOUT_MS = 1500
const PREF_READ_MAX_ATTEMPTS = 5
const PREF_RETRY_BASE_DELAY_MS = 200

export class AgentPortError extends Error {
  constructor() {
    super('Agent server port not configured.')
    this.name = 'AgentPortError'
  }
}

export class McpPortError extends Error {
  constructor() {
    super('MCP server port not configured.')
    this.name = 'McpPortError'
  }
}

/**
 * @public
 */
export async function getAgentServerUrl(): Promise<string> {
  const supportsUnifiedPort = await Capabilities.supports(
    Feature.UNIFIED_PORT_SUPPORT,
  )
  if (supportsUnifiedPort) {
    const port = await getMcpPort()
    return `http://127.0.0.1:${port}`
  }
  const port = await getAgentPort()
  return `http://127.0.0.1:${port}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: Error,
): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(timeoutError), timeoutMs)
    }),
  ])
}

async function getPrefNumberWithRetry(prefKey: string): Promise<number | null> {
  const adapter = getBrowserOSAdapter()

  for (let attempt = 0; attempt < PREF_READ_MAX_ATTEMPTS; attempt++) {
    try {
      const pref = await withTimeout(
        adapter.getPref(prefKey),
        PREF_READ_TIMEOUT_MS,
        new Error(`Timed out reading BrowserOS pref: ${prefKey}`),
      )

      if (pref?.value && typeof pref.value === 'number') {
        return pref.value
      }
    } catch {
      // BrowserOS API may be temporarily unavailable during startup.
    }

    if (attempt < PREF_READ_MAX_ATTEMPTS - 1) {
      await sleep(PREF_RETRY_BASE_DELAY_MS * (attempt + 1))
    }
  }

  return null
}

async function getAgentPort(): Promise<number> {
  if (env.VITE_BROWSEROS_SERVER_PORT) {
    return env.VITE_BROWSEROS_SERVER_PORT
  }

  const prefPort = await getPrefNumberWithRetry(BROWSEROS_PREFS.AGENT_PORT)
  if (prefPort !== null) {
    return prefPort
  }

  // Final fallback for local development where prefs can lag at startup.
  if (import.meta.env.NODE_ENV === 'development') {
    return 9100
  }

  throw new AgentPortError()
}

async function getMcpPort(): Promise<number> {
  if (env.VITE_BROWSEROS_SERVER_PORT) {
    return env.VITE_BROWSEROS_SERVER_PORT
  }

  const prefPort = await getPrefNumberWithRetry(BROWSEROS_PREFS.MCP_PORT)
  if (prefPort !== null) {
    return prefPort
  }

  if (import.meta.env.NODE_ENV === 'development') {
    return 9100
  }

  throw new McpPortError()
}

/**
 * @public
 */
export async function getMcpServerUrl(): Promise<string> {
  const supportsProxy = await Capabilities.supports(Feature.PROXY_SUPPORT)
  if (supportsProxy) {
    const port = await getProxyPort()
    return `http://127.0.0.1:${port}/mcp`
  }
  const port = await getMcpPort()
  return `http://127.0.0.1:${port}/mcp`
}

export class ProxyPortError extends Error {
  constructor() {
    super('Proxy server port not configured.')
    this.name = 'ProxyPortError'
  }
}

async function getProxyPort(): Promise<number> {
  const prefPort = await getPrefNumberWithRetry(BROWSEROS_PREFS.PROXY_PORT)
  if (prefPort !== null) {
    return prefPort
  }

  throw new ProxyPortError()
}

/**
 * @public
 */
export async function getProxyServerUrl(): Promise<string> {
  const port = await getProxyPort()
  return `http://127.0.0.1:${port}`
}

/**
 * @public
 */
export async function getHealthCheckUrl(): Promise<string> {
  const supportsProxy = await Capabilities.supports(Feature.PROXY_SUPPORT)
  if (supportsProxy) {
    const port = await getProxyPort()
    return `http://127.0.0.1:${port}/health`
  }
  const port = await getMcpPort()
  return `http://127.0.0.1:${port}/health`
}
