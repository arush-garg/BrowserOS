import { storage } from '@wxt-dev/storage'
import { sessionStorage } from '@/lib/auth/sessionStorage'
import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { BROWSEROS_PREFS } from '@/lib/browseros/prefs'
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
} from './provider-selection'
import type { LlmProviderConfig, LlmProvidersBackup } from './types'
import { uploadLlmProvidersToGraphql } from './uploadLlmProvidersToGraphql'

export { DEFAULT_PROVIDER_ID } from './provider-selection'

/** Storage key for LLM providers array */
export const providersStorage = storage.defineItem<LlmProviderConfig[]>(
  'local:llm-providers',
  {
    version: 2,
    migrations: {
      2: (
        providers: LlmProviderConfig[] | null,
      ): LlmProviderConfig[] | null => {
        if (!providers) return providers
        return providers.map((provider) => {
          if (
            provider.id === DEFAULT_PROVIDER_ID &&
            provider.type === 'browseros'
          ) {
            return { ...provider, contextWindow: 200000 }
          }
          return provider
        })
      },
    },
  },
)

/** Backup providers to BrowserOS prefs (write-only, best-effort) */
async function backupToBrowserOS(backup: LlmProvidersBackup): Promise<void> {
  try {
    const adapter = getBrowserOSAdapter()
    await adapter.setPref(BROWSEROS_PREFS.PROVIDERS, JSON.stringify(backup))
  } catch {
    // BrowserOS API not available - ignore
  }
}

/**
 * Setup one-way sync of LLM providers to BrowserOS prefs
 * @public
 */
export function setupLlmProvidersBackupToBrowserOS(): () => void {
  const unsubscribe = providersStorage.watch(async (providers) => {
    if (providers) {
      const defaultProviderId = await defaultProviderIdStorage.getValue()
      await backupToBrowserOS({ defaultProviderId, providers })
    }
  })
  return unsubscribe
}

export async function syncLlmProviders(): Promise<void> {
  const providers = await providersStorage.getValue()
  if (!providers || providers.length === 0) return

  const session = await sessionStorage.getValue()
  const userId = session?.user?.id
  if (!userId) return

  await uploadLlmProvidersToGraphql(providers, userId)
}

/**
 * Setup one-way sync of LLM providers to GraphQL backend
 * Watches for storage changes and uploads non-sensitive provider data
 * @public
 */
export function setupLlmProvidersSyncToBackend(): () => void {
  syncLlmProviders().catch(() => {})

  const unsubscribe = providersStorage.watch(async () => {
    try {
      await syncLlmProviders()
    } catch {
      // Sync failed silently - will retry on next storage change
    }
  })
  return unsubscribe
}

/** Load providers from storage */
export async function loadProviders(): Promise<LlmProviderConfig[]> {
  // Prefer BrowserOS Local State prefs when available (cross-profile).
  try {
    const adapter = getBrowserOSAdapter()
    const pref = await adapter.getPref(BROWSEROS_PREFS.PROVIDERS)
    const raw = pref?.value
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw)
        // Support both backup shape { defaultProviderId, providers } and plain array
        const providersFromPref: LlmProviderConfig[] | undefined =
          Array.isArray(parsed) ? parsed : parsed?.providers

        if (providersFromPref && providersFromPref.length > 0) {
          const normalized = normalizeProviderNames(providersFromPref)
          // Keep local storage consistent with BrowserOS prefs
          await providersStorage.setValue(normalized)
          return normalized
        }
      } catch {
        // fall through to storage
      }
    }
  } catch {
    // BrowserOS adapter unavailable — fall back to local storage
  }

  const providers = (await providersStorage.getValue()) || []
  const normalizedProviders = normalizeProviderNames(providers)

  // Keep storage consistent so every consumer sees the same provider name.
  if (
    normalizedProviders.some((provider, index) => provider !== providers[index])
  ) {
    await providersStorage.setValue(normalizedProviders)
  }

  return normalizedProviders
}

/** Poll BrowserOS prefs for cross-profile changes and sync into local storage. */
export function setupBrowserOSProvidersWatcher(
  pollIntervalMs = 3000,
): () => void {
  let stopped = false
  let lastSeen = ''

  const poll = async () => {
    const adapter = getBrowserOSAdapter()
    while (!stopped) {
      try {
        const pref = await adapter.getPref(BROWSEROS_PREFS.PROVIDERS)
        const raw = pref?.value
        if (typeof raw === 'string' && raw !== lastSeen) {
          lastSeen = raw
          try {
            const parsed = JSON.parse(raw)
            const providersFromPref: LlmProviderConfig[] | undefined =
              Array.isArray(parsed) ? parsed : parsed?.providers
            if (providersFromPref) {
              const normalized = normalizeProviderNames(providersFromPref)
              await providersStorage.setValue(normalized)
            }
          } catch {
            // ignore parse errors
          }
        }
      } catch {
        // ignore adapter errors
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs))
    }
  }

  void poll()
  return () => {
    stopped = true
  }
}

/** Creates the default BrowserOS provider configuration */
export function createDefaultBrowserOSProvider(): LlmProviderConfig {
  const timestamp = Date.now()
  return {
    id: DEFAULT_PROVIDER_ID,
    type: 'browseros',
    name: DEFAULT_PROVIDER_NAME,
    baseUrl: 'https://api.browseros.com/v1',
    modelId: 'browseros-auto',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** Creates the default providers configuration. Only call when storage is empty. */
export function createDefaultProvidersConfig(): LlmProviderConfig[] {
  return [createDefaultBrowserOSProvider()]
}

/**
 * Normalize built-in provider names back to "BrowserOS" (e.g. from "Kimi K2.5"
 * which was set during a previous partnership launch).
 */
function normalizeProviderNames(
  providers: LlmProviderConfig[],
): LlmProviderConfig[] {
  return providers.map((provider) => {
    if (
      provider.id === DEFAULT_PROVIDER_ID &&
      provider.type === 'browseros' &&
      provider.name !== DEFAULT_PROVIDER_NAME
    ) {
      return {
        ...provider,
        name: DEFAULT_PROVIDER_NAME,
      }
    }
    return provider
  })
}

/** Storage key for the default provider ID */
export const defaultProviderIdStorage = storage.defineItem<string>(
  'local:default-provider-id',
  {
    fallback: DEFAULT_PROVIDER_ID,
  },
)
