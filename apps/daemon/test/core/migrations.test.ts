import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { type BazilionDb, openDb, openInMemoryDb } from '../../src/core/db/client.ts'
import {
  DatabaseUpgradeError,
  IncompatibleDatabaseError,
  initSchema,
  loadMigrations,
  type Migration,
  NewerDatabaseError,
  readHomeSchema,
  type SchemaObject,
  type SchemaPlan,
  shippedSchema,
} from '../../src/core/db/schema.ts'

const shipped = shippedSchema()
const baseline = shipped.migrations[0] as Migration

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-migrations-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

const read = (db: BazilionDb) => (query: string) =>
  db.raw.query<SchemaObject, []>(query).all() as SchemaObject[]
const userVersion = (db: BazilionDb) =>
  db.raw.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version
const columns = (db: BazilionDb, table: string) =>
  db.raw
    .query<{ name: string }, [string]>('SELECT name FROM pragma_table_info(?)')
    .all(table)
    .map((row) => row.name)

function replaceOnce(text: string, from: string, to: string): string {
  expect(text.split(from)).toHaveLength(2)
  return text.replace(from, to)
}

// A release after the baseline, written the way a real one would be: a column added to `config`,
// and `agent_triggers` rebuilt to take a new kind and a column, which SQLite can only do by
// copying the table. Its whole schema is the baseline with the same changes made by hand.
const TRIGGERS_V1 =
  "kind TEXT NOT NULL CHECK (kind IN ('interval','cron')),\n  interval_sec INTEGER,\n  cron_expr TEXT,"
const TRIGGERS_V2 =
  "kind TEXT NOT NULL CHECK (kind IN ('interval','cron','once')),\n  interval_sec INTEGER,\n  cron_expr TEXT,\n  run_at INTEGER,"
const CONFIG_V1 =
  'CREATE TABLE config (\n  key TEXT PRIMARY KEY,\n  value TEXT NOT NULL,\n  updated_at INTEGER NOT NULL\n);'
const CONFIG_V2 =
  'CREATE TABLE config (\n  key TEXT PRIMARY KEY,\n  value TEXT NOT NULL,\n  updated_at INTEGER NOT NULL,\n  note TEXT\n);'
const schemaV2 = replaceOnce(
  replaceOnce(baseline.sql, TRIGGERS_V1, TRIGGERS_V2),
  CONFIG_V1,
  CONFIG_V2,
)
const migrationV2 = `
ALTER TABLE config ADD COLUMN note TEXT;
CREATE TABLE agent_triggers_new (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  ${TRIGGERS_V2}
  message TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired_at INTEGER,
  created_at INTEGER NOT NULL
);
INSERT INTO agent_triggers_new
  (id, agent_id, kind, interval_sec, cron_expr, message, enabled, last_fired_at, created_at)
  SELECT id, agent_id, kind, interval_sec, cron_expr, message, enabled, last_fired_at, created_at
  FROM agent_triggers;
DROP TABLE agent_triggers;
ALTER TABLE agent_triggers_new RENAME TO agent_triggers;
CREATE INDEX agent_triggers_agent ON agent_triggers(agent_id);
CREATE INDEX agent_triggers_enabled ON agent_triggers(enabled) WHERE enabled = 1;
`

function planWith(sql: string, schemaSql = schemaV2): SchemaPlan {
  return { schemaSql, migrations: [baseline, { version: 2, name: '002-test.sql', sql }] }
}

/** A home as 0.26.0 to 0.62.0 left it: the baseline, no schema version, and some rows. */
function writeUnversionedHome(path: string): void {
  const db = openDb(path)
  try {
    db.raw.exec(baseline.sql)
    db.raw.exec(`
      INSERT INTO teams (id, name, created_at) VALUES ('team', 'Team', 1);
      INSERT INTO profiles (id, name, default_model, created_at, updated_at)
        VALUES ('profile', 'Profile', 'lmstudio:test', 1, 1);
      INSERT INTO agents (id, profile_id, name, status, team_id, created_at)
        VALUES ('agent', 'profile', 'Agent', 'idle', 'team', 1);
      INSERT INTO agent_conversations (id, agent_id, title, created_at, updated_at)
        VALUES ('conversation', 'agent', 'Kept', 1, 1);
      INSERT INTO agent_triggers (id, agent_id, kind, cron_expr, message, created_at)
        VALUES ('trigger', 'agent', 'cron', '0 9 * * *', 'Morning summary', 1);
      INSERT INTO trigger_dispatches (id, trigger_id, agent_id, conversation_id, scheduled_at, status)
        VALUES ('dispatch', 'trigger', 'agent', 'conversation', 2, 'succeeded');
      INSERT INTO config (key, value, updated_at) VALUES ('kept', 'yes', 1);
    `)
  } finally {
    db.close()
  }
}

test('the migrations, applied in order to an empty database, give exactly schema.sql', () => {
  const db = openInMemoryDb('')
  try {
    for (const migration of shipped.migrations) db.raw.exec(migration.sql)
    expect(readHomeSchema(read(db), shipped.migrations.length)).toEqual({
      kind: 'known',
      version: shipped.migrations.length,
      stamped: true,
    })
  } finally {
    db.close()
  }
})

test('a fresh home gets the whole schema and the latest version', () => {
  const db = openDb(join(home, 'bazilion.db'))
  try {
    expect(initSchema(db)).toEqual({ kind: 'created', version: shipped.migrations.length })
    expect(userVersion(db)).toBe(shipped.migrations.length)
    expect(initSchema(db)).toEqual({ kind: 'current', version: shipped.migrations.length })
  } finally {
    db.close()
  }
})

test('a home from before schema versions is version 1, and this release stamps it', () => {
  const path = join(home, 'bazilion.db')
  writeUnversionedHome(path)
  const db = openDb(path)
  try {
    expect(userVersion(db)).toBe(0)
    const outcome = initSchema(db, { copyDir: join(home, 'upgrades') })
    expect(outcome.kind).toBe(shipped.migrations.length === 1 ? 'current' : 'upgraded')
    expect(userVersion(db)).toBe(shipped.migrations.length)
    expect(
      db.raw.query<{ value: string }, []>("SELECT value FROM config WHERE key = 'kept'").get(),
    ).toEqual({ value: 'yes' })
  } finally {
    db.close()
  }
})

test("the shipped migrations keep a home's schedules and their runs, set by the owner", () => {
  const path = join(home, 'bazilion.db')
  writeUnversionedHome(path)
  const db = openDb(path)
  try {
    initSchema(db, { copyDir: join(home, 'upgrades') })
    expect(
      db.raw
        .query<Record<string, unknown>, []>(
          'SELECT id, kind, cron_expr, run_at, message, conversation_id, set_by FROM agent_triggers',
        )
        .all(),
    ).toEqual([
      {
        id: 'trigger',
        kind: 'cron',
        cron_expr: '0 9 * * *',
        run_at: null,
        message: 'Morning summary',
        conversation_id: null,
        set_by: 'owner',
      },
    ])
    expect(db.raw.query<{ id: string }, []>('SELECT id FROM trigger_dispatches').all()).toEqual([
      { id: 'dispatch' },
    ])
  } finally {
    db.close()
  }
})

test("the shipped migrations keep the list's order: the Default Team first, then by creation", () => {
  const path = join(home, 'bazilion.db')
  writeUnversionedHome(path)
  const seed = openDb(path)
  seed.raw.exec(`
    INSERT INTO teams (id, name, created_at) VALUES ('default', 'Default', 5);
    INSERT INTO teams (id, name, created_at) VALUES ('ops', 'Ops', 3);
    INSERT INTO agents (id, profile_id, name, status, team_id, created_at)
      VALUES ('second', 'profile', 'Second', 'idle', 'team', 7);
    INSERT INTO agents (id, profile_id, name, status, team_id, created_at)
      VALUES ('first', 'profile', 'First', 'idle', 'team', 0);
    INSERT INTO agents (id, profile_id, name, status, team_id, created_at)
      VALUES ('elsewhere', 'profile', 'Elsewhere', 'idle', 'ops', 9);
  `)
  seed.close()
  const db = openDb(path)
  try {
    initSchema(db, { copyDir: join(home, 'upgrades') })
    expect(
      db.raw
        .query<{ id: string; position: number }, []>(
          'SELECT id, position FROM teams ORDER BY position',
        )
        .all(),
    ).toEqual([
      { id: 'default', position: 0 },
      { id: 'team', position: 1 },
      { id: 'ops', position: 2 },
    ])
    expect(
      db.raw
        .query<{ id: string; position: number }, []>(
          'SELECT id, position FROM agents ORDER BY team_id, position',
        )
        .all(),
    ).toEqual([
      { id: 'elsewhere', position: 0 },
      { id: 'first', position: 0 },
      { id: 'agent', position: 1 },
      { id: 'second', position: 2 },
    ])
  } finally {
    db.close()
  }
})

test('an upgrade keeps every row, copies the database first and stamps the new version', () => {
  const path = join(home, 'bazilion.db')
  writeUnversionedHome(path)
  const db = openDb(path)
  try {
    const outcome = initSchema(db, { copyDir: join(home, 'upgrades'), plan: planWith(migrationV2) })
    expect(outcome).toMatchObject({ kind: 'upgraded', from: 1, to: 2 })
    expect(userVersion(db)).toBe(2)
    expect(columns(db, 'config')).toContain('note')
    expect(columns(db, 'agent_triggers')).toContain('run_at')
    expect(
      db.raw.query<{ message: string }, []>('SELECT message FROM agent_triggers').all(),
    ).toEqual([{ message: 'Morning summary' }])
    // The rebuilt table still holds the rows that point at it, and takes the new kind.
    expect(db.raw.query<{ id: string }, []>('SELECT id FROM trigger_dispatches').all()).toEqual([
      { id: 'dispatch' },
    ])
    db.raw.exec(
      "INSERT INTO agent_triggers (id, agent_id, kind, run_at, message, created_at) VALUES ('once', 'agent', 'once', 5, 'Reminder', 3)",
    )
    // Foreign keys are on again after the upgrade.
    expect(() =>
      db.raw.exec(
        "INSERT INTO agent_triggers (id, agent_id, kind, message, created_at) VALUES ('x', 'missing', 'cron', 'x', 1)",
      ),
    ).toThrow(/FOREIGN KEY/)
    // The next start finds the home current.
    expect(initSchema(db, { plan: planWith(migrationV2) })).toEqual({ kind: 'current', version: 2 })

    if (outcome.kind !== 'upgraded' || !outcome.copy) throw new Error('no copy was made')
    expect(readdirSync(join(home, 'upgrades'))).toHaveLength(1)
    expect(statSync(outcome.copy).mode & 0o777).toBe(0o600)
    const copy = openDb(outcome.copy)
    try {
      expect(readHomeSchema(read(copy), userVersion(copy) ?? -1, planWith(migrationV2))).toEqual({
        kind: 'known',
        version: 1,
        stamped: false,
      })
      expect(columns(copy, 'config')).not.toContain('note')
    } finally {
      copy.close()
    }
  } finally {
    db.close()
  }
})

test.each([
  [
    'a statement that fails',
    `${migrationV2}\nINSERT INTO no_such_table VALUES (1);`,
    /002-test\.sql/,
  ],
  ['a result that is not schema.sql', 'ALTER TABLE config ADD COLUMN other TEXT;', /differs/],
  ['rows left pointing at missing rows', `${migrationV2}\nDELETE FROM agents;`, /point at rows/],
  [
    'a conflict that makes SQLite roll back by itself',
    `${migrationV2}\nINSERT OR ROLLBACK INTO teams (id, name, created_at) VALUES ('team', 'x', 1);`,
    /UNIQUE constraint failed/,
  ],
])('an upgrade with %s leaves the home as it was', (_name, sql, message) => {
  const path = join(home, 'bazilion.db')
  writeUnversionedHome(path)
  const db = openDb(path)
  try {
    const before = read(db)('SELECT type, name, sql FROM sqlite_schema ORDER BY name')
    const upgrade = () => initSchema(db, { copyDir: join(home, 'upgrades'), plan: planWith(sql) })
    expect(upgrade).toThrow(DatabaseUpgradeError)
    expect(upgrade).toThrow(message)
    expect(upgrade).toThrow(/left it unchanged/)
    expect(upgrade).not.toThrow(/no transaction is active/)
    // The copy of an unchanged home is dropped, so retries (a service restarting the daemon) do
    // not fill the disk.
    expect(readdirSync(join(home, 'upgrades'))).toEqual([])
    expect(userVersion(db)).toBe(0)
    expect(read(db)('SELECT type, name, sql FROM sqlite_schema ORDER BY name')).toEqual(before)
    expect(db.raw.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM agents').get()).toEqual({
      n: 1,
    })
    expect(db.raw.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    })
  } finally {
    db.close()
  }
})

test('a migration that ends the transaction itself is reported as possibly kept', () => {
  const path = join(home, 'bazilion.db')
  writeUnversionedHome(path)
  const db = openDb(path)
  try {
    // A bare END is allowed in a file (a trigger ends with one), so only running it shows this.
    const plan = planWith('ALTER TABLE config ADD COLUMN note TEXT;\nEND;')
    const upgrade = () => initSchema(db, { copyDir: join(home, 'upgrades'), plan })
    expect(upgrade).toThrow(/part of the upgrade may have been kept/)
    const copies = readdirSync(join(home, 'upgrades'))
    expect(copies).toHaveLength(1)
    // The next start points at the copy before it mentions a reset.
    expect(upgrade).toThrow(IncompatibleDatabaseError)
    expect(upgrade).toThrow(`(the latest: ${join(home, 'upgrades', copies[0] ?? '')})`)
  } finally {
    db.close()
  }
})

test('a check that fails before an upgrade leaves nothing written', () => {
  const path = join(home, 'bazilion.db')
  writeUnversionedHome(path)
  const db = openDb(path)
  try {
    const refuse = () => {
      throw new Error('auth.json does not belong to this database')
    }
    expect(() =>
      initSchema(db, {
        copyDir: join(home, 'upgrades'),
        plan: planWith(migrationV2),
        beforeUpgrade: refuse,
      }),
    ).toThrow(/auth\.json/)
    expect(existsSync(join(home, 'upgrades'))).toBe(false)
    expect(userVersion(db)).toBe(0)
    expect(columns(db, 'config')).not.toContain('note')
  } finally {
    db.close()
  }
})

test('a home a newer release upgraded is refused untouched, without reset advice', () => {
  const db = openDb(join(home, 'bazilion.db'))
  try {
    initSchema(db)
    db.raw.exec(`PRAGMA user_version = ${shipped.migrations.length + 1}`)
    expect(() => initSchema(db)).toThrow(NewerDatabaseError)
    expect(() => initSchema(db)).toThrow(/a newer release has upgraded/)
    expect(() => initSchema(db)).not.toThrow(/uninstall/)
    expect(userVersion(db)).toBe(shipped.migrations.length + 1)
  } finally {
    db.close()
  }
})

test('a home whose schema is not the one its version names is refused', () => {
  const path = join(home, 'bazilion.db')
  writeUnversionedHome(path)
  const db = openDb(path)
  try {
    db.raw.exec('PRAGMA user_version = 1')
    db.raw.exec('ALTER TABLE teams ADD COLUMN smuggled TEXT')
    expect(() => initSchema(db, { plan: planWith(migrationV2) })).toThrow(IncompatibleDatabaseError)
    expect(columns(db, 'config')).not.toContain('note')
  } finally {
    db.close()
  }
})

test('migrations must be numbered from 001 without gaps', () => {
  const dir = join(home, 'migrations')
  mkdirSync(dir)
  const url = pathToFileURL(`${dir}/`)
  expect(() => loadMigrations(url)).toThrow(/not even the baseline/)
  writeFileSync(join(dir, '001-baseline.sql'), 'CREATE TABLE a (id TEXT);')
  writeFileSync(join(dir, '003-skipped.sql'), 'CREATE TABLE b (id TEXT);')
  expect(() => loadMigrations(url)).toThrow(/found 003-skipped\.sql/)
  rmSync(join(dir, '003-skipped.sql'))
  writeFileSync(join(dir, '002 Bad Name.sql'), 'CREATE TABLE b (id TEXT);')
  expect(() => loadMigrations(url)).toThrow(/found 002 Bad Name\.sql/)
  rmSync(join(dir, '002 Bad Name.sql'))
  writeFileSync(join(dir, '002-added.sql'), 'CREATE TABLE b (id TEXT);')
  expect(loadMigrations(url).map((migration) => migration.version)).toEqual([1, 2])
})

test.each([
  ['BEGIN', 'BEGIN;\nCREATE TABLE b (id TEXT);\nCOMMIT;'],
  ['COMMIT', 'CREATE TABLE b (id TEXT);\ncommit;'],
  ['PRAGMA FOREIGN_KEYS', 'PRAGMA foreign_keys = OFF;\nCREATE TABLE b (id TEXT);'],
  ['PRAGMA USER_VERSION', 'CREATE TABLE b (id TEXT); PRAGMA user_version = 9;'],
  ['VACUUM', 'CREATE TABLE b (id TEXT);\n  VACUUM;'],
])('a migration may not contain %s: the upgrade owns them', (word, sql) => {
  const dir = join(home, 'migrations')
  mkdirSync(dir)
  writeFileSync(join(dir, '001-baseline.sql'), 'CREATE TABLE a (id TEXT);')
  writeFileSync(join(dir, '002-bad.sql'), sql)
  expect(() => loadMigrations(pathToFileURL(`${dir}/`))).toThrow(
    `002-bad.sql must not contain ${word}`,
  )
})

test('a trigger, with its own BEGIN and END, is allowed in a migration', () => {
  const dir = join(home, 'migrations')
  mkdirSync(dir)
  writeFileSync(join(dir, '001-baseline.sql'), 'CREATE TABLE a (id TEXT);')
  writeFileSync(
    join(dir, '002-trigger.sql'),
    '-- BEGIN in a comment is fine too\nCREATE TRIGGER t AFTER INSERT ON a BEGIN\n  DELETE FROM a;\nEND;',
  )
  expect(loadMigrations(pathToFileURL(`${dir}/`))).toHaveLength(2)
})

// A shipped migration must never change: homes already upgraded by it would no longer match.
// Add each migration here once a release has shipped it.
const SHIPPED_MIGRATIONS: Record<string, string> = {
  // The schema of 0.26.0 to 0.62.0 (`git show bazilion@0.62.0:apps/daemon/src/core/db/schema.sql`),
  // with a header comment of its own.
  '001-baseline.sql': '1f424c75254ed4e4cfc51a9eb34b6cfef13025f01726681b6b12983c44e0d015',
  // 0.63.0: the remembered command rules.
  '002-command-rules.sql': '29a3e16e5c0b4a047e92a9f65951cf1318f2aad548d2cecee16ffbfe53d4e5ef',
  // 0.64.0: one-time schedules, the conversation a schedule runs in, who set it.
  '003-agent-schedules.sql': '3893ecdd4cf151621a28d488e6bb08417c64beec454d368a04d9ef227133fe0f',
}

test('migrations that releases shipped are unchanged', () => {
  for (const [name, sha256] of Object.entries(SHIPPED_MIGRATIONS)) {
    const migration = shipped.migrations.find((candidate) => candidate.name === name)
    expect(migration, name).toBeDefined()
    expect(
      createHash('sha256')
        .update(migration?.sql ?? '')
        .digest('hex'),
      name,
    ).toBe(sha256)
  }
})
