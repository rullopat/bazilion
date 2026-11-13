import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openDb } from '../../src/core/db/client.ts'
import { initSchema } from '../../src/core/db/schema.ts'
import { createProfile, registerTeam, resolvePaths, spawnAgent } from '../../src/core/index.ts'
import * as triggerDispatchRepo from '../../src/core/repos/triggerDispatches.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import * as webTokenRepo from '../../src/core/repos/webTokens.ts'
import { DAEMON_PID_FILE } from '../../src/lib/daemon-liveness.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let home: string
let oldHome: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-bootstrap-identity-'))
  oldHome = process.env.BAZILION_HOME
  process.env.BAZILION_HOME = home
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
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

function createCanonicalDatabase(): ReturnType<typeof openDb> {
  const db = openDb(join(home, 'bazilion.db'))
  initSchema(db)
  return db
}

test('a fresh home is owner-only: the home, the database and auth.json', async () => {
  rmSync(home, { recursive: true, force: true })
  const { getCtx } = await import('../../src/lib/ctx.ts')
  getCtx()
  expect(statSync(home).mode & 0o777).toBe(0o700)
  for (const name of ['bazilion.db', 'auth.json']) {
    expect(statSync(join(home, name)).mode & 0o777).toBe(0o600)
  }
})

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
})

test('bootstrap marks a trigger run cut short by a daemon stop as failed', async () => {
  const db = createCanonicalDatabase()
  const created = webTokenRepo.create(db, 'bootstrap', { kind: 'bootstrap' })
  const paths = resolvePaths(home)
  registerTeam(db, { id: 'default', name: 'Default' }, paths)
  createProfile(db, paths, { id: 'p', defaultModel: 'lmstudio:x' })
  const agent = spawnAgent(db, paths, { profileId: 'p', teamId: 'default' })
  const trigger = triggerRepo.insert(db, {
    agentId: agent.id,
    kind: 'interval',
    intervalSec: 60,
    cronExpr: null,
    message: 'work',
  })
  const dispatch = triggerDispatchRepo.materialize(db, {
    triggerId: trigger.id,
    agentId: agent.id,
    conversationId: seedRegisteredConversation(db, paths, agent.id).id,
    scheduledAt: 1,
  })
  triggerDispatchRepo.start(db, dispatch.id)
  db.close()
  writeFileSync(join(home, 'auth.json'), `${JSON.stringify({ token: created.token })}\n`, {
    mode: 0o600,
  })

  const { getCtx } = await import('../../src/lib/ctx.ts')
  expect(triggerDispatchRepo.get(getCtx().db, dispatch.id)).toMatchObject({
    status: 'failed',
    error: triggerDispatchRepo.INTERRUPTED,
  })
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
      // Generous on purpose. The assertion is that the child exits with code 1 instead of binding
      // HTTP; a loaded machine (concurrent suites, three tsx boots) can take well over 5s to boot and
      // exit, and killing it early turns a correct exit into a spurious SIGKILL mismatch.
      const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000)
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
  expect(existsSync(join(home, DAEMON_PID_FILE))).toBe(false)
})

test('a daemon behind BAZILION_PUBLIC_ORIGIN refuses a non-loopback HOST before touching the home', async () => {
  const daemonEntry = join(import.meta.dirname, '..', '..', 'src', 'index.ts')
  const child = spawn(process.execPath, ['--import', 'tsx/esm', daemonEntry], {
    env: {
      ...process.env,
      BAZILION_HOME: home,
      BAZILION_PUBLIC_ORIGIN: 'https://bazilion.example.ts.net',
      HOST: '0.0.0.0',
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000)
      child.once('error', reject)
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        resolve({ code, signal })
      })
    },
  )

  expect(result).toEqual({ code: 1, signal: null })
  expect(stderr).toContain('requires the daemon to bind loopback only')
  expect(existsSync(join(home, DAEMON_PID_FILE))).toBe(false)
  expect(existsSync(join(home, 'bazilion.db'))).toBe(false)
}, 40_000)
