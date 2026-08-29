import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import * as webTokenRepo from '../../src/core/repos/webTokens.ts'
import { daemonLivenessPath } from '../../src/lib/daemon-liveness.ts'

const mocks = vi.hoisted(() => ({
  startScheduler: vi.fn(),
}))

vi.mock('../../src/lib/scheduler.ts', () => ({ startScheduler: mocks.startScheduler }))

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-bootstrap-identity-'))
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'on'
  mocks.startScheduler.mockClear()
  vi.resetModules()
})

afterEach(async () => {
  try {
    const { closeCtxForShutdown } = await import('../../src/lib/ctx.ts')
    closeCtxForShutdown()
  } catch {
    // A rejected bootstrap never publishes a process-wide DB handle.
  }
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

function createCanonicalDatabase(): ReturnType<typeof openDb> {
  const db = openDb(join(home, 'bazilion.db'))
  runMigrations(db)
  return db
}

test('bootstrap accepts an auth.json token paired with an active bootstrap row', async () => {
  const db = createCanonicalDatabase()
  const created = webTokenRepo.create(db, 'bootstrap', { kind: 'bootstrap' })
  db.close()
  writeFileSync(join(home, 'auth.json'), `${JSON.stringify({ token: created.token })}\n`, {
    mode: 0o600,
  })

  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()

  expect(ctx.authToken).toBe(created.token)
  expect(webTokenRepo.findActiveByToken(ctx.db, created.token)?.kind).toBe('bootstrap')
  expect(mocks.startScheduler).toHaveBeenCalledOnce()
})

test('bootstrap rejects a stale auth.json beside a fresh canonical database without mutation', async () => {
  const db = createCanonicalDatabase()
  const beforeRows = db.raw
    .query<{ id: string; token_hash: string; last_used_at: number | null }, []>(
      'SELECT id, token_hash, last_used_at FROM web_tokens ORDER BY id',
    )
    .all()
  db.close()

  // This is the exact state produced by v0.14.0's old reset tier after the
  // next daemon start: canonical empty DB, but the previous auth.json remains.
  const staleToken = 'bootstrap-token-from-the-deleted-database'
  const authFile = join(home, 'auth.json')
  writeFileSync(authFile, `${JSON.stringify({ token: staleToken })}\n`, { mode: 0o600 })
  const beforeAuth = readFileSync(authFile, 'utf8')

  const { getCtx, INCOMPATIBLE_BOOTSTRAP_IDENTITY_MESSAGE, IncompatibleBootstrapIdentityError } =
    await import('../../src/lib/ctx.ts')

  expect(() => getCtx()).toThrow(IncompatibleBootstrapIdentityError)
  expect(() => getCtx()).toThrow(INCOMPATIBLE_BOOTSTRAP_IDENTITY_MESSAGE)
  expect(INCOMPATIBLE_BOOTSTRAP_IDENTITY_MESSAGE).toContain('bazilion uninstall --yes')
  expect(INCOMPATIBLE_BOOTSTRAP_IDENTITY_MESSAGE).toContain('repository root of a source checkout')
  expect(INCOMPATIBLE_BOOTSTRAP_IDENTITY_MESSAGE).not.toContain(staleToken)
  expect(mocks.startScheduler).not.toHaveBeenCalled()
  expect(readFileSync(authFile, 'utf8')).toBe(beforeAuth)
  expect(existsSync(join(home, 'profiles', 'default'))).toBe(false)

  const after = openDb(join(home, 'bazilion.db'))
  try {
    const afterRows = after.raw
      .query<{ id: string; token_hash: string; last_used_at: number | null }, []>(
        'SELECT id, token_hash, last_used_at FROM web_tokens ORDER BY id',
      )
      .all()
    expect(afterRows).toEqual(beforeRows)
  } finally {
    after.close()
  }
})

test('bootstrap rejects an existing database with no auth.json before opening or mutation', async () => {
  const db = createCanonicalDatabase()
  const created = webTokenRepo.create(db, 'bootstrap', { kind: 'bootstrap' })
  const beforeRows = db.raw
    .query<{ id: string; token_hash: string; last_used_at: number | null }, []>(
      'SELECT id, token_hash, last_used_at FROM web_tokens ORDER BY id',
    )
    .all()
  db.close()

  const { getCtx, IncompatibleBootstrapIdentityError } = await import('../../src/lib/ctx.ts')

  expect(() => getCtx()).toThrow(IncompatibleBootstrapIdentityError)
  expect(mocks.startScheduler).not.toHaveBeenCalled()
  expect(existsSync(join(home, 'auth.json'))).toBe(false)
  expect(existsSync(join(home, 'profiles', 'default'))).toBe(false)

  const after = openDb(join(home, 'bazilion.db'))
  try {
    expect(
      after.raw
        .query<{ id: string; token_hash: string; last_used_at: number | null }, []>(
          'SELECT id, token_hash, last_used_at FROM web_tokens ORDER BY id',
        )
        .all(),
    ).toEqual(beforeRows)
    expect(webTokenRepo.findActiveByToken(after, created.token)?.kind).toBe('bootstrap')
  } finally {
    after.close()
  }
})

test('bootstrap rejects a stale auth.json with no database without creating a replacement', async () => {
  const staleToken = 'bootstrap-token-from-the-deleted-database'
  writeFileSync(join(home, 'auth.json'), `${JSON.stringify({ token: staleToken })}\n`, {
    mode: 0o600,
  })

  const { getCtx, IncompatibleBootstrapIdentityError } = await import('../../src/lib/ctx.ts')

  expect(() => getCtx()).toThrow(IncompatibleBootstrapIdentityError)
  expect(mocks.startScheduler).not.toHaveBeenCalled()
  expect(existsSync(join(home, 'bazilion.db'))).toBe(false)
  expect(existsSync(join(home, 'profiles'))).toBe(false)
})

test('daemon reports a stale bootstrap identity without binding HTTP or leaking the token', async () => {
  const db = createCanonicalDatabase()
  webTokenRepo.create(db, 'bootstrap', { kind: 'bootstrap' })
  db.close()
  const staleToken = 'stale-secret-that-must-not-appear'
  writeFileSync(join(home, 'auth.json'), `${JSON.stringify({ token: staleToken })}\n`, {
    mode: 0o600,
  })

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
  expect(stderr).toContain('auth.json does not match an active bootstrap credential')
  expect(stderr).toContain('bazilion uninstall --yes')
  expect(stderr).not.toContain(staleToken)
  expect(stderr).not.toContain('IncompatibleBootstrapIdentityError')
  expect(stdout).not.toContain('bazilion daemon listening')
  expect(existsSync(daemonLivenessPath(home))).toBe(false)
})
