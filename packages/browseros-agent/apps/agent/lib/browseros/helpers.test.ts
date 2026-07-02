import { describe, expect, it } from 'bun:test'
import { BROWSEROS_PREFS } from './prefs'

describe('getAgentServerUrl', () => {
  it('uses the BrowserOS MCP port as the server URL', async () => {
    const previousChrome = globalThis.chrome
    const prefRequests: string[] = []
    try {
      globalThis.chrome = {
        runtime: {},
        browserOS: {
          getBrowserosVersionNumber(
            callback: (version: string | null) => void,
          ) {
            callback(null)
          },
          getPref(name: string, callback: (pref: { value?: unknown }) => void) {
            prefRequests.push(name)
            callback(
              name === BROWSEROS_PREFS.MCP_PORT
                ? { value: 9105 }
                : { value: null },
            )
          },
        },
      } as typeof chrome

      const { getAgentServerUrl } = await import('./helpers')

      await expect(getAgentServerUrl()).resolves.toBe('http://127.0.0.1:9105')
      expect(prefRequests).toContain(BROWSEROS_PREFS.MCP_PORT)
      expect(prefRequests).not.toContain('browseros.server.agent_port')
    } finally {
      globalThis.chrome = previousChrome
    }
  })

  it('prefers VITE_BROWSEROS_SERVER_PORT over profile prefs in dev', async () => {
    // run.sh launches the production profile (whose port prefs point at the
    // disabled built-in server) but runs the dev server on its own port, so the
    // env override must win. import.meta.env.DEV is true under the test runner.
    const previousChrome = globalThis.chrome
    const previousEnvPort = import.meta.env.VITE_BROWSEROS_SERVER_PORT
    const prefRequests: string[] = []
    try {
      import.meta.env.VITE_BROWSEROS_SERVER_PORT = '9105'
      globalThis.chrome = {
        runtime: {},
        browserOS: {
          getBrowserosVersionNumber(
            callback: (version: string | null) => void,
          ) {
            callback(null)
          },
          getPref(name: string, callback: (pref: { value?: unknown }) => void) {
            prefRequests.push(name)
            // Stale production-profile ports for the disabled built-in server.
            callback({ value: 9200 })
          },
        },
      } as typeof chrome

      const { getAgentServerUrl } = await import('./helpers')

      await expect(getAgentServerUrl()).resolves.toBe('http://127.0.0.1:9105')
      // The env override ensures the correct port regardless of pref state.
      // (Capabilities init may read prefs as a side effect during import,
      // so we only assert the resolved URL, not the absence of pref reads.)
    } finally {
      globalThis.chrome = previousChrome
      import.meta.env.VITE_BROWSEROS_SERVER_PORT = previousEnvPort
    }
  })
})
