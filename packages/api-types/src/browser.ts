// Wire shape of an agent's managed browser status (GET /api/agents/:id/browser).

/** `attached`: BROWSER_ATTACH, the Agent works in a browser that is already running. */
export type BrowserMode = 'headed' | 'headless' | 'attached'

export interface BrowserStatus {
  agentId: string
  /** BROWSER_ENABLED: whether agents get the `browser_*` tools. */
  enabled: boolean
  /** A browser is running for this agent right now. */
  running: boolean
  /** The agent's browser profile (cookies, logins) exists on disk. */
  profilePresent: boolean
  /** The browser that is (or would be) used, when one is found. */
  browser?: { name: string; mode: BrowserMode }
  /** Why the browser cannot run: none found (or still downloading), or the last start failed. */
  error?: string
}
