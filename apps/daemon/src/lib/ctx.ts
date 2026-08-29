import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import {
  type BazilionDb,
  openDb,
  type Paths,
  readAuthFile,
  refreshDefaultProfileTemplates,
  resolvePaths,
  runMigrations,
  webTokenRepo,
} from '../core/index.ts'
import { startScheduler } from './scheduler.ts'
import { assertTeamPolicyEnforcementReleaseReady } from './team-policy-contract.ts'

let _db: BazilionDb | null = null
let _paths: Paths | null = null
let _authToken: string | null = null
let _schedulerStarted = false

export const INCOMPATIBLE_BOOTSTRAP_IDENTITY_MESSAGE =
  'Bazilion cannot start because auth.json does not match an active bootstrap credential in ' +
  'bazilion.db. Preserve the entire Bazilion home directory as a filesystem backup first, ' +
  'keeping bazilion.db and auth.json together. Then perform the reset with ' +
  '`bazilion uninstall --yes` (from the repository root of a source checkout: ' +
  '`pnpm tsx apps/cli/src/index.ts uninstall --yes`) and start Bazilion again. ' +
  'Use `--all` only if you also want to remove logs and installed skills.'

export class IncompatibleBootstrapIdentityError extends Error {
  constructor() {
    super(INCOMPATIBLE_BOOTSTRAP_IDENTITY_MESSAGE)
    this.name = 'IncompatibleBootstrapIdentityError'
  }
}

export interface DaemonCtx {
  db: BazilionDb
  paths: Paths
  /**
   * Plaintext bootstrap token from `auth.json`. Used to derive the encryption
   * key for the `secrets` table — `mergeSecretsIntoEnv(db, ctx.authToken)`.
   * Cached for the process lifetime; if the user rotates the token, the
   * daemon must restart to pick it up.
   */
  authToken: string
}

/**
 * One-shot first-run bootstrap. Idempotent: every step skips itself when its
 * artifact already exists. Mints the bootstrap web_tokens row + writes the
 * plaintext into auth.json only when neither half of that identity exists.
 */
function bootstrap(paths: Paths): { db: BazilionDb; authToken: string } {
  mkdirSync(paths.home, { recursive: true })

  // auth.json is both the plaintext bootstrap credential and the PBKDF2 seed
  // for encrypted DB rows. Treat it and bazilion.db as an inseparable pair:
  // silently recreating either half can lock the operator out or make stored
  // secrets unreadable. This check runs before opening/mutating SQLite or
  // recreating reset-tier directories.
  const databaseExists = existsSync(paths.db)
  const authFileExists = existsSync(paths.authFile)
  if (databaseExists !== authFileExists) {
    throw new IncompatibleBootstrapIdentityError()
  }

  for (const d of [
    paths.profilesDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.teamsDir,
    paths.logsDir,
  ]) {
    mkdirSync(d, { recursive: true })
  }

  const db = openDb(paths.db)
  try {
    runMigrations(db)

    // When both artifacts existed at entry, validate the plaintext credential
    // against the active bootstrap row before refreshing templates or starting
    // any background service. The lookup is read-only and never records use.
    let existingAuthToken: string | null = null
    if (authFileExists) {
      try {
        existingAuthToken = readAuthFile(paths.authFile).token
      } catch {
        throw new IncompatibleBootstrapIdentityError()
      }
      const bootstrap = webTokenRepo.findActiveByToken(db, existingAuthToken)
      if (bootstrap?.kind !== 'bootstrap') {
        throw new IncompatibleBootstrapIdentityError()
      }
    }

    // The `default` profile is bazilion-managed — keep its on-disk
    // template files in sync with the shipped defaults on every boot. Custom
    // profiles are never touched. No-op on fresh installs (seedDefaults writes
    // the current templates when the profile is first created).
    const refreshed = refreshDefaultProfileTemplates(paths)
    if (refreshed.length) {
      console.log(`bazilion: refreshed default profile templates — [${refreshed.join(', ')}]`)
    }

    if (existingAuthToken === null) {
      const created = webTokenRepo.create(db, 'bootstrap', { kind: 'bootstrap' })
      writeFileSync(paths.authFile, `${JSON.stringify({ token: created.token }, null, 2)}\n`, {
        mode: 0o600,
      })
      try {
        chmodSync(paths.authFile, 0o600)
      } catch {
        // Windows: chmod is a no-op
      }
      console.log(`bazilion auto-bootstrapped at ${paths.home}`)
      console.log(`bootstrap token written to ${paths.authFile}`)
      return { db, authToken: created.token }
    }

    return { db, authToken: existingAuthToken }
  } catch (error) {
    try {
      db.close()
    } catch {
      // Preserve the original startup error; the entry point will still exit.
    }
    throw error
  }
}

export function getCtx(): DaemonCtx {
  if (!_paths) _paths = resolvePaths()
  if (!_db || _authToken === null) {
    assertTeamPolicyEnforcementReleaseReady()
    const result = bootstrap(_paths)
    _db = result.db
    _authToken = result.authToken
  }
  if (!_schedulerStarted && process.env.BAZILION_SCHEDULER !== 'off') {
    _schedulerStarted = true
    startScheduler()
  }
  return { db: _db, paths: _paths, authToken: _authToken }
}

/**
 * Synchronously close the process-owned SQLite handle during final daemon
 * shutdown. Callers must exit immediately afterward; background services keep
 * references to this process-lifetime context and are not restartable in situ.
 */
export function closeCtxForShutdown(): void {
  if (!_db) return
  _db.close()
  _db = null
  _authToken = null
}
