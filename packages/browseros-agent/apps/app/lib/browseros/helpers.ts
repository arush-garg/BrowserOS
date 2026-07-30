import { getBrowserOSAdapter } from './adapter'
import { BROWSEROS_PREFS } from './prefs'

const PREF_READ_TIMEOUT_MS = 1500
const PREF_READ_MAX_ATTEMPTS = 5
const PREF_RETRY_BASE_DELAY_MS = 200

/**
 * In dev, `run.sh` launches the production BrowserOS app against the production
 * profile but starts the dev server on its own port. The profile's stored
 * `mcp_port`/`proxy_port` prefs point at the disabled built-in server, so the
 * dev server port must take precedence. The unified dev server serves /chat,
 * /mcp, and /health on this single port.
 *
 * Reads directly from `import.meta.env` rather than the cached `env` object so
 * tests that patch the env after module load are visible.
 */
function getDevServerPort(): number | null {
  if (import.meta.env.DEV && import.meta.env.VITE_BROWSEROS_SERVER_PORT) {
    return Number(import.meta.env.VITE_BROWSEROS_SERVER_PORT)
  }
  return null
}

export class McpPortError extends Error {
  constructor() {
    super('MCP server port not configured.')
    this.name = 'McpPortError'
  }
}

/**
 * Returns the local BrowserOS server base URL for chat and agent APIs.
 * BrowserOS publishes this through the unified MCP/server-port preference.
 */
export async function getAgentServerUrl(): Promise<string> {
  const port = await getMcpPort()
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

const HEALTH_CHECK_TIMEOUT_MS = 1500

/**
 * Probe the /health endpoint on a given port to verify a BrowserOS
 * server is actually listening. Returns true on 200, false otherwise.
 */
async function probeHealthCheck(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Well-known dev server ports to try when the pref port is dead.
 * Covers the default BROWSEROS_SERVER_PORT and a few nearby ports
 * that the dev tool may fall back to when the default is taken.
 */
const FALLBACK_PORTS = [9105, 9106, 9107]

/**
 * When the persisted pref port is unreachable (common in dev where
 * --browseros-mcp-port overrides the pref but the pref still holds
 * the old value), probe the well-known dev server ports.
 */
async function probeFallbackPorts(): Promise<number | null> {
  for (const port of FALLBACK_PORTS) {
    if (await probeHealthCheck(port)) return port
  }
  return null
}

async function getMcpPort(): Promise<number> {
  const devPort = getDevServerPort()
  if (devPort !== null) {
    return devPort
  }

  const prefPort = await getPrefNumberWithRetry(BROWSEROS_PREFS.MCP_PORT)
  if (prefPort !== null) {
    // Verify the port is actually listening. In dev the BrowserOS binary
    // may have been launched with --browseros-mcp-port=9105 but the
    // persisted pref still points at the production server port. A quick
    // health check avoids connecting to a stale port.
    if (await probeHealthCheck(prefPort)) {
      return prefPort
    }
    // Pref returned a port that isn't currently answering. Prefer a
    // well-known dev server port if one is live, otherwise trust the
    // configured pref value rather than failing outright — the probe is
    // an optimization for stale-port cases, not a hard requirement.
    const devFallback = await probeFallbackPorts()
    return devFallback ?? prefPort
  }

  throw new McpPortError()
}

/** Returns the MCP proxy endpoint for local server connections. */
export async function getMcpServerUrl(): Promise<string> {
  const port = await getProxyPort()
  return `http://127.0.0.1:${port}/mcp`
}

class ProxyPortError extends Error {
  constructor() {
    super('Proxy server port not configured.')
    this.name = 'ProxyPortError'
  }
}

export async function getProxyPort(): Promise<number> {
  const devPort = getDevServerPort()
  if (devPort !== null) {
    return devPort
  }

  const prefPort = await getPrefNumberWithRetry(BROWSEROS_PREFS.PROXY_PORT)
  if (prefPort !== null) {
    if (await probeHealthCheck(prefPort)) {
      return prefPort
    }
    const devFallback = await probeFallbackPorts()
    return devFallback ?? prefPort
  }

  throw new ProxyPortError()
}

/** Returns the MCP proxy health-check endpoint. */
export async function getHealthCheckUrl(): Promise<string> {
  const port = await getProxyPort()
  return `http://127.0.0.1:${port}/system/health`
}
