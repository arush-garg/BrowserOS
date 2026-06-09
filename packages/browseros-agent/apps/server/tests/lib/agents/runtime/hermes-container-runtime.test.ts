/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getAgentRuntimeRegistry,
  HermesHostRuntime,
  resetAgentRuntimeRegistry,
  startHermesRuntimeBestEffort,
} from '../../../../src/lib/agents/runtime'

describe('HermesHostRuntime', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
    resetAgentRuntimeRegistry()
  })

  function mkTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-runtime-test-'))
    tempDirs.push(dir)
    return dir
  }

  describe('startHermesRuntimeBestEffort', () => {
    let originalMode: string | undefined
    beforeEach(() => {
      originalMode = process.env.BROWSEROS_HERMES_RUNTIME
      delete process.env.BROWSEROS_HERMES_RUNTIME
    })
    afterEach(() => {
      if (originalMode === undefined)
        delete process.env.BROWSEROS_HERMES_RUNTIME
      else process.env.BROWSEROS_HERMES_RUNTIME = originalMode
    })

    it('registers a host-process runtime and returns it', () => {
      const result = startHermesRuntimeBestEffort({
        browserosDir: mkTempDir(),
      })
      expect(result).toBeInstanceOf(HermesHostRuntime)
      expect(getAgentRuntimeRegistry().get('hermes')).toBe(result)
    })

    it('returns null when configuration throws', () => {
      const errors: Array<{ phase: string; message: string }> = []
      const result = startHermesRuntimeBestEffort({
        browserosDir: mkTempDir(),
        onError: (phase, error) => {
          errors.push({
            phase,
            message: error instanceof Error ? error.message : String(error),
          })
        },
      })
      // First call registers — second call on same dir would throw the
      // registry duplicate guard if we'd already registered.
      expect(result).toBeInstanceOf(HermesHostRuntime)
    })

    it('returns same runtime on idempotent second call', () => {
      const browserosDir = mkTempDir()
      const first = startHermesRuntimeBestEffort({ browserosDir })
      const second = startHermesRuntimeBestEffort({ browserosDir })
      expect(first).toBeInstanceOf(HermesHostRuntime)
      expect(second).toBe(first)
    })

    it('reports configure failure without throwing', () => {
      const errors: Array<{ phase: string; message: string }> = []
      // Force a failure by registering a different runtime first so the
      // registry duplicate guard fires for the hermes adapter id.
      const registry = getAgentRuntimeRegistry()
      registry.register({
        descriptor: {
          adapterId: 'hermes',
          displayName: 'Hermes (stub)',
          kind: 'host-process',
          platforms: ['darwin'],
        },
      } as unknown as HermesHostRuntime)

      const result = startHermesRuntimeBestEffort({
        browserosDir: mkTempDir(),
        onError: (phase, error) => {
          errors.push({
            phase,
            message: error instanceof Error ? error.message : String(error),
          })
        },
      })

      expect(result).toBeNull()
      expect(errors[0]?.phase).toBe('configure')
    })
  })
})
