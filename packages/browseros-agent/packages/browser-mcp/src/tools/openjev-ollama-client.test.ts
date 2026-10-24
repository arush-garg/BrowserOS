import { describe, expect, test } from 'bun:test'
import { OpenJevError } from './openjev-client'
import { OllamaSystemOneClient } from './openjev-ollama-client'

const state = { page: { url: 'https://example.com', text: 'Example Domain' } }
const questions = {
  action: {
    type: 'choice' as const,
    instructions: 'Pick one',
    criteria: { CLICK_e1: 'click link "More information"', DONE: 'done' },
  },
}

function fakeFetch(
  handler: (body: Record<string, unknown>) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = []
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push(body)
    return handler(body)
  }) as unknown as typeof fetch
  return { fetch: impl, calls }
}

describe('OllamaSystemOneClient', () => {
  test('posts the Jev-shaped request and maps the answer', async () => {
    const { fetch, calls } = fakeFetch(() =>
      Response.json({
        model: 'tev1',
        answers: {
          action: {
            type: 'choice',
            choice: 'CLICK_e1',
            probabilities: { CLICK_e1: 0.9, DONE: 0.1 },
            confidence: 0.8,
          },
        },
        usage: { input_tokens: 42, output_tokens: 1 },
      }),
    )
    const client = new OllamaSystemOneClient({ model: 'tev1', fetch })
    const response = await client.predict(state, questions)
    expect(calls[0]).toEqual({ model: 'tev1', state, questions })
    expect(response.answers.action?.choice).toBe('CLICK_e1')
    expect(response.usage?.input_tokens).toBe(42)
    expect(response.image).toBeUndefined()
  })

  test('defaults to the local router without a model field', async () => {
    let url = ''
    const impl = (async (
      target: string | URL | Request,
      init?: RequestInit,
    ) => {
      url = String(target)
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('model')
      return Response.json({
        answers: { action: { choice: 'DONE', probabilities: { DONE: 1 } } },
      })
    }) as unknown as typeof fetch
    await new OllamaSystemOneClient({ fetch: impl }).predict(state, questions)
    expect(url).toBe('http://127.0.0.1:11435/v1/systemone')
  })

  test('forwards the screenshot and passes through the image report', async () => {
    const { fetch, calls } = fakeFetch(() =>
      Response.json({
        backend: 'cloudflare',
        answers: { action: { choice: 'DONE', probabilities: { DONE: 1 } } },
        image: { used: true, count: 1 },
      }),
    )
    const response = await new OllamaSystemOneClient({ fetch }).predict(
      state,
      questions,
      { image: { data: 'abc', mimeType: 'image/jpeg' } },
    )
    expect(calls[0]?.image).toEqual({ data: 'abc', mime_type: 'image/jpeg' })
    expect(response.image?.used).toBe(true)
  })

  test('reports image unused when the server is silent about it', async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({
        answers: { action: { choice: 'DONE', probabilities: { DONE: 1 } } },
      }),
    )
    const response = await new OllamaSystemOneClient({ fetch }).predict(
      state,
      questions,
      { image: { data: 'abc', mimeType: 'image/png' } },
    )
    expect(response.image?.used).toBe(false)
  })

  test('surfaces HTTP errors as OpenJevError', async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({ error: 'model "nope" not found' }, { status: 404 }),
    )
    const client = new OllamaSystemOneClient({ model: 'nope', fetch })
    const error = await client.predict(state, questions).catch((e) => e)
    expect(error).toBeInstanceOf(OpenJevError)
    expect(error.code).toBe('startup_failed')
    expect(error.message).toContain('not found')
  })

  test('rejects a response missing the question answer', async () => {
    const { fetch } = fakeFetch(() => Response.json({ answers: {} }))
    const client = new OllamaSystemOneClient({ fetch })
    const error = await client.predict(state, questions).catch((e) => e)
    expect(error.code).toBe('protocol_error')
  })

  test('times out', async () => {
    const { fetch } = fakeFetch(
      () =>
        new Promise<Response>((_resolve, reject) =>
          setTimeout(() => reject(new Error('aborted')), 50),
        ),
    )
    const client = new OllamaSystemOneClient({ fetch, timeoutMs: 10 })
    const error = await client.predict(state, questions).catch((e) => e)
    expect(error.code).toBe('request_timeout')
  })
})
