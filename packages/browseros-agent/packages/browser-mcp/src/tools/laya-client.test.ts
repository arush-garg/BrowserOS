import { afterEach, describe, expect, it } from 'bun:test'
import { LayaClient, resolveLayaPython, validateRequest } from './laya-client'

const mockService = new URL(
  '../../python/mock_laya_service.py',
  import.meta.url,
).pathname
const clients: LayaClient[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
})

const questions = {
  operation: {
    type: 'choice' as const,
    instructions: 'Choose the next operation',
    criteria: {
      CLICK: 'Click an element',
      DONE: 'The task is complete',
    },
  },
  click_target: {
    type: 'choice' as const,
    instructions: 'Choose the click target',
    criteria: {
      e1: 'First element',
      e2: 'Second element',
    },
  },
}

describe('LayaClient', () => {
  it('round-trips repeated predictions through one persistent JSONL process', async () => {
    const client = new LayaClient({ command: ['python3', mockService] })
    clients.push(client)

    const state = { page: { text: 'one' } }
    const first = await client.predict(state, questions)
    const second = await client.predict(state, questions)

    expect(first.usage).toEqual({ input_tokens: 2, output_tokens: 0 })
    expect(first.answers).toMatchObject({
      operation: {
        choice: 'CLICK',
        probabilities: { CLICK: 1, DONE: 0 },
        confidence: 1,
      },
      click_target: {
        choice: 'e1',
        probabilities: { e1: 1, e2: 0 },
        confidence: 1,
      },
    })
    expect(second).toEqual(first)
  })

  it('rejects responses missing a requested answer', async () => {
    const script =
      "import json,sys; r=json.loads(sys.stdin.readline()); print(json.dumps({'request_id':r['request_id'],'answers':{'operation':{'choice':'CLICK','probabilities':{'CLICK':1,'DONE':0}}},'usage':{'input_tokens':1}}), flush=True)"
    const client = new LayaClient({ command: ['python3', '-c', script] })
    clients.push(client)

    await expect(
      client.predict({ page: { text: 'page' } }, questions),
    ).rejects.toThrow('missing click_target answer')
  })

  it('surfaces child startup failures', async () => {
    const client = new LayaClient({
      command: ['/definitely/missing/laya'],
      timeoutMs: 500,
    })
    clients.push(client)

    await expect(
      client.predict(
        { page: { text: 'page' } },
        {
          operation: questions.operation,
        },
      ),
    ).rejects.toThrow()
  })

  it('accepts one criterion and object or array instructions', () => {
    expect(() =>
      validateRequest(
        { page: { text: 'page' } },
        {
          operation: {
            type: 'choice',
            instructions: { goal: 'Choose' },
            criteria: { DONE: 'done' },
          },
          target: {
            type: 'choice',
            instructions: ['Choose', 'the target'],
            criteria: { e1: 'first' },
          },
        },
      ),
    ).not.toThrow()
  })

  it('rejects more than 64 criteria', () => {
    const criteria = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`option-${index}`, 'option']),
    )
    expect(() =>
      validateRequest(
        { page: { text: 'page' } },
        {
          operation: { type: 'choice', instructions: 'Choose', criteria },
        },
      ),
    ).toThrow('1-64 criteria')
  })

  it('rejects duplicate normalized criteria names', () => {
    expect(() =>
      validateRequest(
        { page: { text: 'page' } },
        {
          operation: {
            type: 'choice',
            instructions: 'Choose',
            criteria: { DONE: 'done', ' DONE ': 'also done' },
          },
        },
      ),
    ).toThrow('duplicate criterion')
  })
})

describe('resolveLayaPython', () => {
  it('prefers the explicit interpreter', () => {
    expect(
      resolveLayaPython({
        explicitPython: '/custom/python',
        startDirectory: '/workspace/package',
        homeDirectory: '/home/test',
        isFile: () => true,
      }),
    ).toBe('/custom/python')
  })

  it('searches ancestor virtual environments before the development fallback', () => {
    const files = new Set(['/workspace/.venv/bin/python'])

    expect(
      resolveLayaPython({
        startDirectory: '/workspace/package/src',
        homeDirectory: '/home/test',
        isFile: (path) => files.has(path),
      }),
    ).toBe('/workspace/.venv/bin/python')
  })

  it('uses the development environment before python3', () => {
    const developmentPython = '/home/test/Development/v_env/bin/python'

    expect(
      resolveLayaPython({
        startDirectory: '/workspace/package/src',
        homeDirectory: '/home/test',
        isFile: (path) => path === developmentPython,
      }),
    ).toBe(developmentPython)
  })

  it('falls back to python3 when no interpreter is found', () => {
    expect(
      resolveLayaPython({
        startDirectory: '/workspace/package/src',
        homeDirectory: '/home/test',
        isFile: () => false,
      }),
    ).toBe('python3')
  })
})
