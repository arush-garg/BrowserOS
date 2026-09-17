/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { createOAuthRoutes } from '../../../src/api/routes/oauth'
import type { ChatgptModelCredentials } from '../../../src/lib/clients/oauth/chatgpt-models'
import type { OAuthTokenManager } from '../../../src/lib/clients/oauth/token-manager'

let refreshed: ChatgptModelCredentials | null = null
let refreshError: Error | null = null
let seenCredentials: ChatgptModelCredentials | null = null
let listedModels: unknown[] = []
let listError: Error | null = null

beforeEach(() => {
  refreshed = { accessToken: 'access-token', accountId: 'account-1' }
  refreshError = null
  seenCredentials = null
  listedModels = [{ id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' }]
  listError = null
})

function buildApp() {
  const tokenManager = {
    refreshIfExpired: async () => {
      if (refreshError) throw refreshError
      return refreshed
    },
  } as unknown as OAuthTokenManager

  return createOAuthRoutes({
    tokenManager,
    listChatgptModels: async (credentials) => {
      seenCredentials = credentials
      if (listError) throw listError
      return listedModels
    },
  })
}

describe('GET /oauth/:provider/models', () => {
  it('returns the models for a signed-in ChatGPT plan', async () => {
    const response = await buildApp().request('/chatgpt-pro/models')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' }],
    })
    expect(seenCredentials).toEqual({
      accessToken: 'access-token',
      accountId: 'account-1',
    })
  })

  it('returns 401 when the plan is not signed in', async () => {
    refreshed = null
    const response = await buildApp().request('/chatgpt-pro/models')

    expect(response.status).toBe(401)
    expect(seenCredentials).toBeNull()
  })

  it('returns 401 when the stored token cannot be refreshed', async () => {
    refreshError = new Error('ChatGPT session expired. Please re-login.')
    const response = await buildApp().request('/chatgpt-pro/models')

    expect(response.status).toBe(401)
  })

  it('returns 502 when the backend model list fails', async () => {
    listError = new Error('ChatGPT model list failed: 500')
    const response = await buildApp().request('/chatgpt-pro/models')

    expect(response.status).toBe(502)
  })

  it('returns 404 for a provider with no model listing', async () => {
    const response = await buildApp().request('/qwen-code/models')

    expect(response.status).toBe(404)
    expect(seenCredentials).toBeNull()
  })
})
