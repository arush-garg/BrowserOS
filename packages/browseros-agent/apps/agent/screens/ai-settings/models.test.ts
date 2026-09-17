import { describe, expect, it } from 'bun:test'
import {
  getModelContextLength,
  getModelsForProvider,
  modelInfosFromChatgptPlan,
  resolveModelInfos,
} from './models'

describe('modelInfosFromChatgptPlan', () => {
  it('maps a live plan model onto the picker shape', () => {
    expect(
      modelInfosFromChatgptPlan([
        { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', contextWindow: 272000 },
      ]),
    ).toEqual([{ modelId: 'gpt-5.6-sol', contextLength: 272000 }])
  })

  it('reports an unknown context window as 0 rather than dropping the model', () => {
    expect(modelInfosFromChatgptPlan([{ id: 'gpt-6-astra' }])).toEqual([
      { modelId: 'gpt-6-astra', contextLength: 0 },
    ])
  })

  it('returns an empty list when the plan exposes nothing', () => {
    expect(modelInfosFromChatgptPlan([])).toEqual([])
  })
})

describe('resolveModelInfos', () => {
  it('prefers the live plan list for chatgpt-pro', () => {
    expect(
      resolveModelInfos('chatgpt-pro', [
        { id: 'gpt-6-astra', contextWindow: 272000 },
      ]),
    ).toEqual([{ modelId: 'gpt-6-astra', contextLength: 272000 }])
  })

  it('falls back to the built-in snapshot when the plan list is empty', () => {
    expect(resolveModelInfos('chatgpt-pro', [])).toEqual(
      getModelsForProvider('chatgpt-pro'),
    )
    expect(resolveModelInfos('chatgpt-pro', undefined)).toEqual(
      getModelsForProvider('chatgpt-pro'),
    )
  })

  it('ignores a plan list for other providers', () => {
    expect(resolveModelInfos('openai', [{ id: 'gpt-6-astra' }])).toEqual(
      getModelsForProvider('openai'),
    )
  })
})

describe('ChatGPT fallback models', () => {
  it('offers GPT-5.5 as the first choice while offline', () => {
    expect(getModelsForProvider('chatgpt-pro')[0]).toEqual({
      modelId: 'gpt-5.5',
      contextLength: 1050000,
    })
  })

  it('includes the current GPT-5.4 options', () => {
    expect(getModelContextLength('chatgpt-pro', 'gpt-5.4-mini')).toBe(400000)
    expect(getModelContextLength('chatgpt-pro', 'gpt-5.3-codex-spark')).toBe(
      128000,
    )
  })
})
