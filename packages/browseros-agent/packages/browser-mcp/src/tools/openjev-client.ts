import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import openjevServiceSource from '../../python/openjev_service.py' with {
  type: 'text',
}

export interface OpenJevState {
  page: {
    url?: string
    text: string
  }
  recent_actions?: unknown[]
  [key: string]: unknown
}

export interface OpenJevQuestion {
  type: 'choice'
  instructions: string | Record<string, unknown> | unknown[]
  criteria: Record<string, string>
}

export type OpenJevQuestions = Record<string, OpenJevQuestion>

export interface OpenJevAnswer {
  type?: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence?: number
}

export type OpenJevChoiceAnswer = OpenJevAnswer

export interface OpenJevUsage {
  input_tokens: number
  output_tokens?: number
  total_seconds?: number
}

export interface OpenJevResponse {
  answers: Record<string, OpenJevAnswer>
  usage?: OpenJevUsage
}

interface PendingRequest {
  resolve: (response: ServiceResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  cleanupAbort: () => void
}

interface ServiceResponse {
  request_id: string
  answers?: Record<string, OpenJevChoiceAnswer>
  usage?: OpenJevUsage
  error?: string
  error_kind?: string
}

interface PythonResolutionOptions {
  explicitPython?: string
  startDirectory?: string
  homeDirectory?: string
  isFile?: (path: string) => boolean
}

interface OpenJevClientOptions {
  command?: string[]
  timeoutMs?: number
  env?: Record<string, string | undefined>
}

const DEFAULT_TIMEOUT_MS = 120_000
const MIN_CHOICE_CRITERIA = 1
const MAX_CHOICE_CRITERIA = 64

export class OpenJevClient {
  private process?: ReturnType<typeof Bun.spawn>
  private nextRequestId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private stderrTask?: Promise<string>

  constructor(private readonly options: OpenJevClientOptions = {}) {}

  async predict(
    state: OpenJevState,
    questions: OpenJevQuestions,
    signal?: AbortSignal,
  ): Promise<OpenJevResponse> {
    validateRequest(state, questions)
    return this.request(
      (requestId) => ({ request_id: requestId, state, questions }),
      (response) => {
        if (!response.answers)
          return new Error('OpenJev response is missing answers')
        for (const questionId of Object.keys(questions)) {
          if (!response.answers[questionId])
            return new Error(`OpenJev response is missing ${questionId} answer`)
        }
        return {
          answers: response.answers,
          ...(response.usage && { usage: response.usage }),
        }
      },
      signal,
    )
  }

  close(): void {
    this.resetProcess(new Error('OpenJev service closed'))
  }

  private request<T>(
    makePayload: (requestId: string) => Record<string, unknown>,
    extract: (response: ServiceResponse) => T | Error,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason))
    const child = this.ensureProcess()
    const requestId = `request-${this.nextRequestId++}`
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        const error = abortError(signal?.reason)
        this.rejectRequest(requestId, error)
        this.resetProcess(error)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => {
        const error = new Error(
          `OpenJev request timed out after ${timeoutMs}ms`,
        )
        this.rejectRequest(requestId, error)
        this.resetProcess(error)
      }, timeoutMs)
      this.pending.set(requestId, {
        resolve: (response) => {
          const value = extract(response)
          if (value instanceof Error) reject(value)
          else resolve(value)
        },
        reject,
        timer,
        cleanupAbort: () => signal?.removeEventListener('abort', onAbort),
      })

      const stdin = child.stdin
      if (!stdin || typeof stdin === 'number') {
        this.rejectRequest(
          requestId,
          new Error('OpenJev service stdin is unavailable'),
        )
        return
      }
      const payload = `${JSON.stringify(makePayload(requestId))}\n`
      void Promise.resolve(stdin.write(payload)).catch((error: unknown) => {
        const requestError = asError(error)
        this.rejectRequest(requestId, requestError)
        this.resetProcess(requestError)
      })
    })
  }

  private ensureProcess(): ReturnType<typeof Bun.spawn> {
    if (this.process && this.process.exitCode === null) return this.process
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...this.options.env }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    )
    const command = this.options.command ?? defaultCommand(env)
    const child = Bun.spawn(command, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    })
    this.process = child
    void this.consumeStdout(child.stdout)
    this.stderrTask = consumeStderr(child.stderr)
    void child.exited.then(async (code) => {
      if (this.process !== child) return
      const stderr = (await this.stderrTask?.catch(() => ''))?.trim()
      this.resetProcess(
        new Error(
          `OpenJev service exited with code ${code}${stderr ? `: ${stderr.slice(-1_000)}` : ''}`,
        ),
      )
    })
    return child
  }

  private async consumeStdout(
    stream: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line) this.handleLine(line)
          newline = buffer.indexOf('\n')
        }
      }
      if (buffer.trim()) this.handleLine(buffer.trim())
    } catch (error) {
      this.resetProcess(asError(error))
    }
  }

  private handleLine(line: string): void {
    let response: ServiceResponse
    try {
      response = JSON.parse(line) as ServiceResponse
    } catch {
      this.resetProcess(
        new Error('OpenJev service emitted invalid JSON on stdout'),
      )
      return
    }
    if (!response.request_id) {
      this.resetProcess(new Error('OpenJev response is missing request_id'))
      return
    }
    const pending = this.pending.get(response.request_id)
    if (!pending) return
    this.pending.delete(response.request_id)
    clearTimeout(pending.timer)
    pending.cleanupAbort()
    if (response.error) {
      pending.reject(
        new Error(
          `${response.error_kind ? `${response.error_kind}: ` : ''}${response.error}`,
        ),
      )
      return
    }
    pending.resolve(response)
  }

  private rejectRequest(requestId: string, error: Error): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.cleanupAbort()
    pending.reject(error)
  }

  private resetProcess(error: Error): void {
    const child = this.process
    this.process = undefined
    if (child && child.exitCode === null) child.kill()
    for (const requestId of [...this.pending.keys()])
      this.rejectRequest(requestId, error)
  }
}

let defaultClient: OpenJevClient | undefined

export function getOpenJevClient(): OpenJevClient {
  defaultClient ??= new OpenJevClient()
  return defaultClient
}

export function setOpenJevClientForTests(client?: OpenJevClient): void {
  defaultClient?.close()
  defaultClient = client
}

export function validateRequest(
  state: OpenJevState,
  questions: OpenJevQuestions,
): void {
  if (state === null || state === undefined)
    throw new Error('OpenJev state is required')
  const entries = Object.entries(questions)
  if (entries.length === 0)
    throw new Error('OpenJev requires at least one question')

  for (const [name, question] of entries) {
    if (!name.trim() || !hasInstructions(question.instructions))
      throw new Error('OpenJev question name and instructions must be nonempty')
    const criteria = Object.entries(question.criteria)
    if (
      criteria.length < MIN_CHOICE_CRITERIA ||
      criteria.length > MAX_CHOICE_CRITERIA
    ) {
      throw new Error(`OpenJev question ${name} must contain 1-64 criteria`)
    }
    const normalizedNames = new Set<string>()
    for (const [criterion, description] of criteria) {
      const normalizedName = criterion.trim()
      if (!normalizedName || !description.trim())
        throw new Error(`OpenJev question ${name} has an invalid criterion`)
      if (normalizedNames.has(normalizedName))
        throw new Error(
          `OpenJev question ${name} has duplicate criterion ${normalizedName}`,
        )
      normalizedNames.add(normalizedName)
    }
  }
}

function hasInstructions(
  instructions: string | Record<string, unknown> | unknown[],
): boolean {
  if (typeof instructions === 'string') return instructions.trim().length > 0
  if (Array.isArray(instructions)) return instructions.length > 0
  return Object.keys(instructions).length > 0
}

export function resolveOpenJevPython(
  options: PythonResolutionOptions = {},
): string {
  const explicitPython = options.explicitPython?.trim()
  if (explicitPython) return explicitPython

  const isFile = options.isFile ?? existsSync
  let directory = options.startDirectory ?? process.cwd()
  const root = parse(directory).root
  for (;;) {
    for (const environment of ['.venv', 'venv']) {
      const candidate = join(directory, environment, 'bin', 'python')
      if (isFile(candidate)) return candidate
    }
    if (directory === root) break
    directory = dirname(directory)
  }

  const developmentPython = join(
    options.homeDirectory ?? homedir(),
    'Development',
    'v_env',
    'bin',
    'python',
  )
  return isFile(developmentPython) ? developmentPython : 'python3'
}

function defaultCommand(env: Record<string, string>): string[] {
  const python = resolveOpenJevPython({
    explicitPython: env.BROWSEROS_OPENJEV_PYTHON,
  })
  return [python, '-u', '-c', openjevServiceSource]
}

async function consumeStderr(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let recent = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    recent = `${recent}${decoder.decode(value, { stream: true })}`.slice(-1_000)
  }
  return `${recent}${decoder.decode()}`.slice(-1_000)
}

function abortError(reason?: unknown): Error {
  const error = new Error(
    typeof reason === 'string' ? reason : 'Operation aborted',
  )
  error.name = 'AbortError'
  return error
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
