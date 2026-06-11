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

/** Prepares Hermes as a host process pointing at ~/.hermes/. */
export async function prepareHermesContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const common = await prepareBrowserosManagedContext(input)

  return finishBrowserosManagedContext({
    ...common,
    commandEnv: {
      HERMES_HOME: join(homedir(), '.hermes'),
    },
  })
}
