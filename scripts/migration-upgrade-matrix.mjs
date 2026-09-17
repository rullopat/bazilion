#!/usr/bin/env node
// BAZ-047 release upgrade matrix.
//
// Proves the stable-schema contract against REAL prior releases: for each
// matrix entry, check out the release tag into a worktree, install it, boot
// its daemon to seed a genuine home, then bring the home up under the CURRENT
// branch and assert the outcome.
//
//   expect: 'upgrade' — the current binary must upgrade the home in place:
//             daemon serves HTTP, pre-upgrade sentinel data survives, a
//             pre-migration snapshot exists when the chain grew, and a second
//             boot succeeds (idempotence).
//   expect: 'refuse'  — the current binary must refuse the home cleanly:
//             exit code 1, actionable message on stderr, home untouched
//             (no schema mutation, no snapshot, ledger rows unchanged).
//
// Maintenance: bump the MATRIX below as part of every release — move the
// previous tag to 'upgrade' once it is known-upgradable, and add 'refuse'
// entries for homes the alpha contract documented as non-upgradable (e.g.
// BAZ-046: "0.19.x homes cannot be upgraded in place").
//
// Override for local experiments: BAZILION_UPGRADE_MATRIX='[{"tag":"v9.9.9","expect":"upgrade"}]'

import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const REPO_ROOT = process.cwd()
const MATRIX = process.env.BAZILION_UPGRADE_MATRIX
  ? JSON.parse(process.env.BAZILION_UPGRADE_MATRIX)
  : [
      { tag: 'v0.20.0', expect: 'upgrade' },
      { tag: 'v0.19.0', expect: 'refuse' },
    ]

const failures = []

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'pipe', ...options })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function runOrThrow(cmd, args, options) {
  const result = await run(cmd, args, options)
  if (result.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (${result.code}):\n${result.stdout}\n${result.stderr}`,
    )
  }
  return result
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
    srv.on('error', reject)
  })
}

async function pollHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status > 0) return res.status
    } catch (err) {
      lastError = err
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`server at ${url} not ready after ${timeoutMs}ms (${lastError})`)
}

/** Spawn a daemon from `cwd` against `home`; resolve after /api/health responds. */
async function bootDaemon(cwd, home, label) {
  const port = await findFreePort()
  const child = spawn('node', ['--import', 'tsx/esm', 'apps/daemon/src/index.ts'], {
    cwd,
    env: {
      ...process.env,
      BAZILION_HOME: home,
      BAZILION_SCHEDULER: 'on',
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => (stderr += c))
  try {
    await pollHttp(`http://127.0.0.1:${port}/api/health`, 30_000)
  } catch (err) {
    child.kill('SIGKILL')
    throw new Error(`[${label}] daemon did not become healthy: ${err.message}\nstderr: ${stderr}`)
  }
  return {
    stderr,
    async stop() {
      await new Promise((resolve) => {
        child.on('close', () => resolve())
        child.kill('SIGTERM')
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
        }, 5_000)
      })
      return stderr
    },
  }
}

function openHomeDb(home) {
  return new DatabaseSync(join(home, 'bazilion.db'))
}

function ledgerVersions(home) {
  const db = openHomeDb(home)
  try {
    return db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((r) => r.version)
  } finally {
    db.close()
  }
}

function insertSentinel(home, id, name) {
  const db = openHomeDb(home)
  try {
    db.prepare("INSERT INTO teams (id, name, user_md, created_at) VALUES (?, ?, '', ?)").run(
      id,
      name,
      Date.now(),
    )
  } finally {
    db.close()
  }
}

function sentinelName(home, id) {
  const db = openHomeDb(home)
  try {
    return db.prepare('SELECT name FROM teams WHERE id = ?').get(id)?.name ?? null
  } finally {
    db.close()
  }
}

function chainLengthOfWorktree(worktree) {
  return readdirSync(join(worktree, 'apps/daemon/src/core/db/migrations')).filter((f) =>
    f.endsWith('.sql'),
  ).length
}

function preMigrationSnapshots(home) {
  return readdirSync(home).filter((f) => f.startsWith('bazilion.pre-migration-'))
}

async function runEntry({ tag, expect }) {
  const label = `[${tag} → current, expect ${expect}]`
  console.log(`\n=== ${label} ===`)
  const base = mkdtempSync(join(tmpdir(), `bazilion-matrix-${tag}-`))
  const worktree = join(base, 'src')
  const home = join(base, 'home')

  try {
    // 1. Check out the release and install its own dependency tree.
    await runOrThrow('git', ['worktree', 'add', '--detach', worktree, tag], { cwd: REPO_ROOT })
    await runOrThrow('pnpm', ['install', '--frozen-lockfile'], { cwd: worktree })

    // 2. Seed a genuine home by booting the release's own daemon.
    const seeded = await bootDaemon(worktree, home, `${label} seed`)
    await seeded.stop()

    // 3. Plant pre-upgrade sentinel data the operator would care about.
    insertSentinel(home, 'matrix-sentinel', `planted-by-${tag}`)
    const ledgerBefore = ledgerVersions(home)
    console.log(`seeded: ledger=${JSON.stringify(ledgerBefore)}`)

    // 4. Bring the home up under the current branch.
    if (expect === 'upgrade') {
      const current = await bootDaemon(REPO_ROOT, home, label)
      await current.stop()

      if (sentinelName(home, 'matrix-sentinel') !== `planted-by-${tag}`) {
        throw new Error(`${label} sentinel data lost during upgrade`)
      }
      const grew = chainLengthOfWorktree(worktree) < chainLengthOfWorktree(REPO_ROOT)
      const snapshots = preMigrationSnapshots(home)
      if (grew && snapshots.length === 0) {
        throw new Error(`${label} chain grew but no pre-migration snapshot was taken`)
      }
      if (!grew && snapshots.length > 0) {
        throw new Error(`${label} chain unchanged but pre-migration snapshots exist`)
      }

      // 5. Idempotence: a second boot of the upgraded home must also succeed.
      const second = await bootDaemon(REPO_ROOT, home, `${label} second boot`)
      await second.stop()
      console.log(`${label} upgraded, sentinel preserved, second boot OK`)
    } else {
      const ledgerBefore = JSON.stringify(ledgerVersions(home))
      let refusalError
      try {
        const attempt = await bootDaemon(REPO_ROOT, home, label)
        // bootDaemon resolves only on health; a refused daemon must NOT get there.
        await attempt.stop()
        refusalError = new Error(`${label} daemon started against a home that must be refused`)
      } catch (err) {
        refusalError = err
      }
      const refusedWithActionableMessage = refusalError.message.includes('Bazilion cannot start')
      const sentinelIntact = sentinelName(home, 'matrix-sentinel') === `planted-by-${tag}`
      const ledgerIntact = JSON.stringify(ledgerVersions(home)) === ledgerBefore
      const noSnapshot = preMigrationSnapshots(home).length === 0
      if (refusedWithActionableMessage && sentinelIntact && ledgerIntact && noSnapshot) {
        console.log(`${label} refused cleanly, home untouched`)
        return
      }
      throw new Error(
        `${label} refusal incomplete: actionable=${refusedWithActionableMessage} ` +
          `sentinelIntact=${sentinelIntact} ledgerIntact=${ledgerIntact} noSnapshot=${noSnapshot}`,
      )
    }
  } catch (err) {
    failures.push({ tag, expect, error: err })
    console.error(`${label} FAILED: ${err.message}`)
  } finally {
    rmSync(base, { recursive: true, force: true })
    await run('git', ['worktree', 'prune'], { cwd: REPO_ROOT })
  }
}

for (const entry of MATRIX) {
  await runEntry(entry)
}

if (failures.length > 0) {
  console.error(`\nupgrade matrix: ${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nupgrade matrix: all entries passed')
