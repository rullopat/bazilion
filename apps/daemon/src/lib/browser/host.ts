// Daemon-side `BrowserHost` — services the worker's `browser_*` IPC calls by
// driving the Playwright pool in `pool.ts`. One per turn; the pool it talks to
// is the process-lifetime registry, so sessions persist across turns.

import type { BrowserHost } from '../../runtime/index.ts'
import { type BrowserConfig, invokeBrowserAction } from './pool.ts'

export function createBrowserHost(config: BrowserConfig): BrowserHost {
  return {
    invoke: (agentId, action, args) => invokeBrowserAction(agentId, action, args, config),
  }
}
