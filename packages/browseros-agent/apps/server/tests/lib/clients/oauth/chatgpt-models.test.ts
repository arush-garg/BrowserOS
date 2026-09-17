/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import {
  fetchChatgptModels,
  normalizeChatgptModels,
} from '../../../../src/lib/clients/oauth/chatgpt-models'

const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'

interface SeenRequest {
  url: string
  headers: Headers
}

function fetchStub(seen: SeenRequest[], respond: () => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) })
    return respond()
  }) as typeof fetch
}

describe('fetchChatgptModels', () => {
  it('reads the plan model list from the Codex backend with a bearer token', async () => {
    const seen: SeenRequest[] = []
    const models = await fetchChatgptModels(
      { accessToken: 'access-token', accountId: 'account-1' },
      fetchStub(
        seen,
        () =>
          new Response(
            JSON.stringify({
              models: [
                {
                  slug: 'gpt-5.6-sol',
                  display_name: 'GPT-5.6-Sol',
                  context_window: 272000,
                  visibility: 'list',
                  priority: 6,
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    )

    expect(seen[0]?.url).toBe(CODEX_MODELS_URL)
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer access-token')
    expect(seen[0]?.headers.get('chatgpt-account-id')).toBe('account-1')
    expect(models).toEqual([
      { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', contextWindow: 272000 },
    ])
  })

  it('omits the account header when the token carries no account id', async () => {
    const seen: SeenRequest[] = []
    await fetchChatgptModels(
      { accessToken: 'access-token' },
      fetchStub(seen, () => new Response('{"models":[]}', { status: 200 })),
    )

    expect(seen[0]?.headers.get('chatgpt-account-id')).toBeNull()
  })

  it('throws when the backend rejects the request', async () => {
    expect(
      fetchChatgptModels(
        { accessToken: 'access-token' },
        fetchStub([], () => new Response('nope', { status: 401 })),
      ),
    ).rejects.toThrow('ChatGPT model list failed: 401')
  })
})

describe('normalizeChatgptModels', () => {
  it('drops hidden models and orders the rest by backend priority', () => {
    const models = normalizeChatgptModels([
      { slug: 'gpt-5.4-mini', priority: 23, visibility: 'list' },
      { slug: 'gpt-reserve', priority: 3, visibility: 'hide' },
      { slug: 'gpt-5.6-sol', priority: 6, visibility: 'list' },
      { slug: 'gpt-6-astra', priority: 1, visibility: 'list' },
    ])

    expect(models.map((m) => m.id)).toEqual([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.4-mini',
    ])
  })

  it('carries the reasoning levels and default effort through', () => {
    const [model] = normalizeChatgptModels([
      {
        slug: 'gpt-6-astra',
        supported_reasoning_levels: [
          { effort: 'low', description: 'Fast' },
          { effort: 'ultra', description: 'Maximum' },
        ],
        default_reasoning_level: 'low',
      },
    ])

    expect(model?.reasoningEfforts).toEqual(['low', 'ultra'])
    expect(model?.defaultEffort).toBe('low')
  })

  it('ignores entries without a usable slug', () => {
    expect(
      normalizeChatgptModels([
        null,
        'gpt-5.5',
        { display_name: 'no slug' },
        { slug: '' },
        { slug: 'gpt-5.5' },
      ]),
    ).toEqual([{ id: 'gpt-5.5' }])
  })

  it('treats a non-array payload as no models', () => {
    expect(normalizeChatgptModels(undefined)).toEqual([])
    expect(normalizeChatgptModels({ slug: 'gpt-5.5' })).toEqual([])
  })
})
