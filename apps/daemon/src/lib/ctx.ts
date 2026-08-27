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
 * plaintext into auth.json the first time we see no auth file.
 */
function bootstrap(paths: Paths): { db: BazilionDb; authToken: string } {
  mkdirSync(paths.home, { recursive: true })
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
  runMigrations(db)

  // The `default` profile is bazilion-managed — keep its on-disk
  // template files in sync with the shipped defaults on every boot. Custom
  // profiles are never touched. No-op on fresh installs (seedDefaults writes
  // the current templates when the profile is first created).
  const refreshed = refreshDefaultProfileTemplates(paths)
  if (refreshed.length) {
    console.log(`bazilion: refreshed default profile templates — [${refreshed.join(', ')}]`)
  }

  if (!existsSync(paths.authFile)) {
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

  return { db, authToken: readAuthFile(paths.authFile).token }
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
