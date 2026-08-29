import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { daemonLivenessPath } from '../../src/lib/daemon-liveness.ts'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  startScheduler: vi.fn(),
}))

vi.mock('../../src/core/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/index.ts')>()
  return {
    ...actual,
    openDb(path: string) {
      const db = actual.openDb(path)
      return {
        ...db,
        close() {
          mocks.close()
          db.close()
        },
      }
    },
  }
})

vi.mock('../../src/lib/scheduler.ts', () => ({ startScheduler: mocks.startScheduler }))

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

function writeLegacyDatabase(path: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec(`
      CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_migrations (version, applied_at)
      VALUES ('0001_init', 1), ('0002_profile_groups', 2);
      CREATE TABLE groups (id TEXT PRIMARY KEY);
    `)
  } finally {
    db.close()
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-legacy-startup-'))
  writeLegacyDatabase(join(home, 'bazilion.db'))
  // Keep the identity pair present so this fixture reaches the independent
  // schema-compatibility check before bootstrap-token validation.
  writeFileSync(join(home, 'auth.json'), '{"token":"legacy-bootstrap-placeholder"}\n')
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'on'
  mocks.close.mockClear()
  mocks.startScheduler.mockClear()
  vi.resetModules()
})

afterEach(() => {
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('bootstrap closes an incompatible database before the scheduler starts', async () => {
  const { INCOMPATIBLE_DATABASE_MESSAGE } = await import('../../src/core/db/migrate.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')

  expect(() => getCtx()).toThrow(INCOMPATIBLE_DATABASE_MESSAGE)
  expect(mocks.close).toHaveBeenCalledTimes(1)
  expect(mocks.startScheduler).not.toHaveBeenCalled()
  expect(existsSync(join(home, 'auth.json'))).toBe(true)
})

test('daemon entry reports the recovery action and exits before binding HTTP', async () => {
  const daemonEntry = join(import.meta.dirname, '..', '..', 'src', 'index.ts')
  const child = spawn(process.execPath, ['--import', 'tsx/esm', daemonEntry], {
    env: {
      ...process.env,
      BAZILION_HOME: home,
      BAZILION_SCHEDULER: 'on',
      HOST: '127.0.0.1',
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000)
      child.once('error', reject)
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        resolve({ code, signal })
      })
    },
  )

  expect(result).toEqual({ code: 1, signal: null })
  expect(stderr).toContain('bazilion daemon failed to start:')
  expect(stderr).toContain('entire Bazilion home directory')
  expect(stderr).toContain('bazilion uninstall --yes')
  expect(stderr).not.toContain(home)
  expect(stderr).not.toContain('ERR_SQLITE_ERROR')
  expect(stderr).not.toContain('[scheduler]')
  expect(stdout).not.toContain('bazilion daemon listening')
  expect(existsSync(daemonLivenessPath(home))).toBe(false)
})
