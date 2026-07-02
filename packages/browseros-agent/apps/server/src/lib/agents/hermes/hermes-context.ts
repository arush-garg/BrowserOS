/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
  PrepareAcpxAgentContextInput,
  PreparedAcpxAgentContext,
} from '../acpx/agent-adapter'
import {
  finishBrowserosManagedContext,
  prepareBrowserosManagedContext,
} from '../acpx/agent-common'
import { HERMES_MODEL_COMMAND_ENV } from '../runtime/hermes-container-runtime'
import { ensureHermesAgentHomeHostDir } from './hermes-paths'

/** Prepares Hermes as a host process pointing at the per-agent host home dir. */
export async function prepareHermesContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const common = await prepareBrowserosManagedContext(input)
  const hermesHome = await ensureHermesAgentHomeHostDir({
    browserosDir: input.browserosDir,
    agentId: input.agent.id,
  })
  const commandEnv: Record<string, string> = {
    HERMES_HOME: hermesHome,
  }

  // Pass user-selected model so resolveHermesHostAcpAdapterCommand
  // converts it to `-m <model>` on the launch command.
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
