/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Hermes host-process runtime. Owns the runtime descriptor, per-agent home dir
 * resolution, and per-turn context prep for the host-process Hermes adapter.
 */

import { getBrowserosDir } from '../../browseros-dir'
import { logger } from '../../logger'
import type {
  PrepareAcpxAgentContextInput,
  PreparedAcpxAgentContext,
} from '../acpx/agent-adapter'
import {
  finishBrowserosManagedContext,
  prepareBrowserosManagedContext,
} from '../acpx/agent-common'
import { resolveAgentRuntimePaths } from '../acpx/runtime-context'
import { HostProcessAgentRuntime } from './host-process-agent-runtime'
import { getAgentRuntimeRegistry } from './registry'
import type { RuntimeDescriptor } from './types'

/**
 * Carries the BrowserOS-selected model from `prepareHermesContext`
 * (which has the agent) to the agent-registry `resolve()` (which only
 * sees `commandEnv`). In host mode the resolver pops this key off and
 * turns it into a `hermes -m <model>` launch flag; it is never passed to
 * the process as an actual environment variable. Including it in
 * `commandEnv` also makes the runtime cache key model-specific.
 */
export const HERMES_MODEL_COMMAND_ENV = 'BROWSEROS_HERMES_MODEL'

export type HermesRuntimeMode = 'host' | 'container'

/**
 * How BrowserOS runs Hermes:
 * - `host` (default): spawn the user's local `hermes acp` binary, which
 *   reads `~/.hermes` for providers/auth/config. Multiple chats run as
 *   separate processes/sessions and never touch a bundled container.
 * - `container`: reserved for future bundled runtime.
 *
 * Override with `BROWSEROS_HERMES_RUNTIME=container`.
 */
export function resolveHermesRuntimeMode(): HermesRuntimeMode {
  return process.env.BROWSEROS_HERMES_RUNTIME === 'container'
    ? 'container'
    : 'host'
}

/**
 * The local `hermes` binary to spawn in host mode. Defaults to `hermes`
 * (resolved via PATH); override with `BROWSEROS_HERMES_BIN` when the
 * binary lives outside the server process PATH (e.g. `~/.local/bin`).
 */
export function resolveHermesHostBinary(): string {
  const override = process.env.BROWSEROS_HERMES_BIN?.trim()
  return override || 'hermes'
}

/**
 * Host-process Hermes runtime. Registered so the `/adapters` health route
 * can probe the local `hermes` binary (like Claude/Codex). The actual ACP
 * launch command is built in `acpx-runtime`'s registry resolver.
 */
export class HermesHostRuntime extends HostProcessAgentRuntime {
  readonly descriptor: RuntimeDescriptor & { kind: 'host-process' } = {
    adapterId: 'hermes',
    displayName: 'Hermes',
    kind: 'host-process',
    platforms: ['darwin', 'linux'],
  }

  private readonly browserosDir: string

  constructor(
    deps: ConstructorParameters<typeof HostProcessAgentRuntime>[0],
    config: { browserosDir: string },
  ) {
    super(deps)
    this.browserosDir = config.browserosDir
  }

  getPerAgentHomeDir(agentId: string): string {
    return resolveAgentRuntimePaths({
      browserosDir: this.browserosDir,
      agentId,
    }).agentHome
  }

  prepareTurnContext(
    input: PrepareAcpxAgentContextInput,
  ): Promise<PreparedAcpxAgentContext> {
    return prepareHermesContext(input)
  }
}

export interface ConfigureHermesHostRuntimeOptions {
  browserosDir?: string
}

/**
 * Registers the host-process Hermes runtime (for adapter health).
 * Idempotent: returns the existing registration if one is already
 * present, so repeated startup calls don't trip the registry's
 * duplicate guard.
 */
export function configureHermesHostRuntime(
  options: ConfigureHermesHostRuntimeOptions = {},
): HermesHostRuntime {
  const registry = getAgentRuntimeRegistry()
  const existing = registry.get('hermes')
  if (existing instanceof HermesHostRuntime) return existing

  const runtime = new HermesHostRuntime(
    { binaryName: resolveHermesHostBinary() },
    { browserosDir: options.browserosDir ?? getBrowserosDir() },
  )
  registry.register(runtime)
  logger.debug('HermesHostRuntime registered', {
    binary: resolveHermesHostBinary(),
  })
  return runtime
}

export type HermesRuntimeStartupPhase = 'configure'

export interface StartHermesRuntimeBestEffortOptions
  extends ConfigureHermesHostRuntimeOptions {
  onError?: (phase: HermesRuntimeStartupPhase, error: unknown) => void
}

/**
 * Startup wiring for the Hermes adapter. Kept beside the adapter runtime so
 * the server entry point does not need to know Hermes' startup sequence.
 */
export function startHermesRuntimeBestEffort(
  options: StartHermesRuntimeBestEffortOptions = {},
): HermesHostRuntime | null {
  const { onError = logHermesStartupError, ...configureOptions } = options

  try {
    return configureHermesHostRuntime(configureOptions)
  } catch (err) {
    onError('configure', err)
    return null
  }
}

/**
 * Prepares Hermes host-mode context. The chosen model rides through
 * commandEnv as a sentinel that the resolver turns into `-m <model>`.
 * The MCP endpoint is on the host, so reach it via 127.0.0.1.
 *
 * Pure function — no runtime instance required, used directly by
 * the per-adapter prepare router in `acpx/agent-adapter.ts`.
 */
export async function prepareHermesContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const common = await prepareBrowserosManagedContext(input)
  const commandEnv: Record<string, string> = {}
  const model = input.agent.modelId?.trim()
  if (model && model !== 'default') {
    commandEnv[HERMES_MODEL_COMMAND_ENV] = model
  }
  return finishBrowserosManagedContext({
    ...common,
    commandEnv,
    browserosMcpHost: '127.0.0.1',
  })
}

function logHermesStartupError(
  _phase: HermesRuntimeStartupPhase,
  error: unknown,
): void {
  logger.warn(
    'Hermes host runtime configuration failed, continuing without it',
    {
      error: error instanceof Error ? error.message : String(error),
    },
  )
}
