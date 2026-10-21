#!/usr/bin/env node
// Genuine prior-release compatibility fixtures, not a product recovery mechanism.
// The 0.23 clean-install contract refuses the eight default prior schemas.
// Importing this module is inert; controlled harness tests do not run the matrix.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

export const DEFAULT_MATRIX = [
  { tag: 'v0.22.0', expect: 'refuse' },
  { tag: 'v0.21.0-beta.5', expect: 'refuse' },
  { tag: 'v0.21.0-beta.4', expect: 'refuse' },
  { tag: 'v0.21.0-beta.3', expect: 'refuse' },
  { tag: 'v0.21.0-beta.2', expect: 'refuse' },
  { tag: 'v0.21.0-beta.1', expect: 'refuse' },
  { tag: 'v0.20.0', expect: 'refuse' },
  { tag: 'v0.19.0', expect: 'refuse' },
]

export class CleanupUnconfirmedError extends Error {}
export class DaemonStartError extends Error {
  constructor(reason, outcome) {
    super(`daemon startup ${reason}: ${outcome.stderr}`)
    this.outcome = outcome
    this.reason = reason
  }
}

export function fixtureEnv(base, path = process.env.PATH ?? '') {
  const home = join(base, 'runtime-home')
  const temporary = join(base, 'tmp')
  const cache = join(base, 'cache')
  for (const dir of [home, temporary, cache]) mkdirSync(dir, { recursive: true })
  return {
    PATH: `${dirname(process.execPath)}:${path}`,
    HOME: home,
    TMPDIR: temporary,
    XDG_CACHE_HOME: cache,
    PNPM_HOME: join(base, 'pnpm'),
    COREPACK_HOME: join(base, 'corepack'),
    npm_config_userconfig: '/dev/null',
    npm_config_globalconfig: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    BAZILION_SCHEDULER: 'off',
    BROWSER_ENABLED: 'false',
    BAZILION_IMAGE_GENERATION: 'off',
    PI_OFFLINE: '1',
    DO_NOT_TRACK: '1',
  }
}

function within(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

// Close listeners are installed at creation. Only this owned child handle is
// signalled, never a guessed PID/group. Close is leader/pipe evidence, not a
// general descendant-containment guarantee: use an outer disposable namespace.
export function ownedChild(command, args, options, { termMs = 3000, killMs = 2000 } = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  let result
  let spawnError
  let forced = false
  let overflow = false
  let stdout = ''
  let stderr = ''
  const limit = 2 * 1024 * 1024
  let bytes = 0
  const capture = (stream, sink) => {
    stream.setEncoding('utf8')
    stream.on('data', (text) => {
      const remaining = Math.max(0, limit - bytes)
      const buffer = Buffer.from(text)
      sink(buffer.subarray(0, remaining).toString('utf8'))
      bytes += buffer.length
      if (bytes > limit) overflow = true
    })
  }
  capture(child.stdout, (text) => {
    stdout += text
  })
  capture(child.stderr, (text) => {
    stderr += text
  })
  child.once('error', (error) => {
    spawnError = error.message
  })
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      result = { code, signal, spawnError, forced, overflow, stdout, stderr }
      resolve(result)
    })
  })
  let stopping
  const stop = () => {
    stopping ??= (async () => {
      if (result) return result
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      const normal = await within(closed, termMs)
      if (normal) return normal
      if (child.exitCode === null && child.signalCode === null) {
        forced = true
        child.kill('SIGKILL')
      }
      const killed = await within(closed, killMs)
      if (killed) return killed
      throw new CleanupUnconfirmedError('owned child/pipe closure is unconfirmed; retain fixture')
    })()
    return stopping
  }
  return { child, closed, stop, outcome: () => result, overflow: () => overflow }
}

export async function runOwned(command, args, options) {
  const owned = ownedChild(command, args, options)
  const result = await within(owned.closed, 10 * 60_000)
  if (!result || owned.overflow()) {
    await owned.stop()
    throw new Error(`${command} exceeded its fixture time/output bound`)
  }
  if (result.code !== 0 || result.signal || result.spawnError || result.overflow) {
    throw new Error(`${command} failed (${result.code}/${result.signal}): ${result.stderr}`)
  }
  return result
}

export async function healthy(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500), redirect: 'error' })
    if (response.status !== 200) {
      await response.body?.cancel()
      return false
    }
    const reader = response.body?.getReader()
    if (!reader) return false
    const chunks = []
    let bytes = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.byteLength
        if (bytes > 4096) return false
        chunks.push(Buffer.from(part.value))
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')).ok === true
  } catch {
    return false
  }
}

export async function awaitDaemon(owned, url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ended = owned.outcome()
    if (ended) throw new DaemonStartError('closed', ended)
    const ready = await Promise.race([healthy(url), owned.closed.then(() => false)])
    if (owned.outcome()) throw new DaemonStartError('closed', owned.outcome())
    if (ready && !owned.overflow()) return owned
    if (owned.overflow()) {
      const outcome = await owned.stop()
      throw new DaemonStartError('output overflow', outcome)
    }
    await within(owned.closed, 50)
  }
  const outcome = await owned.stop()
  throw new DaemonStartError('timed out', outcome)
}

export function cleanRefusal(error) {
  if (!(error instanceof DaemonStartError) || error.reason !== 'closed') return false
  const o = error.outcome
  return (
    o.code === 1 &&
    o.signal === null &&
    !o.spawnError &&
    !o.forced &&
    !o.overflow &&
    /Bazilion cannot start because this home (?:uses an incompatible database schema|was written by a newer version)/.test(
      o.stderr,
    )
  )
}

// Bounded paths/digests only. Never follow a fixture symlink or omit a refused
// entry. Capture the state container, including sibling ownership records.
export function stateManifest(root) {
  const entries = []
  let bytes = 0
  const visit = (relative) => {
    const path = join(root, relative)
    const s = lstatSync(path)
    if (entries.length >= 4096) throw new Error('fixture manifest path bound exceeded')
    const row = { path: relative, mode: s.mode & 0o777 }
    if (s.isSymbolicLink()) row.link = readlinkSync(path)
    else if (s.isDirectory()) row.directory = true
    else if (s.isFile()) {
      bytes += s.size
      if (bytes > 64 * 1024 * 1024) throw new Error('fixture manifest byte bound exceeded')
      row.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    } else throw new Error('unsupported fixture state entry')
    entries.push(row)
    if (s.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(relative, name))
  }
  visit('')
  return entries
}

export async function cleanupFixture(
  base,
  children,
  remove = (path) => rmSync(path, { recursive: true }),
) {
  // A rejected stop never falls through into removal. Still retire other
  // known children, retain the fixture, and never acknowledge unknown cleanup.
  const results = await Promise.allSettled(children.map((child) => child.stop()))
  if (results.some((result) => result.status === 'rejected')) {
    throw new CleanupUnconfirmedError('fixture cleanup unconfirmed; state retained')
  }
  remove(base)
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}

function withDb(home, fn, readOnly = true) {
  const db = new DatabaseSync(join(home, 'bazilion.db'), { readOnly })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

export function readFixtureLedger(home) {
  return withDb(home, (db) =>
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),
  )
}

async function entry(repo, { tag, expect }) {
  if (
    !/^v\d+\.\d+\.\d+(?:-(?:beta|alpha|rc)\.\d+)?$/.test(tag) ||
    !['upgrade', 'refuse'].includes(expect)
  ) {
    throw new Error('invalid fixture matrix entry')
  }
  const base = mkdtempSync(join(tmpdir(), 'bazilion-matrix-'))
  const source = join(base, 'source')
  const state = join(base, 'state')
  const home = join(state, 'home')
  mkdirSync(source)
  mkdirSync(state)
  const env = fixtureEnv(base)
  const children = []
  let retain = false
  let failure
  const boot = async (cwd) => {
    const port = await freePort()
    const owned = ownedChild(
      process.execPath,
      ['--import', 'tsx/esm', 'apps/daemon/src/index.ts'],
      {
        cwd,
        env: { ...env, BAZILION_HOME: home, HOST: '127.0.0.1', PORT: String(port) },
      },
    )
    children.push(owned)
    return awaitDaemon(owned, `http://127.0.0.1:${port}/api/health`)
  }
  try {
    // A tag archive contains genuine tracked release sources but no shared
    // worktree/Git credential config, hooks or global prune operation.
    const archive = join(base, 'source.tar')
    await runOwned(
      'git',
      ['-c', 'core.hooksPath=/dev/null', 'archive', '--format=tar', `--output=${archive}`, tag],
      { cwd: repo, env },
    )
    await runOwned('tar', ['-xf', archive, '-C', source], { env })
    await runOwned('pnpm', ['install', '--frozen-lockfile'], { cwd: source, env })
    const seeded = await boot(source)
    const seedClose = await seeded.stop()
    if (seedClose.forced || seedClose.signal || seedClose.code !== 0)
      throw new Error('seed daemon did not settle cleanly')
    withDb(
      home,
      (db) =>
        db
          .prepare("INSERT INTO teams (id, name, user_md, created_at) VALUES (?, ?, '', ?)")
          .run('matrix-sentinel', `planted-by-${tag}`, Date.now()),
      false,
    )
    const beforeLedger = readFixtureLedger(home)
    const beforeState = stateManifest(state)
    const stopCleanly = async (daemon) => {
      const outcome = await daemon.stop()
      if (outcome.code !== 0 || outcome.signal || outcome.forced || outcome.overflow) {
        throw new Error('current daemon did not settle cleanly')
      }
    }
    if (expect === 'refuse') {
      let refusal
      try {
        const started = await boot(repo)
        await started.stop()
      } catch (error) {
        refusal = error
      }
      if (!cleanRefusal(refusal)) throw refusal ?? new Error('incompatible home became healthy')
      const afterLedger = readFixtureLedger(home)
      const afterState = stateManifest(state)
      if (
        JSON.stringify(afterLedger) !== JSON.stringify(beforeLedger) ||
        JSON.stringify(afterState) !== JSON.stringify(beforeState)
      ) {
        throw new Error('refused fixture state/identity pair changed')
      }
      console.log(`${tag}: observed exit 1, schema refusal; state paths/digests unchanged`)
      console.log(
        JSON.stringify({
          kind: 'prior-home-refusal',
          tag,
          seedExit: { code: seedClose.code, signal: seedClose.signal, forced: seedClose.forced },
          refusalExit: {
            code: refusal.outcome.code,
            signal: refusal.outcome.signal,
            forced: refusal.outcome.forced,
            overflow: refusal.outcome.overflow,
          },
          beforeLedger,
          afterLedger,
          beforeState,
          afterState,
        }),
      )
      console.log(refusal.outcome.stderr.trim())
    } else {
      const current = await boot(repo)
      await stopCleanly(current)
      const name = withDb(
        home,
        (db) => db.prepare('SELECT name FROM teams WHERE id = ?').get('matrix-sentinel')?.name,
      )
      if (name !== `planted-by-${tag}`) throw new Error('upgrade lost fixture sentinel')
      const chainLength = (cwd) =>
        readdirSync(join(cwd, 'apps/daemon/src/core/db/migrations')).filter((name) =>
          name.endsWith('.sql'),
        ).length
      const grew = chainLength(source) < chainLength(repo)
      const snapshots = readdirSync(home).filter((name) =>
        name.startsWith('bazilion.pre-migration-'),
      )
      if ((grew && snapshots.length === 0) || (!grew && snapshots.length !== 0)) {
        throw new Error('upgrade snapshot evidence disagrees with migration chain growth')
      }
      const second = await boot(repo)
      await stopCleanly(second)
      console.log(`${tag}: sentinel retained and second boot healthy`)
    }
  } catch (error) {
    failure = error
    if (error instanceof CleanupUnconfirmedError) retain = true
  }
  if (retain) console.error(`fixture retained for uncertain cleanup: ${base}`)
  else {
    try {
      await cleanupFixture(base, children)
    } catch (error) {
      console.error(`fixture retained for uncertain cleanup: ${base}`)
      failure = failure
        ? new AggregateError(
            [failure, error],
            'execution failed and fixture cleanup is unconfirmed',
          )
        : error
    }
  }
  if (failure) throw failure
}

export async function main() {
  const matrix = process.env.BAZILION_UPGRADE_MATRIX
    ? JSON.parse(process.env.BAZILION_UPGRADE_MATRIX)
    : DEFAULT_MATRIX
  if (!Array.isArray(matrix) || matrix.length === 0 || matrix.length > 32)
    throw new Error('invalid fixture matrix')
  // This script runs prior-release code/install hooks. Execute only in a
  // disposable host/namespace with an explicitly approved install/network path.
  for (const item of matrix) await entry(process.cwd(), item)
  console.log('compatibility matrix: all selected entries passed')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
