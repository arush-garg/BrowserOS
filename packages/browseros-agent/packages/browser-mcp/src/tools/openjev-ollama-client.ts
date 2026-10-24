import {
  OpenJevError,
  type OpenJevPredictOptions,
  type OpenJevQuestions,
  type OpenJevResponse,
  type OpenJevState,
  validateRequest,
} from './openjev-client'

/**
 * HTTP `/v1/systemone` transport (TypeSafe Jev wire format).
 *
 * Default target is the local OpenJev router (launchd `com.browseros.openjev`,
 * 127.0.0.1:11435, ~/Development/openjev-client): text goes to the resident
 * MLX model with Cloudflare / OpenRouter fallback, screenshots go to a vision
 * decision model. Also works against Ollama >= 0.35 (`model` is sent when set).
 * The image is forwarded as `image: {data, mime_type}`; the server's
 * `image.used` report is passed through so callers know whether it was seen.
 */
export interface OllamaSystemOneOptions {
  baseUrl?: string
  model?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

interface SystemOneResponse {
  model?: string
  backend?: string
  answers?: OpenJevResponse['answers']
  usage?: { input_tokens?: number; output_tokens?: number }
  image?: OpenJevResponse['image']
  error?: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11435'
const DEFAULT_TIMEOUT_MS = 120_000

export class OllamaSystemOneClient {
  private readonly baseUrl: string
  readonly model?: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: OllamaSystemOneOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.model = options.model
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
        body: JSON.stringify({
          ...(this.model && { model: this.model }),
          state,
          questions,
          ...(image && {
            image: { data: image.data, mime_type: image.mimeType },
          }),
        }),
        signal: controller.signal,
      })
      const body = (await response
        .json()
        .catch(() => ({}))) as SystemOneResponse
      if (!response.ok || body.error) {
        throw new OpenJevError(
          `systemone ${response.status}: ${body.error ?? response.statusText}`,
          response.status === 404 ? 'startup_failed' : 'service_unavailable',
          { retryable: response.status >= 500 },
        )
      }
      if (!body.answers)
        throw new OpenJevError(
          'systemone response is missing answers',
          'protocol_error',
        )
      for (const questionId of Object.keys(questions)) {
        if (!body.answers[questionId])
          throw new OpenJevError(
            `systemone response is missing ${questionId} answer`,
            'protocol_error',
          )
      }
      return {
        answers: body.answers,
        backend:
          body.backend ??
          (this.model ? `systemone/${this.model}` : 'systemone/unreported'),
        ...(body.model && { model: body.model }),
        usage: {
          input_tokens: body.usage?.input_tokens ?? 0,
          output_tokens: body.usage?.output_tokens,
          total_seconds: Math.round(performance.now() - started) / 1000,
        },
        ...(image && {
          image: body.image ?? {
            used: false,
            reason: 'server did not report image use',
          },
        }),
      }
    } catch (error) {
      if (error instanceof OpenJevError) throw error
      if (controller.signal.aborted && controller.signal.reason === 'timeout')
        throw new OpenJevError(
          `systemone request timed out after ${this.timeoutMs}ms`,
          'request_timeout',
          { retryable: true },
        )
      if (controller.signal.aborted)
        throw new OpenJevError('OpenJev request aborted', 'request_aborted')
      const detail = error instanceof Error ? error.message : String(error)
      throw new OpenJevError(
        `OpenJev endpoint unreachable at ${this.baseUrl}: ${detail}`,
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
