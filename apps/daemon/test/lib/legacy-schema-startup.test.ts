import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DAEMON_PID_FILE } from '../../src/lib/daemon-liveness.ts'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
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

let home: string
let oldHome: string | undefined

function writeLegacyDatabase(path: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec('CREATE TABLE groups (id TEXT PRIMARY KEY)')
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
  process.env.BAZILION_HOME = home
  mocks.close.mockClear()
  vi.resetModules()
})

afterEach(() => {
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('bootstrap closes an incompatible database and keeps auth.json', async () => {
  const { INCOMPATIBLE_DATABASE_MESSAGE } = await import('../../src/core/db/schema.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')

  expect(() => getCtx()).toThrow(INCOMPATIBLE_DATABASE_MESSAGE)
  expect(mocks.close).toHaveBeenCalledTimes(1)
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
      // See bootstrap-identity-startup: the cap only exists to stop a hung child, so it must not be
      // tight enough to fire on a loaded machine and misreport a clean exit as SIGKILL.
      const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000)
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
  expect(existsSync(join(home, DAEMON_PID_FILE))).toBe(false)
})
