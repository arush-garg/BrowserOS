// Relative value import: `bun test` resolves tsconfig `@/` paths only for
// erased `import type`; a `@/` value import fails to load under bun test.
import {
  getModelsDevModels,
  type ModelsDevModel,
} from '../../lib/llm-providers/models-dev'
import type { ProviderType } from '../../lib/llm-providers/types'
import type { ChatgptPlanModel } from '../../modules/llm-providers/chatgpt-models.hooks'

export interface ModelInfo {
  modelId: string
  contextLength: number
  supportsImages?: boolean
  supportsReasoning?: boolean
  supportsToolCall?: boolean
}

const CUSTOM_PROVIDER_MODELS: Partial<Record<ProviderType, ModelInfo[]>> = {
  browseros: [{ modelId: 'browseros-auto', contextLength: 200000 }],
  'openai-compatible': [],
  ollama: [],
  // Signed-in plans read their models live (useChatgptPlanModels); this is the
  // offline fallback and is expected to lag behind OpenAI's latest releases.
  'chatgpt-pro': [
    { modelId: 'gpt-5.5', contextLength: 1050000 },
    { modelId: 'gpt-5.4', contextLength: 1050000 },
    { modelId: 'gpt-5.4-mini', contextLength: 400000 },
    { modelId: 'gpt-5.4-nano', contextLength: 400000 },
    { modelId: 'gpt-5.3-codex', contextLength: 400000 },
    { modelId: 'gpt-5.3-codex-spark', contextLength: 128000 },
    { modelId: 'gpt-5.2-codex', contextLength: 400000 },
    { modelId: 'gpt-5.2', contextLength: 400000 },
    { modelId: 'gpt-5.1-codex', contextLength: 400000 },
    { modelId: 'gpt-5.1-codex-max', contextLength: 400000 },
    { modelId: 'gpt-5.1-codex-mini', contextLength: 400000 },
    { modelId: 'gpt-5.1', contextLength: 400000 },
  ],
  'qwen-code': [
    { modelId: 'coder-model', contextLength: 1000000 },
    { modelId: 'qwen3-coder-plus', contextLength: 1000000 },
    { modelId: 'qwen3-coder-flash', contextLength: 1000000 },
    { modelId: 'qwen3.5-plus', contextLength: 1000000 },
  ],
}

function fromModelsDevModel(m: ModelsDevModel): ModelInfo {
  return {
    modelId: m.id,
    contextLength: m.contextWindow,
    supportsImages: m.supportsImages,
    supportsReasoning: m.supportsReasoning,
    supportsToolCall: m.supportsToolCall,
  }
}

export function getModelsForProvider(providerType: ProviderType): ModelInfo[] {
  const custom = CUSTOM_PROVIDER_MODELS[providerType]
  if (custom !== undefined) return custom

  return getModelsDevModels(providerType).map(fromModelsDevModel)
}

/**
 * Maps a plan's live model list onto the picker's model shape. Models the
 * backend reports without a context window keep 0, which the picker reads as
 * "unknown" rather than as a real window size.
 */
export function modelInfosFromChatgptPlan(
  models: ChatgptPlanModel[],
): ModelInfo[] {
  return models.map((model) => ({
    modelId: model.id,
    contextLength: model.contextWindow ?? 0,
  }))
}

/**
 * The models the picker offers: a signed-in ChatGPT plan's live list when it
 * resolved, the built-in snapshot otherwise.
 */
export function resolveModelInfos(
  providerType: ProviderType,
  planModels: ChatgptPlanModel[] | undefined,
): ModelInfo[] {
  if (providerType === 'chatgpt-pro' && planModels && planModels.length > 0) {
    return modelInfosFromChatgptPlan(planModels)
  }
  return getModelsForProvider(providerType)
}

export function getModelContextLength(
  providerType: ProviderType,
  modelId: string,
): number | undefined {
  return contextLengthFor(getModelsForProvider(providerType), modelId)
}

/** Context window `modelId` has in `models`, when that list knows it. */
export function contextLengthFor(
  models: ModelInfo[],
  modelId: string,
): number | undefined {
  const model = models.find((m) => m.modelId === modelId)
  return model?.contextLength
}
