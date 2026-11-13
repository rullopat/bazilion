// Browser settings from the merged env (process.env + the config table). The
// keys are the `browser` service in `core/services.ts`, editable on /config.

export interface BrowserConfig {
  /** Default true; false opens a visible browser window on the desktop. */
  headless: boolean
  /** Explicit browser binary; unset means discovery (`executable.ts`). */
  executablePath?: string
  /** Skip the SSRF proxy so pages can reach loopback/private addresses. */
  allowPrivate: boolean
  idleMs: number
  maxSessions: number
}

const FALSEY = new Set(['false', '0', 'no', 'off'])

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  return !FALSEY.has(value.trim().toLowerCase())
}

function envInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Whether agents get the `browser_*` tools at all (default on). */
export function isBrowserEnabled(env: NodeJS.ProcessEnv): boolean {
  return envBool(env.BROWSER_ENABLED, true)
}

export function resolveBrowserConfig(env: NodeJS.ProcessEnv): BrowserConfig {
  const executablePath = env.BROWSER_EXECUTABLE_PATH?.trim()
  return {
    headless: envBool(env.BROWSER_HEADLESS, true),
    ...(executablePath ? { executablePath } : {}),
    allowPrivate: envBool(env.BROWSER_ALLOW_PRIVATE_NETWORK, false),
    idleMs: envInt(env.BROWSER_IDLE_MS, 900_000),
    maxSessions: envInt(env.BROWSER_MAX_SESSIONS, 4),
  }
}
