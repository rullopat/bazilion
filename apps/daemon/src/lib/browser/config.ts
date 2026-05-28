// Resolve browser settings from the merged env (process.env + config table).
// The fields are registered as the `browser` service in `core/services.ts`, so
// operators set them on /config and they arrive here via mergeSecretsIntoEnv.

import type { BrowserConfig } from './pool.ts'

const FALSEY = new Set(['false', '0', 'no', 'off'])

function envBool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def
  return !FALSEY.has(v.trim().toLowerCase())
}

function envInt(v: string | undefined, def: number): number {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : def
}

/** Whether the `browser_*` tools should be exposed at all (default on). */
export function isBrowserEnabled(env: NodeJS.ProcessEnv): boolean {
  return envBool(env.BROWSER_ENABLED, true)
}

export function resolveBrowserConfig(env: NodeJS.ProcessEnv): BrowserConfig {
  return {
    headless: envBool(env.BROWSER_HEADLESS, true),
    allowPrivate: envBool(env.BROWSER_ALLOW_PRIVATE_NETWORK, false),
    idleMs: envInt(env.BROWSER_IDLE_MS, 900_000),
    maxSessions: envInt(env.BROWSER_MAX_SESSIONS, 4),
  }
}
