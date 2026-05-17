import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BazilionDb } from './client.ts'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

export function runMigrations(db: BazilionDb): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  const applied = new Set(
    db.raw
      .query<{ version: string }, []>('SELECT version FROM schema_migrations')
      .all()
      .map((r) => r.version),
  )

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    if (applied.has(version)) continue

    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    const tx = db.raw.transaction(() => {
      db.raw.exec(sql)
      db.raw.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        version,
        Date.now(),
      ])
    })
    tx()
  }
}
