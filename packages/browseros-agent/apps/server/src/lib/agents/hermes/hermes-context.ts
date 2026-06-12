/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  PrepareAcpxAgentContextInput,
  PreparedAcpxAgentContext,
} from '../acpx/agent-adapter'
import {
  finishBrowserosManagedContext,
  prepareBrowserosManagedContext,
} from '../acpx/agent-common'
import { HERMES_MODEL_COMMAND_ENV } from '../runtime/hermes-container-runtime'

/** Prepares Hermes as a host process pointing at ~/.hermes/. */
export async function prepareHermesContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const common = await prepareBrowserosManagedContext(input)
  const commandEnv: Record<string, string> = {
    HERMES_HOME: join(homedir(), '.hermes'),
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
  })
}
