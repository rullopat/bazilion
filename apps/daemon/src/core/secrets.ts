// Auth / secrets entry points keyed off the bootstrap `auth.json` file.
//
// `auth.json` carries one mandatory field — `token` — written by the daemon's
// first-run bootstrap. The daemon uses it as the PBKDF2 seed for the `secrets`
// table; the CLI uses it as the bearer for loopback HTTP. CLI-side `remote`
// overrides (set by `bazilion login`) coexist in the same file.

import { existsSync, readFileSync } from 'node:fs'
import type { BazilionDb } from './db/client.ts'
import { MODEL_WINDOWS_KEY, openConfig, PROVIDER_CHECKS_KEY } from './repos/config.ts'
import { openSecrets } from './repos/secrets.ts'

export interface AuthFile {
  token: string
  remote?: { server: string; token: string } | null
}

/**
 * Read `auth.json` and return the parsed contents. Throws when missing or
 * malformed — callers should treat that as "bazilion not initialized."
 */
export function readAuthFile(authFile: string): AuthFile {
  if (!existsSync(authFile)) {
    throw new Error(
      `${authFile} not found. Start the daemon (\`bazilion serve\`) — it auto-bootstraps on first run.`,
    )
  }
  const raw = readFileSync(authFile, 'utf8')
  const parsed = JSON.parse(raw) as Partial<AuthFile>
  if (typeof parsed.token !== 'string' || !parsed.token) {
    throw new Error(`${authFile} is missing the "token" field`)
  }
  return {
    token: parsed.token,
    remote: parsed.remote ?? null,
  }
}

/**
 * Merge plaintext config + decrypted secrets + process env into a single
 * env-shaped record. Precedence (low → high): config → secrets → env. The
 * caller supplies the bootstrap `password` (typically `readAuthFile().token`)
 * because the secrets table is encrypted with it. A secret that does not
 * decrypt (corrupt row, other password) is left out. The record of provider
 * tests is state, not a setting, and stays out.
 */
export function mergeSecretsIntoEnv(
  db: BazilionDb,
  password: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // Daemon state kept as JSON is not a setting a process reads from its environment.
  const {
    [PROVIDER_CHECKS_KEY]: _checks,
    [MODEL_WINDOWS_KEY]: _windows,
    ...config
  } = openConfig(db).getAll()
  return { ...config, ...openSecrets(db, password).getAll(), ...env }
}
