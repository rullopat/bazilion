// The daemon side of a turn's `browser_*` tools. Calls always drive the turn's
// own agent's browser, whatever agent id the worker sends.

import type { Paths } from '../../core/index.ts'
import type { BrowserHost } from '../../runtime/index.ts'
import type { BrowserConfig } from './config.ts'
import { invokeBrowserAction } from './pool.ts'

export function createBrowserHost(
  config: BrowserConfig,
  turn: { agentId: string; paths: Paths; signal?: AbortSignal },
): BrowserHost {
  return {
    invoke: (_workerAgentId, action, args) =>
      invokeBrowserAction(turn.agentId, action, args, config, turn.paths, turn.signal),
  }
}
