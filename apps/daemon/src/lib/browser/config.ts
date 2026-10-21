// Resolve browser settings from the merged env (process.env + config table).
// The fields are registered as the `browser` service in `core/services.ts`, so
// operators set them on /config and they arrive here via mergeSecretsIntoEnv.
//
// `BROWSER_EXECUTABLE_PATH` (BAZ-069 D2) is a plaintext, operator-owned,
// absolute path to a supported Chromium-family browser. An explicitly invalid
// selection must fail rather than silently run a different binary; discovery
// (when unset) is owned by `executable.ts`.

import type { BrowserMode } from '@bazilion/api-types'
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

/**
 * How the operator expressed headless preference.
 *  - `headed` / `headless`: an explicit `BROWSER_HEADLESS` boolean.
 *  - `auto`: unset — resolve from the display environment at admission.
 *
 * Keeping the three-way distinction matters: "auto with no display" and
 * "explicitly headless" are different facts to report, and an explicit headed
 * request must fail on a displayless host instead of silently going headless.
 */
export type BrowserModePreference = 'auto' | BrowserMode

export function resolveBrowserModePreference(env: NodeJS.ProcessEnv): BrowserModePreference {
  const raw = env.BROWSER_HEADLESS
  if (raw === undefined || raw === '') return 'auto'
  return envBool(raw, true) ? 'headless' : 'headed'
}

/** Whether the `browser_*` tools should be exposed at all (default on). */
export function isBrowserEnabled(env: NodeJS.ProcessEnv): boolean {
  return envBool(env.BROWSER_ENABLED, true)
}

/**
 * The configured executable path, trimmed. An empty/whitespace value counts
 * as unset (discovery). Validation of the path happens at resolution time
 * (`executable.ts`), not here — status reads must stay side-effect free.
 */
export function configuredBrowserExecutablePath(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.BROWSER_EXECUTABLE_PATH?.trim()
  return raw ? raw : undefined
}

export function resolveBrowserConfig(env: NodeJS.ProcessEnv): BrowserConfig {
  const mode = resolveBrowserModePreference(env)
  const executablePath = configuredBrowserExecutablePath(env)
  return {
    mode,
    ...(executablePath ? { executablePath } : {}),
    allowPrivate: envBool(env.BROWSER_ALLOW_PRIVATE_NETWORK, false),
    idleMs: envInt(env.BROWSER_IDLE_MS, 900_000),
    maxSessions: envInt(env.BROWSER_MAX_SESSIONS, 4),
  }
}
