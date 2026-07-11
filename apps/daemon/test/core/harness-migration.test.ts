import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import { openDb, openInMemoryDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import * as harnessTemplateRepo from '../../src/core/repos/harnessTemplates.ts'
import * as liveHarnessRepo from '../../src/core/repos/liveHarnesses.ts'
import * as profileCommunicationDefaultsRepo from '../../src/core/repos/profileCommunicationDefaults.ts'
import * as profileGroupRepo from '../../src/core/repos/profileGroups.ts'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/core/db/migrations')
const open: BazilionDb[] = []
const tempDirs: string[] = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function legacyDb(): BazilionDb {
  const db = openInMemoryDb()
  open.push(db)
  const versions = [
    '0001_init',
    '0002_profile_groups',
    '0003_agent_telegram',
    '0004_agent_mirror_mode',
    '0005_group_topic_name_format',
    '0006_telegram_acl',
    '0007_mcp_servers',
    '0008_seed_user_md',
  ]
  for (const version of versions) {
    db.raw.exec(readFileSync(join(migrationsDir, `${version}.sql`), 'utf8'))
  }
  db.raw.exec(
    `CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  )
  for (const version of versions) {
    db.raw.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [version, 1])
  }
  return db
}

function seedLegacyFixture(db: BazilionDb): void {
  const now = 1_700_000_000_000
  db.raw.run(
    `INSERT INTO profiles
       (id, name, dir, default_model, skills_mode, created_at, updated_at)
     VALUES ('p1', 'one', '/p1', 'm', 'selected', ?, ?),
            ('p2', 'two', '/p2', 'm', 'selected', ?, ?)`,
    [now, now, now, now],
  )
  db.raw.run(
    `INSERT INTO groups (id, name, user_md, created_at)
     VALUES ('g1', 'one', 'one', ?), ('g2', 'two', 'two', ?)`,
    [now, now],
  )
  db.raw.run(
    `INSERT INTO agents
       (id, profile_id, name, status, dir, reasoning_level, group_id, created_at, archived_at)
     VALUES ('a1', 'p1', 'live', 'idle', '/a1', 'medium', 'g1', ?, NULL),
            ('a2', 'p2', 'old', 'archived', '/a2', 'medium', 'g1', ?, ?),
            ('a3', 'p1', 'solo', 'idle', '/a3', 'medium', 'g2', ?, NULL)`,
    [now, now, now + 1, now],
  )
  db.raw.run(
    `INSERT INTO profile_groups (id, name, user_md, created_at, updated_at)
     VALUES ('team', 'Team', 'starter', ?, ?)`,
    [now, now + 2],
  )
  db.raw.run(
    `INSERT INTO profile_group_members
       (profile_group_id, position, profile_id, agent_name, model_override, reasoning_level)
     VALUES ('team', 0, 'p1', 'first', NULL, NULL),
            ('team', 1, 'p1', 'second', 'x:y', 'high'),
            ('team', 2, 'p2', 'third', NULL, NULL)`,
  )
}

test('0009 atomically migrates legacy rosters and Groups to exact Open canonical state', () => {
  const db = legacyDb()
  seedLegacyFixture(db)
  const filesystem = mkdtempSync(join(tmpdir(), 'bazilion-harness-migration-'))
  tempDirs.push(filesystem)
  const sentinel = join(filesystem, 'agent.json')
  writeFileSync(sentinel, '{"untouched":true}\n')
  runMigrations(db)
  expect(readFileSync(sentinel, 'utf8')).toBe('{"untouched":true}\n')

  const tables = db.raw
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
  expect(tables).not.toContain('profile_groups')
  expect(tables).not.toContain('profile_group_members')

  const template = db.raw
    .query<{ current_revision: number; compatibility_managed: number; name: string }, []>(
      "SELECT current_revision, compatibility_managed, name FROM harness_templates WHERE id = 'team'",
    )
    .get()
  expect(template).toEqual({ current_revision: 1, compatibility_managed: 1, name: 'Team' })
  const slots = db.raw
    .query<{ slot_id: string; profile_id: string; position: number }, []>(
      'SELECT slot_id, profile_id, position FROM harness_template_slots ORDER BY position',
    )
    .all()
  expect(slots.map((slot) => slot.profile_id)).toEqual(['p1', 'p1', 'p2'])
  expect(new Set(slots.map((slot) => slot.slot_id)).size).toBe(3)
  expect(slots.every((slot) => /^[0-9a-f-]{36}$/.test(slot.slot_id))).toBe(true)
  expect(
    db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM harness_template_edges')
      .get()?.count,
  ).toBe(3 * 2 + 4 * 3)
  expect(
    db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM harness_template_revision_slots')
      .get()?.count,
  ).toBe(3)

  const harnesses = db.raw
    .query<
      {
        group_id: string
        revision: number
        membership_mode: string
        baseline_instantiation_id: string | null
      },
      []
    >(
      'SELECT group_id, revision, membership_mode, baseline_instantiation_id FROM live_harnesses ORDER BY group_id',
    )
    .all()
  expect(harnesses).toEqual([
    {
      group_id: 'g1',
      revision: 1,
      membership_mode: 'compatibility_open',
      baseline_instantiation_id: null,
    },
    {
      group_id: 'g2',
      revision: 1,
      membership_mode: 'compatibility_open',
      baseline_instantiation_id: null,
    },
  ])
  expect(
    db.raw
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM live_harness_edges WHERE group_id = 'g1'",
      )
      .get()?.count,
  ).toBe(2 + 8)
  expect(
    db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM template_instantiations')
      .get()?.count,
  ).toBe(0)
  expect(
    db.raw.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM source_slot_bindings').get()
      ?.count,
  ).toBe(0)
  expect(db.raw.query<{ table: string }, []>('PRAGMA foreign_key_check').all()).toEqual([])

  runMigrations(db)
  expect(
    db.raw
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '0009_canonical_harness'",
      )
      .get()?.count,
  ).toBe(1)
})

test('0009 rolls back schema and data when a legacy invariant is invalid', () => {
  const db = legacyDb()
  db.raw.exec('PRAGMA foreign_keys = OFF')
  db.raw.run(
    `INSERT INTO profile_groups (id, name, user_md, created_at, updated_at)
     VALUES ('broken', 'broken', NULL, 1, 1)`,
  )
  db.raw.run(
    `INSERT INTO profile_group_members
       (profile_group_id, position, profile_id, agent_name, model_override, reasoning_level)
     VALUES ('broken', 0, 'missing-profile', 'x', NULL, NULL)`,
  )
  db.raw.exec('PRAGMA foreign_keys = ON')

  expect(() => runMigrations(db)).toThrow()
  expect(
    db.raw.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM profile_group_members').get()
      ?.count,
  ).toBe(1)
  expect(
    db.raw
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'harness_templates'",
      )
      .get(),
  ).toBeNull()
  expect(
    db.raw
      .query<{ version: string }, []>(
        "SELECT version FROM schema_migrations WHERE version = '0009_canonical_harness'",
      )
      .get(),
  ).toBeNull()
})

test('disk restart preserves canonical revisions, flags, membership, edges, and Profile defaults', () => {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-harness-restart-'))
  tempDirs.push(home)
  const path = join(home, 'bazilion.db')
  let db = openDb(path)
  runMigrations(db)
  db.raw.run(
    `INSERT INTO profiles
       (id, name, dir, default_model, skills_mode, created_at, updated_at)
     VALUES ('p', 'profile', '/p', 'm', 'selected', 1, 1)`,
  )
  profileCommunicationDefaultsRepo.set(db, 'p', {
    userInput: true,
    userOutput: false,
    outsideGroupInput: true,
    outsideGroupOutput: false,
    peerDefault: 'inherit_harness',
  })
  profileGroupRepo.insert(db, { id: 'team', name: 'Team', userMd: null })
  profileGroupRepo.replaceMembers(db, 'team', [
    { profileId: 'p', agentName: 'one', modelOverride: null, reasoningLevel: null },
  ])
  const stableSlotId = harnessTemplateRepo.slots(db, 'team')[0]?.slotId
  db.raw.run("INSERT INTO groups (id, name, user_md, created_at) VALUES ('g', 'Group', '', 1)")
  db.raw.run(
    `INSERT INTO agents
       (id, profile_id, name, status, dir, reasoning_level, group_id, created_at)
     VALUES ('a', 'p', 'Agent', 'archived', '/a', 'medium', 'g', 1)`,
  )
  liveHarnessRepo.regenerateExactOpen(db, 'g')
  db.close()

  db = openDb(path)
  open.push(db)
  runMigrations(db)
  expect(harnessTemplateRepo.get(db, 'team')).toMatchObject({
    currentRevision: 2,
    compatibilityManaged: true,
  })
  expect(harnessTemplateRepo.slots(db, 'team')[0]?.slotId).toBe(stableSlotId)
  expect(harnessTemplateRepo.revision(db, 'team', 2)?.slots[0]?.slotId).toBe(stableSlotId)
  expect(liveHarnessRepo.get(db, 'g')).toMatchObject({
    revision: 2,
    membershipMode: 'compatibility_open',
  })
  expect(liveHarnessRepo.edges(db, 'g')).toHaveLength(4)
  expect(liveHarnessRepo.agentState(db, 'g')[0]).toMatchObject({ agentId: 'a', groupId: 'g' })
  expect(profileCommunicationDefaultsRepo.get(db, 'p')).toMatchObject({
    userInput: true,
    userOutput: false,
  })
})
