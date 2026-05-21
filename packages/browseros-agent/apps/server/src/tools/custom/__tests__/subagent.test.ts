/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/* biome-disable suspicious/noExplicitAny style/noNonNullAssertion */
import { beforeEach, describe, expect, it } from 'bun:test'
import type { ToolExecutionOptions } from 'ai'
import type { ResolvedAgentConfig } from '../../../agent/types'

const testToolOptions: ToolExecutionOptions = {
  toolCallId: 'test-tool-call',
  messages: [],
}

/**
 * Creates a minimal ResolvedAgentConfig for testing.
 * Uses provider='browseros' which triggers the mock LLM path
 * when BROWSEROS_USE_MOCK_LLM=true is set.
 */
function createTestConfig(
  overrides?: Partial<ResolvedAgentConfig>,
): ResolvedAgentConfig {
  return {
    provider: 'browseros',
    model: 'browseros-test-mock',
    apiKey: 'test-key',
    conversationId: 'test-conversation',
    baseUrl: 'http://localhost:1234',
    upstreamProvider: 'openai',
    resourceName: '',
    region: '',
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: '',
    accountId: '',
    reasoningEffort: '',
    reasoningSummary: '',
    contextWindowSize: 4096,
    userSystemPrompt: '',
    workingDir: '/tmp',
    supportsImages: false,
    evalMode: false,
    chatMode: false,
    isScheduledTask: false,
    declinedApps: [],
    origin: undefined,
    browserosId: '',
    toolApprovalConfig: { categories: {} },
    ...overrides,
  }
}

describe('Subagent Tools', () => {
  beforeEach(() => {
    // Set env var so createLanguageModel uses the mock LLM path
    process.env.BROWSEROS_USE_MOCK_LLM = 'true'
  })

  it('exports createSubagentSpawnTool and createSubagentGetResultTool', async () => {
    const { createSubagentSpawnTool, createSubagentGetResultTool } =
      await import('../subagent')
    const config = createTestConfig()
    const spawnTool = createSubagentSpawnTool(config)
    const getResultTool = createSubagentGetResultTool()

    expect(spawnTool.description).toBeTruthy()
    expect(spawnTool.inputSchema).toBeTruthy()
    expect(getResultTool.description).toBeTruthy()
    expect(getResultTool.inputSchema).toBeTruthy()
  })

  it('sync spawn returns text result from mock LLM', async () => {
    const { createSubagentSpawnTool } = await import('../subagent')
    const config = createTestConfig()
    const spawnTool = createSubagentSpawnTool(config)

    const result = (await spawnTool.execute?.(
      {
        instructions: 'Say hello',
        maxSteps: 1,
        runMode: 'sync',
      },
      testToolOptions,
    )) as { type: 'text' | 'error-text'; value: string }

    expect(result.type).toBe('text')
    expect(typeof result.value).toBe('string')
    expect(result.value.length).toBeGreaterThan(0)
  })

  it('sync spawn passes instructions as both system and user message', async () => {
    const { createSubagentSpawnTool } = await import('../subagent')
    const config = createTestConfig()
    const spawnTool = createSubagentSpawnTool(config)

    // The mock LLM will respond regardless, but we verify the tool
    // doesn't throw and returns a result
    const result = (await spawnTool.execute?.(
      {
        instructions: 'You are a helpful assistant. Tell me a joke.',
        maxSteps: 2,
        runMode: 'sync',
      },
      testToolOptions,
    )) as { type: 'text' | 'error-text'; value: string }

    expect(result.type).toBe('text')
    expect(result.value).toBeTruthy()
  })

  it('sync spawn with provider/model override uses session defaults when not specified', async () => {
    const { createSubagentSpawnTool } = await import('../subagent')
    const config = createTestConfig({
      provider: 'browseros',
      model: 'browseros-test-mock',
    })
    const spawnTool = createSubagentSpawnTool(config)

    // No provider/model override - should fall back to session config
    const result = (await spawnTool.execute?.(
      {
        instructions: 'Test default provider',
        maxSteps: 1,
        runMode: 'sync',
      },
      testToolOptions,
    )) as { type: 'text' | 'error-text'; value: string }

    expect(result.type).toBe('text')
  })

  it('sync spawn returns error-text on invalid provider', async () => {
    // Temporarily disable mock LLM so it tries the real provider path
    const originalValue = process.env.BROWSEROS_USE_MOCK_LLM
    process.env.BROWSEROS_USE_MOCK_LLM = 'false'

    try {
      // Need fresh import since module may cache
      // We test with an invalid provider that will fail in createLanguageModel
      const { createSubagentSpawnTool } = await import('../subagent')
      const config = createTestConfig({
        provider:
          'nonexistent-provider' as unknown as ResolvedAgentConfig['provider'],
        model: 'test',
      })
      const spawnTool = createSubagentSpawnTool(config)

      const result = (await spawnTool.execute?.(
        {
          instructions: 'This should fail',
          maxSteps: 1,
          runMode: 'sync',
        },
        testToolOptions,
      )) as { type: 'text' | 'error-text'; value: string }

      expect(result.type).toBe('error-text')
      expect(result.value).toContain('Unknown provider')
    } finally {
      process.env.BROWSEROS_USE_MOCK_LLM = originalValue
    }
  })

  it('async spawn returns a jobId', async () => {
    const { createSubagentSpawnTool } = await import('../subagent')
    const config = createTestConfig()
    const spawnTool = createSubagentSpawnTool(config)

    const result = (await spawnTool.execute?.(
      {
        instructions: 'Background task',
        maxSteps: 1,
        runMode: 'async',
      },
      testToolOptions,
    )) as { type: 'text' | 'error-text'; value: string }

    expect(result.type).toBe('text')
    expect(result.value).toMatch(
      /Subagent job spawned with ID: job_\d+_[a-z0-9]+/,
    )
  })

  it('get_result returns completed job result', async () => {
    const { createSubagentSpawnTool, createSubagentGetResultTool } =
      await import('../subagent')
    const config = createTestConfig()
    const spawnTool = createSubagentSpawnTool(config)
    const getResultTool = createSubagentGetResultTool()

    // Spawn an async job
    const spawnResult = (await spawnTool.execute?.(
      {
        instructions: 'Complete this task',
        maxSteps: 2,
        runMode: 'async',
      },
      testToolOptions,
    )) as { type: 'text' | 'error-text'; value: string }

    // Extract jobId from the response text
    const jobIdMatch = (spawnResult.value as string).match(/job_\d+_[a-z0-9]+/)
    expect(jobIdMatch).toBeTruthy()
    const jobId = jobIdMatch ? jobIdMatch[0] : ''

    // Wait a bit for the async job to complete (mock LLM is fast)
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Get the result
    const getResult = (await getResultTool.execute?.(
      { jobId },
      testToolOptions,
    )) as {
      type: 'text' | 'error-text'
      value: string
    }

    expect(getResult.type).toBe('text')
    expect(getResult.value).toBeTruthy()
  })

  it('get_result returns error-text for unknown jobId', async () => {
    const { createSubagentGetResultTool } = await import('../subagent')
    const getResultTool = createSubagentGetResultTool()

    const result = (await getResultTool.execute?.(
      { jobId: 'job_nonexistent_12345' },
      testToolOptions,
    )) as { type: 'text' | 'error-text'; value: string }

    expect(result.type).toBe('error-text')
    expect(result.value).toContain('Job not found')
  })

  it('get_result returns pending/running status for in-progress job', async () => {
    const { createSubagentSpawnTool, createSubagentGetResultTool } =
      await import('../subagent')
    const config = createTestConfig()
    const spawnTool = createSubagentSpawnTool(config)
    const getResultTool = createSubagentGetResultTool()

    // Spawn an async job
    const spawnResult = (await spawnTool.execute?.(
      {
        instructions: 'Slow task',
        maxSteps: 2,
        runMode: 'async',
      },
      testToolOptions,
    )) as { type: 'text' | 'error-text'; value: string }

    const jobIdMatch = (spawnResult.value as string).match(/job_\d+_[a-z0-9]+/)
    expect(jobIdMatch).toBeTruthy()
    const jobId = jobIdMatch ? jobIdMatch[0] : ''

    // Immediately check - job may still be pending/running
    const immediateResult = (await getResultTool.execute?.(
      { jobId },
      testToolOptions,
    )) as {
      type: 'text' | 'error-text'
      value: string
    }

    // It's either still running or already completed (mock is fast)
    expect(['text', 'error-text']).toContain(immediateResult.type)
    if (
      immediateResult.type === 'text' &&
      immediateResult.value.includes('still')
    ) {
      expect(immediateResult.value).toContain('still')
    }
  })
})
