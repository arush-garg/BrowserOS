import {
  OpenJevError,
  type OpenJevPredictOptions,
  type OpenJevQuestions,
  type OpenJevResponse,
  type OpenJevState,
  validateRequest,
} from './openjev-client'

/**
 * Ollama `/v1/systemone` transport (TypeSafe Jev API, Ollama >= 0.35).
 * Same request/response shape as the Python service, so `semantic_action`
 * needs no changes. Screenshots are dropped: text-only decision models.
 */
export interface OllamaSystemOneOptions {
  baseUrl?: string
  model?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

interface SystemOneResponse {
  model?: string
  answers?: OpenJevResponse['answers']
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_MODEL = 'strands-decider'
const DEFAULT_TIMEOUT_MS = 120_000

export class OllamaSystemOneClient {
  private readonly baseUrl: string
  readonly model: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: OllamaSystemOneOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.model = options.model ?? DEFAULT_MODEL
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetch ?? fetch
  }

  async predict(
    state: OpenJevState,
    questions: OpenJevQuestions,
    { signal, image }: OpenJevPredictOptions = {},
  ): Promise<OpenJevResponse> {
    validateRequest(state, questions)
    const started = performance.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('timeout'), this.timeoutMs)
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, state, questions }),
        signal: controller.signal,
      })
      const body = (await response
        .json()
        .catch(() => ({}))) as SystemOneResponse
      if (!response.ok || body.error) {
        throw new OpenJevError(
          `Ollama systemone ${response.status}: ${body.error ?? response.statusText}`,
          response.status === 404 ? 'startup_failed' : 'service_unavailable',
          { retryable: response.status >= 500 },
        )
      }
      if (!body.answers)
        throw new OpenJevError(
          'Ollama systemone response is missing answers',
          'protocol_error',
        )
      for (const questionId of Object.keys(questions)) {
        if (!body.answers[questionId])
          throw new OpenJevError(
            `Ollama systemone response is missing ${questionId} answer`,
            'protocol_error',
          )
      }
      return {
        answers: body.answers,
        usage: {
          input_tokens: body.usage?.input_tokens ?? 0,
          output_tokens: body.usage?.output_tokens,
          total_seconds: Math.round(performance.now() - started) / 1000,
        },
        ...(image && {
          image: { used: false, reason: 'text-only decision model' },
        }),
      }
    } catch (error) {
      if (error instanceof OpenJevError) throw error
      if (controller.signal.aborted && controller.signal.reason === 'timeout')
        throw new OpenJevError(
          `Ollama systemone request timed out after ${this.timeoutMs}ms`,
          'request_timeout',
          { retryable: true },
        )
      if (controller.signal.aborted)
        throw new OpenJevError('OpenJev request aborted', 'request_aborted')
      const detail = error instanceof Error ? error.message : String(error)
      throw new OpenJevError(
        `Ollama unreachable at ${this.baseUrl}: ${detail}`,
        'service_unavailable',
        { retryable: true },
      )
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  close(): void {}
}
