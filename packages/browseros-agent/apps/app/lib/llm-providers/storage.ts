import { storage } from '@wxt-dev/storage'
import { sessionStorage } from '@/lib/auth/sessionStorage'
import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { BROWSEROS_PREFS } from '@/lib/browseros/prefs'
import {
  migrateLlmProvidersToV3,
  normalizeProviderNames,
} from './provider-name-normalization'
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_NAME,
} from './provider-selection'
import type { LlmProviderConfig, LlmProvidersBackup } from './types'
import { uploadLlmProvidersToGraphql } from './uploadLlmProvidersToGraphql'

export { DEFAULT_PROVIDER_ID } from './provider-selection'

function dropUnshippedProviderConfigs(
  providers: LlmProviderConfig[] | null,
): LlmProviderConfig[] | null {
  if (!providers) return providers
  // The literal catches persisted configs from the unshipped alpha provider.
  return providers.filter(
    (provider) => String(provider.type) !== 'remote-hermes',
  )
}

export const providersStorage = storage.defineItem<LlmProviderConfig[]>(
  'local:llm-providers',
  {
    version: 4,
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
      3: (
        providers: LlmProviderConfig[] | null,
      ): LlmProviderConfig[] | null => {
        return migrateLlmProvidersToV3(providers)
      },
      4: dropUnshippedProviderConfigs,
    },
  },
)

/** Mirrors provider data into BrowserOS prefs without blocking local writes. */
async function backupToBrowserOS(backup: LlmProvidersBackup): Promise<void> {
  try {
    const adapter = getBrowserOSAdapter()
    await adapter.setPref(BROWSEROS_PREFS.PROVIDERS, JSON.stringify(backup))
  } catch {
    // BrowserOS API not available - ignore
  }
}

/**
 * Merge local providers into shared BrowserOS prefs (one-time init sync).
 * Each profile pushes its locally-stored providers up so existing providers
 * from all profiles appear in the shared pref. Deduplicates by provider ID
 * — the one with the later updatedAt wins.
 * @public
 */
export async function syncLocalProvidersToBrowserOSPrefs(): Promise<void> {
  try {
    const [localProviders, localDefaultId] = await Promise.all([
      providersStorage.getValue(),
      defaultProviderIdStorage.getValue(),
    ])
    if ((!localProviders || localProviders.length === 0) && !localDefaultId) {
      return // nothing to sync
    }

    const adapter = getBrowserOSAdapter()
    const pref = await adapter.getPref(BROWSEROS_PREFS.PROVIDERS)
    const raw = pref?.value

    let mergedDefaultId = localDefaultId ?? undefined
    let mergedProviders: LlmProviderConfig[] = []

    if (typeof raw === 'string' && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw)
        const existingProviders: LlmProviderConfig[] = Array.isArray(parsed)
          ? parsed
          : (parsed?.providers ?? [])
        const existingDefaultId = !Array.isArray(parsed)
          ? parsed?.defaultProviderId
          : undefined

        // Merge: dedup by id, keep newer updatedAt
        const byId = new Map<string, LlmProviderConfig>()
        for (const p of existingProviders) {
          byId.set(p.id, p)
        }
        if (localProviders) {
          for (const p of localProviders) {
            const existing = byId.get(p.id)
            if (!existing || (p.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
              byId.set(p.id, p)
            }
          }
        }
        mergedProviders = Array.from(byId.values())

        // Prefer existing defaultProviderId unless only local has one
        if (existingDefaultId && !localDefaultId) {
          mergedDefaultId = existingDefaultId
        }
      } catch {
        // pref parse failed — fall through to use local only
        mergedProviders = localProviders ?? []
      }
    } else {
      mergedProviders = localProviders ?? []
    }

    // Normalize names before writing
    mergedProviders = normalizeProviderNames(mergedProviders)

    await backupToBrowserOS({
      defaultProviderId: mergedDefaultId ?? DEFAULT_PROVIDER_ID,
      providers: mergedProviders,
    })
  } catch {
    // BrowserOS API not available — ignore
  }
}

/**
 * Setup one-way sync of LLM providers to BrowserOS prefs
 * @public
 */
export function setupLlmProvidersBackupToBrowserOS(): () => void {
  const unsub1 = providersStorage.watch(async (providers) => {
    if (providers) {
      const defaultProviderId = await defaultProviderIdStorage.getValue()
      await backupToBrowserOS({ defaultProviderId, providers })
    }
  })
  const unsub2 = defaultProviderIdStorage.watch(async (defaultProviderId) => {
    if (defaultProviderId) {
      const providers = (await providersStorage.getValue()) ?? []
      await backupToBrowserOS({ defaultProviderId, providers })
    }
  })
  return () => {
    unsub1()
    unsub2()
  }
}

/** Uploads provider metadata for signed-in users. */
export async function syncLlmProviders(): Promise<void> {
  const providers = await providersStorage.getValue()
  if (!providers || providers.length === 0) return

  const session = await sessionStorage.getValue()
  const userId = session?.user?.id
  if (!userId) return

  await uploadLlmProvidersToGraphql(providers, userId)
}

/** Sets up one-way sync of LLM providers to the GraphQL backend. */
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

/** Returns provider configs after applying stored-config compatibility fixes. */
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
  const supportedProviders = dropUnshippedProviderConfigs(providers) ?? []
  const normalizedProviders = normalizeProviderNames(supportedProviders)

  // Persist compatibility fixes so direct storage consumers see the same list.
  if (
    supportedProviders.length !== providers.length ||
    normalizedProviders.some(
      (provider, index) => provider !== supportedProviders[index],
    )
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

/**
 * Poll BrowserOS prefs for cross-profile changes and sync both providers and
 * default provider ID into local storage. Designed for persistent background
 * usage (15s poll) — the component-level watcher (setupBrowserOSProvidersWatcher)
 * runs at 3s for immediate UI reactivity.
 * @public
 */
export function setupBackgroundCrossProfileSync(
  pollIntervalMs = 15000,
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
            const backup = Array.isArray(parsed)
              ? { providers: parsed }
              : parsed

            if (Array.isArray(backup.providers)) {
              const normalized = normalizeProviderNames(backup.providers)
              await providersStorage.setValue(normalized)
            }

            if (backup.defaultProviderId) {
              await defaultProviderIdStorage.setValue(backup.defaultProviderId)
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

export const defaultProviderIdStorage = storage.defineItem<string>(
  'local:default-provider-id',
  {
    fallback: DEFAULT_PROVIDER_ID,
  },
)
