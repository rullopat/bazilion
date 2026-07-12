import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BazilionDb, openInMemoryDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { type Paths, resolvePaths } from '../../src/core/paths.ts'
import { registerTeam } from '../../src/core/team/register.ts'

// `process.env.BAZILION_HOME` is consumed by `resolvePaths`. Some tests pass a
// home explicitly; other code paths reach for the env. Either works.

export interface TestEnv {
  home: string
  paths: Paths
  db: BazilionDb
  /**
   * A team registered automatically so spawn/resolve always have a valid
   * id to target. Named `test-team` — tests that need more can register
   * extras.
   */
  teamId: string
  cleanup: () => void
}

export function makeTestEnv(): TestEnv {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-test-'))
  const paths = resolvePaths(home)
  for (const d of [
    paths.profilesDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.logsDir,
    paths.teamsDir,
  ]) {
    mkdirSync(d, { recursive: true })
  }
  const db = openInMemoryDb()
  runMigrations(db)
  const team = registerTeam(db, { id: 'test-team', name: 'test' }, paths)
  return {
    home,
    paths,
    db,
    teamId: team.id,
    cleanup() {
      db.close()
      rmSync(home, { recursive: true, force: true })
    },
  }
}
