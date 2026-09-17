/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Lists the models a ChatGPT plan exposes, read from the Codex backend that
 * serves subscription accounts. The model set is account- and plan-dependent
 * and changes without a client release, so the settings UI reads it live
 * rather than shipping a snapshot.
 */

import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import { EXTERNAL_URLS } from '@browseros/shared/constants/urls'

export interface ChatgptModel {
  id: string
  name?: string
  description?: string
  contextWindow?: number
  reasoningEfforts?: string[]
  defaultEffort?: string
}

export interface ChatgptModelCredentials {
  accessToken: string
  accountId?: string
}

/** One entry of `GET {codex}/models`. Unknown on purpose: the payload is not ours. */
interface CodexModelEntry {
  slug?: unknown
  display_name?: unknown
  description?: unknown
  context_window?: unknown
  supported_reasoning_levels?: unknown
  default_reasoning_level?: unknown
  visibility?: unknown
  priority?: unknown
}

export async function fetchChatgptModels(
  credentials: ChatgptModelCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatgptModel[]> {
  const response = await fetchImpl(
    `${EXTERNAL_URLS.CHATGPT_CODEX_API}/models`,
    {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        originator: 'browseros',
        ...(credentials.accountId
          ? { 'ChatGPT-Account-Id': credentials.accountId }
          : {}),
      },
      signal: AbortSignal.timeout(TIMEOUTS.OAUTH_MODELS_FETCH),
    },
  )

  if (!response.ok) {
    throw new Error(`ChatGPT model list failed: ${response.status}`)
  }

  const payload = (await response.json()) as { models?: unknown }
  return normalizeChatgptModels(payload.models)
}

/**
 * The backend ranks models by `priority` (lowest first) and marks internal
 * ones — auto-review, reserve — as `visibility: 'hide'`. Hidden entries are
 * never selectable, so they are dropped rather than shipped to the UI.
 */
export function normalizeChatgptModels(entries: unknown): ChatgptModel[] {
  if (!Array.isArray(entries)) return []

  const ranked: { priority: number; model: ChatgptModel }[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as CodexModelEntry
    if (typeof candidate.slug !== 'string' || candidate.slug.length === 0) {
      continue
    }
    if (candidate.visibility === 'hide') continue

    ranked.push({
      priority:
        typeof candidate.priority === 'number'
          ? candidate.priority
          : Number.MAX_SAFE_INTEGER,
      model: {
        id: candidate.slug,
        name: asString(candidate.display_name),
        description: asString(candidate.description),
        contextWindow:
          typeof candidate.context_window === 'number'
            ? candidate.context_window
            : undefined,
        reasoningEfforts: effortLevels(candidate.supported_reasoning_levels),
        defaultEffort: asString(candidate.default_reasoning_level),
      },
    })
  }

  ranked.sort((a, b) => a.priority - b.priority)
  return ranked.map(({ model }) => model)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function effortLevels(levels: unknown): string[] | undefined {
  if (!Array.isArray(levels)) return undefined
  const efforts: string[] = []
  for (const level of levels) {
    if (!level || typeof level !== 'object') continue
    const effort = asString((level as { effort?: unknown }).effort)
    if (effort) efforts.push(effort)
  }
  return efforts.length > 0 ? efforts : undefined
}
