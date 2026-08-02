import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { type BazilionDb, openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { type Paths, resolvePaths } from '../../src/core/paths.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import * as triggerDispatchRepo from '../../src/core/repos/triggerDispatches.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import { registerTeam } from '../../src/core/team/register.ts'

let home: string
let paths: Paths
let db: BazilionDb

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-trigger-restart-test-'))
  paths = resolvePaths(home)
  for (const dir of [
    paths.profilesDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.logsDir,
    paths.teamsDir,
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  db = openDb(paths.db)
  runMigrations(db)

  const team = registerTeam(db, { id: 'test-team', name: 'test' }, paths)
  profileRepo.insert(db, {
    id: 'p',
    name: 'p',
    dir: paths.profileDir('p'),
    defaultModel: 'lmstudio:x',
    skillsMode: 'selected',
  })
  agentRepo.insert(db, {
    id: 'a1',
    profileId: 'p',
    name: 'A',
    modelOverride: null,
    reasoningLevel: 'medium',
    status: 'idle',
    dir: paths.agentDir('a1'),
    teamId: team.id,
  })
})

afterEach(() => {
  db.close()
  rmSync(home, { recursive: true, force: true })
})

test('an expired running lease survives a database close and is claimable after reopen', () => {
  const trigger = triggerRepo.insert(db, {
    agentId: 'a1',
    kind: 'interval',
    intervalSec: 60,
    cronExpr: null,
    message: 'work',
  })
  const dispatch = triggerDispatchRepo.materialize(db, {
    triggerId: trigger.id,
    agentId: 'a1',
    scheduledAt: 1_000,
    now: 2_000,
  })

  expect(triggerDispatchRepo.claim(db, dispatch.id, { now: 2_000, leaseMs: 100 })).toMatchObject({
    status: 'running',
    attemptCount: 1,
    leaseExpiresAt: 2_100,
  })

  db.close()
  db = openDb(paths.db)
  runMigrations(db)

  expect(triggerDispatchRepo.get(db, dispatch.id)).toMatchObject({
    status: 'running',
    attemptCount: 1,
    leaseExpiresAt: 2_100,
  })
  expect(triggerDispatchRepo.listClaimable(db, 2_101).map((item) => item.id)).toContain(dispatch.id)
  expect(triggerDispatchRepo.claim(db, dispatch.id, { now: 2_101 })).toMatchObject({
    status: 'running',
    attemptCount: 2,
  })
})
