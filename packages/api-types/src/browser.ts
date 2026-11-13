// Wire shape of an agent's managed browser status (GET /api/agents/:id/browser).

export type BrowserMode = 'headed' | 'headless'

export interface BrowserStatus {
  agentId: string
  /** BROWSER_ENABLED: whether agents get the `browser_*` tools. */
  enabled: boolean
  /** A browser is running for this agent right now. */
  running: boolean
  /** The agent's browser profile (cookies, logins) exists on disk. */
  profilePresent: boolean
  /** The browser that is (or would be) launched, when one is found. */
  browser?: { name: string; mode: BrowserMode }
  /** Why the browser cannot run: none found, or the last launch failed. */
  error?: string
}
