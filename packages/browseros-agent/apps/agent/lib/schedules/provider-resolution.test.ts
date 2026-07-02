import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import { getAgentServerUrl } from '../browseros/helpers'
import { buildChatRequestBody } from '../messaging/server/buildChatRequestBody'

const storageValues = new Map<string, unknown>()
const fetchBodies: Array<Record<string, unknown>> = []
const originalFetch = globalThis.fetch
const originalChrome = globalThis.chrome

// getAgentServerUrl probes /health to validate the pref port; that request
// carries no body and must not be recorded as a chat/refine request.
const recordRequestBody = (
  url: RequestInfo | URL,
  init?: RequestInit,
): void => {
  if (String(url).endsWith('/health')) return
  fetchBodies.push(JSON.parse(String(init?.body ?? '{}')))
}

const createBrowserOSProvider = () => ({
  id: 'browseros',
  type: 'browseros',
  name: 'BrowserOS',
  modelId: 'browseros-auto',
  supportsImages: true,
  contextWindow: 200000,
  temperature: 0.2,
  createdAt: 0,
  updatedAt: 0,
})

mock.module('@/lib/llm-providers/storage', () => ({
  DEFAULT_PROVIDER_ID: 'browseros',
  createDefaultBrowserOSProvider: createBrowserOSProvider,
  createDefaultProvidersConfig: () => [createBrowserOSProvider()],
  loadProviders: async () =>
    (storageValues.get('providers') as LlmProviderConfig[]) ?? [],
  providersStorage: {
    getValue: async () => storageValues.get('providers'),
    setValue: async (value: LlmProviderConfig[]) => {
      storageValues.set('providers', value)
    },
    watch: () => () => {},
  },
  defaultProviderIdStorage: {
    getValue: async () => storageValues.get('defaultProviderId'),
    setValue: async (value: string) => {
      storageValues.set('defaultProviderId', value)
    },
    watch: () => () => {},
  },
}))

mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl,
}))

mock.module('@/lib/mcp/mcpServerStorage', () => ({
  mcpServerStorage: {
    getValue: async () => [],
  },
}))

mock.module('@/lib/messaging/server/buildChatRequestBody', () => ({
  buildChatRequestBody,
}))

mock.module('../personalization/personalizationStorage', () => ({
  personalizationStorage: {
    getValue: async () => 'Use concise output.',
  },
}))

beforeEach(() => {
  storageValues.clear()
  fetchBodies.length = 0
  storageValues.set('providers', providers)
  storageValues.set('defaultProviderId', 'anthropic-sonnet')
  globalThis.chrome = {
    runtime: {},
    browserOS: {
      getPref(_name: string, callback: (pref: { value?: unknown }) => void) {
        callback({ value: 9105 })
      },
    },
  } as typeof chrome
  globalThis.fetch = mock(async (url, init) => {
    recordRequestBody(url, init)
    return new Response(
      [
        'data: {"type":"text-delta","id":"message","delta":"done"}',
        '',
        'data: {"type":"finish","finishReason":"stop"}',
        '',
        '',
      ].join('\n'),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      },
    )
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.chrome = originalChrome
})

describe('scheduled provider resolution', () => {
  it('falls back through the configured default when an explicit scheduled provider is local runtime only', async () => {
    const { getChatServerResponse } = await import('./getChatServerResponse')

    await getChatServerResponse({
      message: 'Run my schedule',
      providerId: 'codex-provider',
    })

    expect(fetchBodies[0]).toMatchObject({
      provider: 'anthropic',
      providerName: 'Anthropic Sonnet',
      model: 'claude-sonnet-4-6',
    })
  })

  it('falls back through the configured default when an explicit refine provider is local runtime only', async () => {
    globalThis.fetch = mock(async (url, init) => {
      recordRequestBody(url, init)
      return Response.json({ success: true, refined: 'Refined prompt' })
    }) as unknown as typeof fetch

    const { refinePrompt } = await import('./refine-prompt')

    await refinePrompt({
      prompt: 'Check mail',
      name: 'Morning brief',
      providerId: 'codex-provider',
    })

    expect(fetchBodies[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
  })
})

const timestamp = 1000

const providers: LlmProviderConfig[] = [
  {
    id: 'browseros',
    type: 'browseros',
    name: 'BrowserOS',
    modelId: 'browseros-auto',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'anthropic-sonnet',
    type: 'anthropic',
    name: 'Anthropic Sonnet',
    modelId: 'claude-sonnet-4-6',
    apiKey: 'sk-ant',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'codex-provider',
    type: 'codex',
    name: 'Codex',
    modelId: 'gpt-5.3-codex',
    supportsImages: false,
    contextWindow: 400000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]
