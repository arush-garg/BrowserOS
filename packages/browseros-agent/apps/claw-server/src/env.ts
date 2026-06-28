/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Single chokepoint for non-startup env reads. Startup config lives
 * in config.ts so it can be validated before serving.
 */

import type { ClawConfig } from './config'
import { resolveDefaultResourcesDir } from './config'
import { CLAW_API_PORT_DEFAULT, CLAW_CDP_PORT_DEFAULT } from './shared/port'

function readBrowserosDirOverride(): string | undefined {
  // biome-ignore lint/style/noProcessEnv: env.ts is the sanctioned env-reader for the package
  const raw = process.env.BROWSEROS_DIR?.trim()
  return raw && raw.length > 0 ? raw : undefined
}

function readIsDevelopment(): boolean {
  // biome-ignore lint/style/noProcessEnv: env.ts is the sanctioned env-reader for the package
  return process.env.NODE_ENV === 'development'
}

/**
 * Opt-in gate for legacy MCP surfaces. Defaults to `false` so the
 * legacy path is invisible unless explicitly requested.
 */
function readBoolFlag(name: string): boolean {
  // biome-ignore lint/style/noProcessEnv: env.ts is the sanctioned env-reader for the package
  const raw = process.env[name]
  if (raw === undefined) return false
  const normalised = raw.trim().toLowerCase()
  return normalised === '1' || normalised === 'true'
}

/**
 * Runtime snapshot shared across services. main.ts applies validated
 * startup config before serving; tests may mutate fields for isolation.
 */
export const env = {
  port: CLAW_API_PORT_DEFAULT,
  cdpPort: CLAW_CDP_PORT_DEFAULT,
  resourcesDir: resolveDefaultResourcesDir(),
  browserosDirOverride: readBrowserosDirOverride(),
  isDevelopment: readIsDevelopment(),
}

/** Applies validated startup config to the shared runtime snapshot. */
export function applyClawConfig(config: ClawConfig): void {
  env.port = config.port
  env.cdpPort = config.cdpPort
  env.resourcesDir = config.resourcesDir
}

/**
 * Request-time read of the legacy per-slug MCP gate. Evaluated at
 * call time (not once at module load) so the existing per-slug
 * integration tests can flip the flag from `beforeAll` without
 * juggling import order. Default is `false`: the legacy URL shape
 * returns 404 unless the flag is explicitly set.
 */
export function isCockpitLegacyPerAgentMcpEnabled(): boolean {
  return readBoolFlag('COCKPIT_LEGACY_PER_AGENT_MCP')
}
