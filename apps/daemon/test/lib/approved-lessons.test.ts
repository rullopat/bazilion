// Reviewed learning is removed in 0.66.0 (BAZ-103): upgrading a home from before it keeps the
// lessons the owner approved for one Agent, in its AGENTS.md, and drops the rest.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openDb } from '../../src/core/db/client.ts'
import { shippedSchema } from '../../src/core/db/schema.ts'
import * as webTokenRepo from '../../src/core/repos/webTokens.ts'
import { keepApprovedLessons } from '../../src/lib/approved-lessons.ts'

let home: string
let oldHome: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-approved-lessons-'))
  oldHome = process.env.BAZILION_HOME
  process.env.BAZILION_HOME = home
  vi.resetModules()
})

afterEach(async () => {
  const { closeCtxForShutdown } = await import('../../src/lib/ctx.ts')
  closeCtxForShutdown()
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

/** A 0.65 home: schema 4, with reviews, lessons in every state and notification settings. */
function writeHome065(): void {
  const db = openDb(join(home, 'bazilion.db'))
  for (const migration of shippedSchema().migrations.slice(0, 4)) db.raw.exec(migration.sql)
  db.raw.exec('PRAGMA user_version = 4')
  const { token } = webTokenRepo.create(db, 'bootstrap', { kind: 'bootstrap' })
  db.raw.exec(`
    INSERT INTO teams (id, name, created_at) VALUES ('team', 'Team', 1);
    INSERT INTO profiles (id, name, default_model, created_at, updated_at)
      VALUES ('profile', 'Profile', 'lmstudio:test', 1, 1);
    INSERT INTO agents (id, profile_id, name, status, team_id, created_at, review_enabled)
      VALUES ('agent', 'profile', 'Agent', 'idle', 'team', 1, 1);
    INSERT INTO agents (id, profile_id, name, status, team_id, created_at)
      VALUES ('quiet', 'profile', 'Quiet', 'idle', 'team', 2);
    INSERT INTO agent_reviews (id, agent_id, status, trigger_kind, created_at, updated_at)
      VALUES ('review', 'agent', 'completed', 'manual', 1, 1);
    INSERT INTO agent_lesson_proposals
      (id, review_id, agent_id, scope, text, evidence_json, status, created_at, updated_at) VALUES
      ('first', 'review', 'agent', 'private', 'Run the tests before saying it works.', '[]', 'approved', 1, 1),
      ('second', 'review', 'agent', 'private', 'Deploys go through staging first.', '[]', 'approved', 2, 2),
      ('team', 'review', 'agent', 'shared', 'SHARED_LESSON', '[]', 'approved', 3, 3),
      ('waiting', 'review', 'agent', 'private', 'PENDING_LESSON', '[]', 'pending', 4, 4),
      ('no', 'review', 'agent', 'private', 'REJECTED_LESSON', '[]', 'rejected', 5, 5),
      ('gone', 'review', 'agent', 'private', 'REVOKED_LESSON', '[]', 'revoked', 6, 6);
    INSERT INTO notification_settings (singleton, enabled, kinds_json, timezone)
      VALUES (1, 1, '["lesson_proposal","trigger_failure","review_failure"]', 'UTC');
    INSERT INTO attention_acknowledgements (source_kind, source_id, acknowledged_at) VALUES
      ('review_failure', 'review', 1), ('trigger_failure', 'run', 1);
  `)
  db.close()
  writeFileSync(join(home, 'auth.json'), `${JSON.stringify({ token })}\n`, { mode: 0o600 })
  mkdirSync(join(home, 'agents', 'agent'), { recursive: true })
  writeFileSync(
    join(home, 'agents', 'agent', 'AGENTS.md'),
    '# Your role\n\nWrites the newsletter.\n',
  )
  mkdirSync(join(home, 'agents', 'quiet'), { recursive: true })
}

test('the upgrade keeps approved lessons for one Agent in its AGENTS.md and drops the rest', async () => {
  writeHome065()
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { db, paths } = getCtx()

  const instructions = readFileSync(join(home, 'agents', 'agent', 'AGENTS.md'), 'utf8')
  expect(instructions).toBe(
    [
      '# Your role',
      '',
      'Writes the newsletter.',
      '',
      '## Lessons the human approved',
      '',
      "These were approved by the human for your behaviour. Follow them when relevant; the human's current instructions still win.",
      '',
      '- Run the tests before saying it works.',
      '- Deploys go through staging first.',
      '',
    ].join('\n'),
  )
  // An Agent without approved lessons gets no file.
  expect(() => readFileSync(join(home, 'agents', 'quiet', 'AGENTS.md'))).toThrow()

  const tables = db.raw
    .query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all()
    .map((row) => row.name)
  expect(tables).not.toContain('agent_reviews')
  expect(tables).not.toContain('agent_lesson_proposals')
  expect(
    db.raw
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('agents')")
      .all()
      .some((row) => row.name.startsWith('review_')),
  ).toBe(false)
  expect(
    db.raw.query<{ kinds_json: string }, []>('SELECT kinds_json FROM notification_settings').get()
      ?.kinds_json,
  ).toBe('["trigger_failure"]')
  expect(
    db.raw
      .query<{ source_kind: string }, []>('SELECT source_kind FROM attention_acknowledgements')
      .all(),
  ).toEqual([{ source_kind: 'trigger_failure' }])

  // Carried again (an upgrade retried after a failure), nothing is added twice.
  keepApprovedLessons(paths, [{ agentId: 'agent', lessons: ['Deploys go through staging first.'] }])
  expect(readFileSync(join(home, 'agents', 'agent', 'AGENTS.md'), 'utf8')).toBe(instructions)
})
