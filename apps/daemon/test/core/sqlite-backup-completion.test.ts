import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'

test('SQLite backup drains completion when it is the final active child request', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bazilion-backup-completion-'))
  const database = join(directory, 'source.db')
  const snapshot = join(directory, 'snapshot.db')
  const driver = pathToFileURL(join(import.meta.dirname, '../../src/core/db/client.ts')).href
  let confirmed = false
  try {
    // An idle listener keeps the daemon-like loop alive without waking it. No child timer,
    // heartbeat, client traffic or progress callback may hide Node #65666. Allowing the child
    // to exit immediately can drain pending reactions during beforeExit and mask the defect.
    const script = `
      import { writeSync } from 'node:fs'
      import { createServer } from 'node:net'
      import { openDb } from ${JSON.stringify(driver)}
      const server = createServer()
      server.listen(0, '127.0.0.1', () => {
        const db = openDb(${JSON.stringify(database)})
        db.raw.exec('CREATE TABLE evidence (bytes BLOB); INSERT INTO evidence VALUES (zeroblob(1048576))')
        db.backupTo(${JSON.stringify(snapshot)}).then(() => {
          db.close()
          server.close(() => writeSync(1, 'backup-completed\\n'))
        }, () => {
          db.close()
          server.close()
          writeSync(2, 'backup-failed\\n')
          process.exitCode = 1
        })
      })
    `
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script],
      {
        env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory },
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 5_000,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
      },
    )
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('backup-completed\n')
    expect(readFileSync(snapshot).subarray(0, 16).toString()).toBe('SQLite format 3\0')
    confirmed = true
  } finally {
    if (confirmed) rmSync(directory, { recursive: true })
    else console.error(`SQLite backup completion fixture retained at ${directory}`)
  }
})
