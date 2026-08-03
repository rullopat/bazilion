import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, parse, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { create, extract, Header, list } from 'tar'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  loadProfile,
  openConfig,
  openDb,
  openSecrets,
  resolveAgent,
  resolvePaths,
} from '../../daemon/src/core/index.ts'
import { installValidatedPayload, RestoreRecoveryRequiredError } from '../src/commands/backup.ts'
import { acquireHomeRestoreLock, daemonLivenessPath } from '../src/daemon-liveness.ts'
import { extractAgentId, makeHome, runCli, type TestHome } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

interface AppendedTarEntry {
  path: string
  type?: 'File' | 'SymbolicLink'
  body?: string
  linkpath?: string
}

function appendTarEntries(source: string, output: string, entries: AppendedTarEntry[]): void {
  const raw = gunzipSync(readFileSync(source))
  let end = 0
  while (end + 512 <= raw.length) {
    const block = raw.subarray(end, end + 512)
    if (block.every((byte) => byte === 0)) break
    const header = new Header(block)
    if (!header.cksumValid) throw new Error(`invalid source tar header at offset ${end}`)
    end += 512 + Math.ceil((header.size ?? 0) / 512) * 512
  }

  const appended: Buffer[] = [raw.subarray(0, end)]
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '')
    const header = new Header({
      path: entry.path,
      type: entry.type ?? 'File',
      linkpath: entry.linkpath,
      mode: 0o600,
      uid: 0,
      gid: 0,
      size: entry.type === 'SymbolicLink' ? 0 : body.length,
      mtime: new Date(),
    })
    const headerBlock = Buffer.alloc(512)
    header.encode(headerBlock)
    appended.push(headerBlock)
    if (body.length > 0) {
      appended.push(body, Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length))
    }
  }
  appended.push(Buffer.alloc(1024))
  writeFileSync(output, gzipSync(Buffer.concat(appended)))
}

function tempEntries(prefix: string): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((entry) => entry.startsWith(prefix)))
}

function cleanupLivenessArtifacts(home: string): void {
  const runtime = daemonLivenessPath(home)
  rmSync(runtime, { force: true })
  const parent = dirname(runtime)
  const reclaimPrefix = `${basename(runtime)}.reclaim-`
  for (const entry of readdirSync(parent)) {
    if (entry.startsWith(reclaimPrefix)) {
      rmSync(join(parent, entry), { recursive: true, force: true })
    }
  }
}

function runLockContender(
  home: string,
  barrier: string,
): Promise<{ exitCode: number; output: string }> {
  const fixture = join(import.meta.dirname, 'fixtures', 'restore-lock-contender.ts')
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', fixture, home, barrier],
      { env: process.env },
    )
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 0, output: Buffer.concat(output).toString('utf8') })
    })
  })
}

async function exitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''])
  const pid = child.pid
  if (!pid) throw new Error('test process did not receive a PID')
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', () => resolve())
  })
  return pid
}

test('backup create downloads a tar.gz with the home contents', async () => {
  writeFileSync(join(server.home, 'marker.txt'), 'hello')
  const qmdIndex = join(server.home, 'teams', 'default', 'memory', '.qmd-index.sqlite')
  writeFileSync(qmdIndex, 'rebuildable-cache')
  expect(existsSync(join(server.home, 'bazilion.db-wal'))).toBe(true)
  const out = join(tmpdir(), `bz-backup-${Date.now()}.tar.gz`)

  const res = await server.cli(['backup', 'create', out])
  expect(res.exitCode).toBe(0)
  expect(res.stdout).toContain('done')
  expect(existsSync(out)).toBe(true)
  expect(statSync(out).size).toBeGreaterThan(0)

  const members: string[] = []
  await list({ file: out, onentry: (entry) => members.push(entry.path.replace(/^\.\//, '')) })
  expect(members.filter((path) => path === 'bazilion.db')).toHaveLength(1)
  expect(members).not.toContain('bazilion.db-wal')
  expect(members).not.toContain('bazilion.db-shm')
  expect(members).not.toContain('daemon-runtime.json')
  expect(members).not.toContain('teams/default/memory/.qmd-index.sqlite')

  rmSync(out, { force: true })
})

test('cancelled backup download releases its online snapshot', async () => {
  const largeFile = join(server.home, 'cancel-proof.bin')
  writeFileSync(largeFile, randomBytes(4 * 1024 * 1024))
  const before = tempEntries('bazilion-backup-')

  const response = await fetch(`${server.url}/api/backup`, {
    headers: { authorization: `Bearer ${server.token}`, origin: server.url },
  })
  expect(response.status).toBe(200)
  const reader = response.body?.getReader()
  expect(reader).toBeDefined()
  await reader?.read()
  await reader?.cancel('test cancellation')

  for (let attempt = 0; attempt < 20; attempt++) {
    const leaked = [...tempEntries('bazilion-backup-')].filter((entry) => !before.has(entry))
    if (leaked.length === 0) break
    await delay(25)
  }
  expect([...tempEntries('bazilion-backup-')].filter((entry) => !before.has(entry))).toEqual([])
  rmSync(largeFile, { force: true })
})

test('backup restore extracts the tar.gz into a fresh home', async () => {
  writeFileSync(join(server.home, 'marker.txt'), 'restored-value')
  expect(
    (await server.cli(['profile', 'create', 'backup-profile', '--model', 'lmstudio:test-model']))
      .exitCode,
  ).toBe(0)
  const spawned = await server.cli([
    'agent',
    'spawn',
    '--profile',
    'backup-profile',
    '--name',
    'Backup Agent',
  ])
  expect(spawned.exitCode).toBe(0)
  const agentId = extractAgentId(spawned.stdout)
  expect(
    (
      await server.cli([
        'agent',
        'review-config',
        agentId,
        '--enable',
        '--every',
        '8',
        '--reasoning',
        'low',
      ])
    ).exitCode,
  ).toBe(0)
  expect((await server.cli(['agent', 'review', agentId])).exitCode).toBe(0)
  const sourceDb = openDb(join(server.home, 'bazilion.db'))
  const review = sourceDb.raw
    .query<{ id: string }, [string]>('SELECT id FROM agent_reviews WHERE agent_id = ?')
    .get(agentId)
  expect(review).toBeDefined()
  const proposalId = randomUUID()
  sourceDb.raw.run(
    `INSERT INTO agent_lesson_proposals
       (id, review_id, agent_id, scope, text, evidence_json, status, version, decided_at,
        applied_key, created_at, updated_at)
     VALUES (?, ?, ?, 'shared', 'Restored reviewed lesson', ?, 'approved', 2, ?, ?, ?, ?)`,
    [
      proposalId,
      review?.id ?? '',
      agentId,
      JSON.stringify([{ sessionId: 'proof', entryOrdinal: 1 }]),
      Date.now(),
      `lessons/${proposalId}.md`,
      Date.now(),
      Date.now(),
    ],
  )
  sourceDb.close()
  await server.cli(['config', 'set', 'LMSTUDIO_URL', 'http://backup-config.example/v1'])
  await server.cli(['config', 'set', 'OPENAI_API_KEY', 'backup-secret-value'])
  writeFileSync(join(server.home, 'agents', agentId, 'sessions', 'proof.jsonl'), '{"ok":true}\n')
  writeFileSync(join(server.home, 'teams', 'default', 'team-proof.txt'), 'team-work-product')
  writeFileSync(join(server.home, 'teams', 'default', 'memory', 'proof.md'), '# shared memory\n')
  mkdirSync(join(server.home, 'skills', 'backup-skill'))
  writeFileSync(join(server.home, 'skills', 'backup-skill', 'SKILL.md'), '# Backup skill\n')
  const sourceAuth = JSON.parse(readFileSync(join(server.home, 'auth.json'), 'utf8')) as {
    token: string
  }
  const archive = join(tmpdir(), `bz-backup-${Date.now()}.tar.gz`)
  await server.cli(['backup', 'create', archive])

  // Restore into an empty dir. `runCli` doesn't need a server for this — the
  // restore path is pure-offline — but we pass a valid home so the `--home`
  // flag gets exercised.
  const target: TestHome = { home: join(tmpdir(), `bz-restore-${Date.now()}`), cleanup() {} }
  mkdirSync(target.home, { recursive: true })
  const res = await runCli(['backup', 'restore', archive, '--home', target.home], target.home)
  expect(res.exitCode).toBe(0)
  expect(res.stdout).toContain('restored to')
  expect(existsSync(join(target.home, 'marker.txt'))).toBe(true)
  expect(readFileSync(join(target.home, 'marker.txt'), 'utf8')).toBe('restored-value')
  expect(existsSync(join(target.home, 'bazilion.db'))).toBe(true)
  expect(
    readFileSync(join(target.home, 'agents', agentId, 'sessions', 'proof.jsonl'), 'utf8'),
  ).toBe('{"ok":true}\n')
  expect(readFileSync(join(target.home, 'teams', 'default', 'team-proof.txt'), 'utf8')).toBe(
    'team-work-product',
  )
  expect(readFileSync(join(target.home, 'teams', 'default', 'memory', 'proof.md'), 'utf8')).toBe(
    '# shared memory\n',
  )
  expect(readFileSync(join(target.home, 'skills', 'backup-skill', 'SKILL.md'), 'utf8')).toBe(
    '# Backup skill\n',
  )
  const restoredAuth = JSON.parse(readFileSync(join(target.home, 'auth.json'), 'utf8')) as {
    token: string
  }
  expect(restoredAuth.token).toBe(sourceAuth.token)
  for (const suffix of ['-wal', '-shm', '-journal']) {
    expect(existsSync(join(target.home, `bazilion.db${suffix}`))).toBe(false)
  }
  const restoredDb = openDb(join(target.home, 'bazilion.db'))
  const restoredPaths = resolvePaths(target.home)
  expect(
    restoredDb.raw
      .query<{ id: string; dir: string }, [string]>('SELECT id, dir FROM profiles WHERE id = ?')
      .get('backup-profile'),
  ).toEqual({ id: 'backup-profile', dir: restoredPaths.profileDir('backup-profile') })
  expect(
    restoredDb.raw
      .query<{ id: string; dir: string }, [string]>('SELECT id, dir FROM agents WHERE id = ?')
      .get(agentId),
  ).toEqual({ id: agentId, dir: restoredPaths.agentDir(agentId) })
  expect(openConfig(restoredDb).get('LMSTUDIO_URL')).toBe('http://backup-config.example/v1')
  expect(openSecrets(restoredDb, restoredAuth.token).get('OPENAI_API_KEY')).toBe(
    'backup-secret-value',
  )
  expect(
    restoredDb.raw
      .query<{ review_enabled: number }, [string]>('SELECT review_enabled FROM agents WHERE id = ?')
      .get(agentId),
  ).toEqual({ review_enabled: 1 })
  expect(
    restoredDb.raw
      .query<{ text: string; applied_key: string }, [string]>(
        'SELECT text, applied_key FROM agent_lesson_proposals WHERE id = ?',
      )
      .get(proposalId),
  ).toEqual({ text: 'Restored reviewed lesson', applied_key: `lessons/${proposalId}.md` })

  // A portable restore must remain operational after the source tree goes
  // away. Hide the source profile/Agent directories and exercise the same
  // loaders used by daemon routes and Agent sessions against the restored DB.
  const sourceProfileDir = join(server.home, 'profiles', 'backup-profile')
  const sourceAgentDir = join(server.home, 'agents', agentId)
  const heldProfileDir = `${sourceProfileDir}.held-for-restore-test`
  const heldAgentDir = `${sourceAgentDir}.held-for-restore-test`
  renameSync(sourceProfileDir, heldProfileDir)
  renameSync(sourceAgentDir, heldAgentDir)
  try {
    expect(loadProfile(restoredDb, 'backup-profile').profile.dir).toBe(
      restoredPaths.profileDir('backup-profile'),
    )
    expect(resolveAgent(restoredDb, restoredPaths, agentId).agent.dir).toBe(
      restoredPaths.agentDir(agentId),
    )
  } finally {
    renameSync(heldAgentDir, sourceAgentDir)
    renameSync(heldProfileDir, sourceProfileDir)
  }
  restoredDb.close()

  rmSync(archive, { force: true })
  rmSync(target.home, { recursive: true, force: true })
})

test('cross-home restore preserves an external linked-Team target without following it', async () => {
  const external = join(tmpdir(), `bz-linked-team-target-${randomUUID()}`)
  mkdirSync(external)
  writeFileSync(join(external, 'external.txt'), 'outside the backup')
  const added = await server.cli(['team', 'add', 'portable-link', '--link', external])
  expect(added.exitCode, added.stderr + added.stdout).toBe(0)

  const archive = join(tmpdir(), `bz-linked-team-${randomUUID()}.tar.gz`)
  const created = await server.cli(['backup', 'create', archive])
  expect(created.exitCode, created.stderr + created.stdout).toBe(0)
  const target = makeHome()
  const restored = await runCli(['backup', 'restore', archive, '--home', target.home], target.home)
  expect(restored.exitCode, restored.stderr + restored.stdout).toBe(0)

  const restoredSlot = join(target.home, 'teams', 'portable-link')
  expect(lstatSync(restoredSlot).isSymbolicLink()).toBe(true)
  expect(readlinkSync(restoredSlot)).toBe(external)
  expect(readFileSync(join(external, 'external.txt'), 'utf8')).toBe('outside the backup')

  rmSync(archive, { force: true })
  target.cleanup()
  rmSync(external, { recursive: true, force: true })
})

test('cross-home restore preserves contained relative symlinks in Team work product', async () => {
  const sourceDir = join(server.home, 'teams', 'default', 'notes')
  mkdirSync(sourceDir)
  writeFileSync(join(sourceDir, 'current.md'), '# Current notes\n')
  symlinkSync('current.md', join(sourceDir, 'latest.md'), 'file')

  const archive = join(tmpdir(), `bz-relative-link-${randomUUID()}.tar.gz`)
  const created = await server.cli(['backup', 'create', archive])
  expect(created.exitCode, created.stderr + created.stdout).toBe(0)

  const target = makeHome()
  const restored = await runCli(['backup', 'restore', archive, '--home', target.home], target.home)
  expect(restored.exitCode, restored.stderr + restored.stdout).toBe(0)

  const restoredLink = join(target.home, 'teams', 'default', 'notes', 'latest.md')
  expect(lstatSync(restoredLink).isSymbolicLink()).toBe(true)
  expect(readlinkSync(restoredLink)).toBe('current.md')
  expect(readFileSync(restoredLink, 'utf8')).toBe('# Current notes\n')

  rmSync(archive, { force: true })
  target.cleanup()
})

test('backup output inside BAZILION_HOME is rejected to prevent nested backups', async () => {
  const output = join(server.home, 'local-backup.tar.gz')
  const result = await server.cli(['backup', 'create', output])
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr + result.stdout).toMatch(/output must be outside BAZILION_HOME/)
  expect(existsSync(output)).toBe(false)
})

test('failed download preserves an existing output and removes temporary files', async () => {
  const scratch = join(tmpdir(), `bz-failed-download-${randomUUID()}`)
  mkdirSync(scratch)
  const output = join(scratch, 'backup.tar.gz')
  writeFileSync(output, 'existing-good-backup')
  const downloadsBefore = new Set(
    readdirSync(tmpdir()).filter((entry) => entry.startsWith('bazilion-download-')),
  )

  const brokenHttp = createHttpServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/gzip',
      'content-length': '1000000',
    })
    response.write('partial')
    setTimeout(() => response.destroy(), 20)
  })
  await new Promise<void>((resolve) => brokenHttp.listen(0, '127.0.0.1', resolve))
  const address = brokenHttp.address() as AddressInfo

  try {
    const result = await server.cli(['backup', 'create', output], {
      BAZILION_SERVER: `http://127.0.0.1:${address.port}`,
      BAZILION_TOKEN: 'test-token',
    })
    expect(result.exitCode).not.toBe(0)
    expect(readFileSync(output, 'utf8')).toBe('existing-good-backup')
    expect(readdirSync(scratch)).toEqual(['backup.tar.gz'])
    const downloadsAfter = readdirSync(tmpdir()).filter((entry) =>
      entry.startsWith('bazilion-download-'),
    )
    expect(downloadsAfter.filter((entry) => !downloadsBefore.has(entry))).toEqual([])
  } finally {
    await new Promise<void>((resolve, reject) =>
      brokenHttp.close((error) => (error ? reject(error) : resolve())),
    )
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('backup restore refuses a non-empty target without --force', async () => {
  const archive = join(tmpdir(), `bz-backup-${Date.now()}.tar.gz`)
  await server.cli(['backup', 'create', archive])

  const target = makeHome()
  // `makeHome` returns an empty dir; drop a file so restore sees non-empty.
  writeFileSync(join(target.home, 'stray.txt'), 'do not destroy')
  const res = await runCli(['backup', 'restore', archive, '--home', target.home], target.home)
  expect(res.exitCode).not.toBe(0)
  expect(res.stderr + res.stdout).toMatch(/not empty.*--force/)
  // File still there
  expect(existsSync(join(target.home, 'stray.txt'))).toBe(true)

  rmSync(archive, { force: true })
  target.cleanup()
})

test('backup restore --force overwrites a non-empty target', async () => {
  writeFileSync(join(server.home, 'fresh.txt'), 'from-backup')
  const archive = join(tmpdir(), `bz-backup-${Date.now()}.tar.gz`)
  await server.cli(['backup', 'create', archive])

  const target = makeHome()
  writeFileSync(join(target.home, 'stray.txt'), 'old data')
  const res = await runCli(
    ['backup', 'restore', archive, '--home', target.home, '--force'],
    target.home,
  )
  expect(res.exitCode).toBe(0)
  // The stray file is gone, backup content landed
  expect(existsSync(join(target.home, 'stray.txt'))).toBe(false)
  expect(existsSync(join(target.home, 'fresh.txt'))).toBe(true)

  rmSync(archive, { force: true })
  target.cleanup()
})

test('backup restore errors clearly on a missing file', async () => {
  const target = makeHome()
  const res = await runCli(
    ['backup', 'restore', '/definitely/not/a/real/path.tar.gz', '--home', target.home],
    target.home,
  )
  expect(res.exitCode).not.toBe(0)
  expect(res.stderr + res.stdout).toMatch(/backup file not found/)
  target.cleanup()
})

test('backup restore refuses the configured home when a custom-port daemon is reachable', async () => {
  const archive = join(tmpdir(), `bz-custom-port-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', archive])
  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')

  const localDaemon = createHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"ok":true}')
  })
  await new Promise<void>((resolve) => localDaemon.listen(0, '127.0.0.1', resolve))
  const address = localDaemon.address() as AddressInfo
  const serverUrl = `http://127.0.0.1:${address.port}`

  try {
    const restored = await runCli(['backup', 'restore', archive, '--force'], target.home, {
      BAZILION_SERVER: serverUrl,
      BAZILION_TOKEN: 'test-token',
    })
    expect(restored.exitCode).not.toBe(0)
    expect(restored.stderr + restored.stdout).toContain(`running at ${serverUrl}`)
    expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')
  } finally {
    await new Promise<void>((resolve, reject) =>
      localDaemon.close((error) => (error ? reject(error) : resolve())),
    )
    rmSync(archive, { force: true })
    target.cleanup()
  }
})

test('restore discovers the real daemon custom port from a separate CLI invocation', async () => {
  const archive = join(tmpdir(), `bz-real-custom-port-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', archive])
  const runtimePath = daemonLivenessPath(server.home)
  const runtime = JSON.parse(readFileSync(runtimePath, 'utf8')) as {
    instanceId: string
    port: number
    state: string
    home?: string
  }
  expect(runtime.state).toBe('listening')
  expect(runtime.port).toBe(Number(new URL(server.url).port))
  expect(runtime.home).toBeUndefined()

  writeFileSync(join(server.home, 'keep-while-live.txt'), 'original-data')
  const restored = await runCli(['backup', 'restore', archive, '--force'], server.home, {
    // Deliberately do not tell this CLI process where the daemon is.
    BAZILION_SERVER: '',
    BAZILION_TOKEN: '',
  })
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toContain(`running at ${server.url}`)
  expect(readFileSync(join(server.home, 'keep-while-live.txt'), 'utf8')).toBe('original-data')
  const health = await fetch(`${server.url}/api/health`)
  expect(health.headers.get('x-bazilion-daemon-instance')).toBe(runtime.instanceId)

  rmSync(archive, { force: true })
})

test('daemon and restore hold the same exclusive pre-database ownership record', async () => {
  const target = makeHome()
  const alias = join(dirname(target.home), `${basename(target.home)}-alias`)
  symlinkSync(target.home, alias, process.platform === 'win32' ? 'junction' : 'dir')
  expect(daemonLivenessPath(alias)).toBe(daemonLivenessPath(target.home))
  const lock = await acquireHomeRestoreLock(alias)
  try {
    const attemptedDaemon = await runCli(['serve', '--port', '0'], target.home)
    expect(attemptedDaemon.exitCode).not.toBe(0)
    expect(attemptedDaemon.stderr + attemptedDaemon.stdout).toMatch(
      /failed to acquire daemon ownership.*restore process/s,
    )
    // Ownership is acquired before getCtx(), so the losing daemon never even
    // bootstraps or opens a database in this home.
    expect(existsSync(join(target.home, 'bazilion.db'))).toBe(false)
  } finally {
    lock.release()
    cleanupLivenessArtifacts(target.home)
    rmSync(alias, { force: true })
    target.cleanup()
  }
})

test('malformed ownership records fail closed for both restore and daemon startup', async () => {
  const target = makeHome()
  const runtimePath = daemonLivenessPath(target.home)
  writeFileSync(
    runtimePath,
    `${JSON.stringify({
      version: 2,
      instanceId: randomUUID(),
      pid: await exitedProcessId(),
      owner: 'daemon',
      // Illegal owner/state combination and deliberately missing startedAt.
      state: 'swapping',
    })}\n`,
  )

  try {
    await expect(acquireHomeRestoreLock(target.home)).rejects.toThrow(/ownership record.*invalid/)
    const attemptedDaemon = await runCli(['serve', '--port', '0'], target.home)
    expect(attemptedDaemon.exitCode).not.toBe(0)
    expect(attemptedDaemon.stderr + attemptedDaemon.stdout).toMatch(/ownership record.*invalid/)
    expect(existsSync(join(target.home, 'bazilion.db'))).toBe(false)
  } finally {
    cleanupLivenessArtifacts(target.home)
    target.cleanup()
  }
})

test('a crashed daemon record is reclaimed only after its PID is dead', async () => {
  const archive = join(tmpdir(), `bz-crash-recovery-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', archive])
  const crashed = await startTestServer()
  const runtimePath = daemonLivenessPath(crashed.home)
  expect(existsSync(runtimePath)).toBe(true)

  await crashed.stop({ keepHome: true, signal: 'SIGKILL' })
  expect(existsSync(runtimePath)).toBe(true)

  try {
    const restored = await runCli(
      ['backup', 'restore', archive, '--home', crashed.home, '--force'],
      crashed.home,
      { BAZILION_SERVER: '', BAZILION_TOKEN: '' },
    )
    expect(restored.exitCode, restored.stderr + restored.stdout).toBe(0)
    expect(restored.stderr + restored.stdout).toMatch(/removed stale Bazilion daemon ownership/)
    expect(existsSync(runtimePath)).toBe(false)
  } finally {
    rmSync(archive, { force: true })
    cleanupLivenessArtifacts(crashed.home)
    rmSync(crashed.home, { recursive: true, force: true })
  }
})

test('graceful daemon shutdown closes SQLite and removes its ownership record', async () => {
  const isolated = await startTestServer()
  const runtimePath = daemonLivenessPath(isolated.home)
  expect(existsSync(runtimePath)).toBe(true)

  await isolated.stop({ keepHome: true })
  try {
    expect(existsSync(runtimePath)).toBe(false)
    const db = new DatabaseSync(join(isolated.home, 'bazilion.db'), { readOnly: true })
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    db.close()
  } finally {
    cleanupLivenessArtifacts(isolated.home)
    rmSync(isolated.home, { recursive: true, force: true })
  }
})

test('concurrent contenders cannot replace the winner after reclaiming one dead owner', async () => {
  const target = makeHome()
  const runtimePath = daemonLivenessPath(target.home)
  const barrier = join(tmpdir(), `bz-lock-barrier-${randomUUID()}`)
  const deadPid = await exitedProcessId()
  writeFileSync(
    runtimePath,
    `${JSON.stringify({
      version: 1,
      instanceId: randomUUID(),
      pid: deadPid,
      owner: 'restore',
      state: 'restoring',
      startedAt: Date.now() - 60_000,
    })}\n`,
  )

  try {
    const first = runLockContender(target.home, barrier)
    const second = runLockContender(target.home, barrier)
    await delay(100)
    writeFileSync(barrier, 'go')
    const results = await Promise.all([first, second])
    expect(results.filter((result) => result.exitCode === 0)).toHaveLength(1)
    expect(results.filter((result) => result.output.includes('acquired'))).toHaveLength(1)
    expect(results.filter((result) => result.exitCode !== 0)).toHaveLength(1)
    expect(existsSync(runtimePath)).toBe(false)
  } finally {
    rmSync(barrier, { force: true })
    cleanupLivenessArtifacts(target.home)
    target.cleanup()
  }
})

test('backup restore canonicalizes and refuses a relative path resolving to filesystem root', async () => {
  const archive = join(tmpdir(), `bz-root-refusal-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', archive])
  const target = makeHome()
  const rootFromCwd = relative(process.cwd(), parse(process.cwd()).root)
  expect(rootFromCwd).not.toBe('')

  const restored = await runCli(['backup', 'restore', archive, '--home', rootFromCwd], target.home)
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(/refusing to restore over filesystem root/)

  rmSync(archive, { force: true })
  target.cleanup()
})

test('parallel online backups stay transactionally consistent during concurrent WAL writes', async () => {
  // The online-backup API may briefly hold a source lock between steps.
  // A real WAL writer waits for that lock; DatabaseSync otherwise defaults
  // to a zero-millisecond busy timeout and makes this race spuriously fatal.
  const liveDb = new DatabaseSync(join(server.home, 'bazilion.db'), { timeout: 5_000 })
  liveDb.exec(`
    PRAGMA journal_mode = WAL;
    DELETE FROM config WHERE key LIKE 'backup_probe_left_%';
    DELETE FROM config WHERE key LIKE 'backup_probe_right_%';
  `)

  const first = join(tmpdir(), `bz-concurrent-a-${randomUUID()}.tar.gz`)
  const second = join(tmpdir(), `bz-concurrent-b-${randomUUID()}.tar.gz`)
  const writer = (async () => {
    for (let id = 1; id <= 150; id++) {
      liveDb.exec('BEGIN IMMEDIATE')
      try {
        const updatedAt = Date.now()
        liveDb
          .prepare('INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)')
          .run(`backup_probe_left_${id}`, String(id), updatedAt)
        liveDb
          .prepare('INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)')
          .run(`backup_probe_right_${id}`, String(id), updatedAt)
        liveDb.exec('COMMIT')
      } catch (error) {
        liveDb.exec('ROLLBACK')
        throw error
      }
      await delay(2)
    }
  })()

  const [firstResult, secondResult] = await Promise.all([
    server.cli(['backup', 'create', first]),
    server.cli(['backup', 'create', second]),
    writer,
  ])
  liveDb.close()
  expect(firstResult.exitCode, firstResult.stderr + firstResult.stdout).toBe(0)
  expect(secondResult.exitCode, secondResult.stderr + secondResult.stdout).toBe(0)

  for (const archive of [first, second]) {
    const target = makeHome()
    const restored = await runCli(
      ['backup', 'restore', archive, '--home', target.home],
      target.home,
    )
    expect(restored.exitCode, restored.stderr + restored.stdout).toBe(0)
    const snapshot = new DatabaseSync(join(target.home, 'bazilion.db'), { readOnly: true })
    const left = snapshot
      .prepare("SELECT COUNT(*) AS count FROM config WHERE key LIKE 'backup_probe_left_%'")
      .get() as { count: number }
    const right = snapshot
      .prepare("SELECT COUNT(*) AS count FROM config WHERE key LIKE 'backup_probe_right_%'")
      .get() as { count: number }
    expect(left.count).toBeGreaterThan(0)
    expect(left.count).toBe(right.count)
    expect(snapshot.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    snapshot.close()
    target.cleanup()
    rmSync(archive, { force: true })
  }
})

test('corrupt database is rejected before an existing home is replaced', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const corrupt = join(tmpdir(), `bz-corrupt-${randomUUID()}.tar.gz`)
  const unpacked = join(tmpdir(), `bz-corrupt-source-${randomUUID()}`)
  mkdirSync(unpacked)
  await server.cli(['backup', 'create', valid])
  await extract({ file: valid, cwd: unpacked })
  writeFileSync(join(unpacked, 'bazilion.db'), 'this is not a SQLite database')
  await create({ file: corrupt, cwd: unpacked, gzip: true }, ['.'])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', corrupt, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(/backup database is invalid/)
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(corrupt, { force: true })
  rmSync(unpacked, { recursive: true, force: true })
  target.cleanup()
})

test('database missing a current canonical schema object is rejected before replacement', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const incomplete = join(tmpdir(), `bz-incomplete-schema-${randomUUID()}.tar.gz`)
  const unpacked = join(tmpdir(), `bz-incomplete-schema-source-${randomUUID()}`)
  mkdirSync(unpacked)
  await server.cli(['backup', 'create', valid])
  await extract({ file: valid, cwd: unpacked })
  const db = new DatabaseSync(join(unpacked, 'bazilion.db'))
  db.exec('DROP TRIGGER validate_team_policy_edge_insert')
  expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
  db.close()
  await create({ file: incomplete, cwd: unpacked, gzip: true }, ['.'])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', incomplete, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(
    /required canonical schema trigger is missing: validate_team_policy_edge_insert/,
  )
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(incomplete, { force: true })
  rmSync(unpacked, { recursive: true, force: true })
  cleanupLivenessArtifacts(target.home)
  target.cleanup()
})

test('database with an extra trigger is rejected before path rebasing or replacement', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const malicious = join(tmpdir(), `bz-extra-trigger-${randomUUID()}.tar.gz`)
  const unpacked = join(tmpdir(), `bz-extra-trigger-source-${randomUUID()}`)
  mkdirSync(unpacked)
  await server.cli(['backup', 'create', valid])
  await extract({ file: valid, cwd: unpacked })
  const db = new DatabaseSync(join(unpacked, 'bazilion.db'))
  db.exec(`
    CREATE TRIGGER malicious_profile_dir_rewrite
    AFTER UPDATE OF dir ON profiles
    BEGIN
      UPDATE profiles SET dir = '/tmp/malicious-profile-dir' WHERE id = NEW.id;
    END
  `)
  db.close()
  await create({ file: malicious, cwd: unpacked, gzip: true }, ['.'])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', malicious, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(
    /unexpected schema trigger is not canonical: malicious_profile_dir_rewrite/,
  )
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(malicious, { force: true })
  rmSync(unpacked, { recursive: true, force: true })
  target.cleanup()
})

test('database path entity ids must match their canonical portable forms', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', valid])

  for (const entity of ['profile', 'agent', 'team'] as const) {
    const escapeName = `bz-${entity}-id-escape-${randomUUID()}`
    const maliciousId = `../../${escapeName}`
    const malicious = join(tmpdir(), `bz-${entity}-id-${randomUUID()}.tar.gz`)
    const unpacked = join(tmpdir(), `bz-${entity}-id-source-${randomUUID()}`)
    mkdirSync(unpacked)
    await extract({ file: valid, cwd: unpacked })
    const db = new DatabaseSync(join(unpacked, 'bazilion.db'))

    if (entity === 'profile') {
      db.prepare(
        `INSERT INTO profiles
           (id, name, dir, default_model, skills_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(maliciousId, 'malicious profile', '/outside', 'lmstudio:test-model', 'selected', 1, 1)
    } else if (entity === 'agent') {
      const profileId = 'agent-parent'
      mkdirSync(join(unpacked, 'profiles', profileId), { recursive: true })
      db.prepare(
        `INSERT INTO profiles
           (id, name, dir, default_model, skills_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(profileId, 'Agent parent', '/outside', 'lmstudio:test-model', 'selected', 1, 1)
      db.prepare(
        `INSERT INTO agents
           (id, profile_id, name, model_override, status, dir, reasoning_level,
            team_id, created_at, archived_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL)`,
      ).run(maliciousId, profileId, 'malicious agent', 'idle', '/outside', 'low', 'default', 1)
    } else {
      db.prepare('INSERT INTO teams (id, name, user_md, created_at) VALUES (?, ?, ?, ?)').run(
        maliciousId,
        'malicious team',
        '',
        1,
      )
    }
    db.close()
    await create({ file: malicious, cwd: unpacked, gzip: true }, ['.'])

    const target = makeHome()
    writeFileSync(join(target.home, 'keep.txt'), 'original-data')
    const collection = entity === 'profile' ? 'profiles' : entity === 'agent' ? 'agents' : 'teams'
    const escapedPath = resolve(target.home, collection, maliciousId)
    expect(existsSync(escapedPath)).toBe(false)
    const restored = await runCli(
      ['backup', 'restore', malicious, '--home', target.home, '--force'],
      target.home,
    )
    expect(restored.exitCode).not.toBe(0)
    expect(restored.stderr + restored.stdout).toMatch(
      new RegExp(`${entity === 'team' ? 'teams' : `${entity}s`} row has an invalid canonical id`),
    )
    expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')
    expect(existsSync(escapedPath)).toBe(false)

    rmSync(malicious, { force: true })
    rmSync(unpacked, { recursive: true, force: true })
    target.cleanup()
  }

  rmSync(valid, { force: true })
})

test('database entities missing their archived canonical directory are rejected', async () => {
  expect(
    (
      await server.cli([
        'profile',
        'create',
        'missing-dir-profile',
        '--model',
        'lmstudio:test-model',
      ])
    ).exitCode,
  ).toBe(0)
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const incomplete = join(tmpdir(), `bz-missing-entity-dir-${randomUUID()}.tar.gz`)
  const unpacked = join(tmpdir(), `bz-missing-entity-dir-source-${randomUUID()}`)
  mkdirSync(unpacked)
  await server.cli(['backup', 'create', valid])
  await extract({ file: valid, cwd: unpacked })
  rmSync(join(unpacked, 'profiles', 'missing-dir-profile'), { recursive: true, force: true })
  await create({ file: incomplete, cwd: unpacked, gzip: true }, ['.'])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', incomplete, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(
    /profiles row "missing-dir-profile" is missing its canonical directory/,
  )
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(incomplete, { force: true })
  rmSync(unpacked, { recursive: true, force: true })
  target.cleanup()
})

test('database Teams missing their archived canonical slot are rejected', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const incomplete = join(tmpdir(), `bz-missing-team-slot-${randomUUID()}.tar.gz`)
  const unpacked = join(tmpdir(), `bz-missing-team-slot-source-${randomUUID()}`)
  mkdirSync(unpacked)
  await server.cli(['backup', 'create', valid])
  await extract({ file: valid, cwd: unpacked })
  rmSync(join(unpacked, 'teams', 'default'), { recursive: true, force: true })
  await create({ file: incomplete, cwd: unpacked, gzip: true }, ['.'])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', incomplete, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(
    /teams row "default" is missing its canonical Team slot/,
  )
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(incomplete, { force: true })
  rmSync(unpacked, { recursive: true, force: true })
  target.cleanup()
})

test('foreign-key-invalid database is rejected before an existing home is replaced', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const invalid = join(tmpdir(), `bz-invalid-fk-${randomUUID()}.tar.gz`)
  const unpacked = join(tmpdir(), `bz-invalid-fk-source-${randomUUID()}`)
  mkdirSync(unpacked)
  await server.cli(['backup', 'create', valid])
  await extract({ file: valid, cwd: unpacked })
  const db = new DatabaseSync(join(unpacked, 'bazilion.db'))
  db.exec('PRAGMA foreign_keys = OFF')
  db.prepare('INSERT INTO agent_skills (agent_id, skill_name, attached_at) VALUES (?, ?, ?)').run(
    'missing-agent',
    'test-skill',
    Date.now(),
  )
  db.close()
  await create({ file: invalid, cwd: unpacked, gzip: true }, ['.'])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', invalid, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(/foreign_key_check failed/)
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(invalid, { force: true })
  rmSync(unpacked, { recursive: true, force: true })
  target.cleanup()
})

test('path-traversing archive is rejected without writing outside or replacing the target', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const malicious = join(tmpdir(), `bz-traversal-${randomUUID()}.tar.gz`)
  const escapedName = `bazilion-escaped-${randomUUID()}`
  const escapedPath = join(tmpdir(), escapedName)
  await server.cli(['backup', 'create', valid])
  appendTarEntries(valid, malicious, [{ path: `../${escapedName}`, body: 'must-not-escape' }])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', malicious, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(/backup path escapes the restore directory/)
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')
  expect(existsSync(escapedPath)).toBe(false)

  rmSync(valid, { force: true })
  rmSync(malicious, { force: true })
  rmSync(escapedPath, { force: true })
  target.cleanup()
})

test('archive-supplied daemon runtime state is rejected before replacement', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const unsafe = join(tmpdir(), `bz-runtime-state-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', valid])
  appendTarEntries(valid, unsafe, [
    {
      path: 'daemon-runtime.json',
      body: JSON.stringify({ version: 1, instanceId: randomUUID(), pid: process.pid }),
    },
  ])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', unsafe, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(
    /unsafe transient SQLite file: daemon-runtime\.json/,
  )
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(unsafe, { force: true })
  cleanupLivenessArtifacts(target.home)
  target.cleanup()
})

test('archive with an absolute symbolic link outside Team slots is rejected before replacement', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const malicious = join(tmpdir(), `bz-unsafe-link-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', valid])
  appendTarEntries(valid, malicious, [
    { path: 'logs/unsafe-link', type: 'SymbolicLink', linkpath: tmpdir() },
  ])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', malicious, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(
    /absolute symbolic links are only allowed for Team slots/,
  )
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(malicious, { force: true })
  target.cleanup()
})

test('archive with an escaping relative symbolic link is rejected before replacement', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const malicious = join(tmpdir(), `bz-escaping-relative-link-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', valid])
  appendTarEntries(valid, malicious, [
    {
      path: 'teams/default/escape',
      type: 'SymbolicLink',
      linkpath: '../../../outside-the-restore',
    },
  ])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', malicious, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(/symbolic link target escapes/)
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(malicious, { force: true })
  target.cleanup()
})

test('archive cannot place entries beneath an allowed linked Team slot', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const malicious = join(tmpdir(), `bz-link-descendant-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', valid])
  appendTarEntries(valid, malicious, [
    { path: 'teams/linked', type: 'SymbolicLink', linkpath: tmpdir() },
    { path: 'teams/linked/escaped.txt', body: 'must-not-follow-link' },
  ])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', malicious, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(/entry traverses symbolic link teams\/linked/)
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(malicious, { force: true })
  target.cleanup()
})

test('linked Team entry requires a valid slug and an absolute target', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', valid])

  for (const [name, entry, expected] of [
    [
      'relative-target',
      { path: 'teams/linked', type: 'SymbolicLink' as const, linkpath: '../external' },
      /invalid Team link target/,
    ],
    [
      'invalid-slug',
      { path: 'teams/Bad Slug', type: 'SymbolicLink' as const, linkpath: tmpdir() },
      /only allowed for Team slots/,
    ],
  ] as const) {
    const malicious = join(tmpdir(), `bz-${name}-${randomUUID()}.tar.gz`)
    appendTarEntries(valid, malicious, [entry])
    const target = makeHome()
    writeFileSync(join(target.home, 'keep.txt'), 'original-data')
    const restored = await runCli(
      ['backup', 'restore', malicious, '--home', target.home, '--force'],
      target.home,
    )
    expect(restored.exitCode).not.toBe(0)
    expect(restored.stderr + restored.stdout).toMatch(expected)
    expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')
    rmSync(malicious, { force: true })
    target.cleanup()
  }

  rmSync(valid, { force: true })
})

test('truncated archive is rejected before an existing home is replaced', async () => {
  const truncated = join(tmpdir(), `bz-truncated-${randomUUID()}.tar.gz`)
  await server.cli(['backup', 'create', truncated])
  truncateSync(truncated, Math.max(1, Math.floor(statSync(truncated).size / 2)))

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', truncated, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(truncated, { force: true })
  target.cleanup()
})

test('auth token and database mismatch is rejected before replacement', async () => {
  const valid = join(tmpdir(), `bz-valid-${randomUUID()}.tar.gz`)
  const mismatched = join(tmpdir(), `bz-auth-mismatch-${randomUUID()}.tar.gz`)
  const unpacked = join(tmpdir(), `bz-auth-mismatch-source-${randomUUID()}`)
  mkdirSync(unpacked)
  await server.cli(['backup', 'create', valid])
  await extract({ file: valid, cwd: unpacked })
  const wrongToken = 'wrong-token'
  writeFileSync(join(unpacked, 'auth.json'), `${JSON.stringify({ token: wrongToken })}\n`)
  // Add the wrong value as an otherwise-active secondary token. Restore must
  // still require the canonical bootstrap row because that token is also the
  // PBKDF2 credential for encrypted secrets.
  const db = new DatabaseSync(join(unpacked, 'bazilion.db'))
  db.prepare(
    `INSERT INTO web_tokens
       (id, label, token_hash, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
  ).run(
    randomUUID(),
    'secondary',
    createHash('sha256').update(wrongToken).digest('hex'),
    Date.now(),
  )
  db.close()
  await create({ file: mismatched, cwd: unpacked, gzip: true }, ['.'])

  const target = makeHome()
  writeFileSync(join(target.home, 'keep.txt'), 'original-data')
  const restored = await runCli(
    ['backup', 'restore', mismatched, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr + restored.stdout).toMatch(/auth\.json token does not match/)
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')

  rmSync(valid, { force: true })
  rmSync(mismatched, { force: true })
  rmSync(unpacked, { recursive: true, force: true })
  target.cleanup()
})

test('install failure rolls the original home back and marks the phase safe', async () => {
  const parent = join(tmpdir(), `bz-rollback-${randomUUID()}`)
  const target = join(parent, 'home')
  const staging = join(parent, 'staging')
  mkdirSync(target, { recursive: true })
  mkdirSync(staging)
  writeFileSync(join(target, 'keep.txt'), 'original-data')
  const lock = await acquireHomeRestoreLock(target)

  expect(() =>
    installValidatedPayload(join(staging, 'missing-payload'), target, staging, lock),
  ).toThrow()
  expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('original-data')
  expect(existsSync(join(staging, 'previous-home'))).toBe(false)
  expect(JSON.parse(readFileSync(lock.path, 'utf8')).state).toBe('installed')
  lock.release()
  expect(existsSync(lock.path)).toBe(false)

  cleanupLivenessArtifacts(target)
  rmSync(parent, { recursive: true, force: true })
})

test('successful install durably reaches installed before ownership is released', async () => {
  const parent = join(tmpdir(), `bz-install-success-${randomUUID()}`)
  const target = join(parent, 'home')
  const staging = join(parent, 'staging')
  const payload = join(staging, 'payload')
  mkdirSync(target, { recursive: true })
  mkdirSync(payload, { recursive: true })
  writeFileSync(join(target, 'old.txt'), 'old')
  writeFileSync(join(payload, 'new.txt'), 'new')
  const lock = await acquireHomeRestoreLock(target)

  installValidatedPayload(payload, target, staging, lock)
  expect(readFileSync(join(target, 'new.txt'), 'utf8')).toBe('new')
  const installedRecord = JSON.parse(readFileSync(lock.path, 'utf8')) as Record<string, unknown>
  expect(installedRecord.state).toBe('installed')
  lock.release()
  expect(existsSync(lock.path)).toBe(false)

  // A crash after `installed` is explicitly safe: a new owner may reclaim it.
  installedRecord.pid = await exitedProcessId()
  writeFileSync(lock.path, `${JSON.stringify(installedRecord)}\n`)
  const replacementLock = await acquireHomeRestoreLock(target)
  replacementLock.release()
  expect(existsSync(lock.path)).toBe(false)

  cleanupLivenessArtifacts(target)
  rmSync(parent, { recursive: true, force: true })
})

test('failure between swap renames stays fail-closed with exact recovery path', async () => {
  const parent = join(tmpdir(), `bz-interrupted-swap-${randomUUID()}`)
  const target = join(parent, 'home')
  const staging = join(parent, 'staging')
  const payload = join(staging, 'payload')
  const previous = join(staging, 'previous-home')
  mkdirSync(target, { recursive: true })
  mkdirSync(payload, { recursive: true })
  writeFileSync(join(target, 'old.txt'), 'old')
  writeFileSync(join(payload, 'new.txt'), 'new')
  const lock = await acquireHomeRestoreLock(target)

  expect(() =>
    installValidatedPayload(payload, target, staging, lock, {
      rename: renameSync,
      afterPreviousMoved() {
        throw new Error('simulated process interruption')
      },
    }),
  ).toThrow(/simulated process interruption/)
  lock.release()
  expect(existsSync(target)).toBe(false)
  expect(readFileSync(join(previous, 'old.txt'), 'utf8')).toBe('old')

  const runtimePath = daemonLivenessPath(target)
  const record = JSON.parse(readFileSync(runtimePath, 'utf8')) as Record<string, unknown>
  expect(record.state).toBe('recovery-required')
  expect(record.recoveryPath).toBe(previous)
  expect(record.hadPrevious).toBe(true)
  record.pid = await exitedProcessId()
  writeFileSync(runtimePath, `${JSON.stringify(record)}\n`)

  await expect(acquireHomeRestoreLock(target)).rejects.toThrow(/recovery data is at/)
  const daemonAttempt = await runCli(['serve', '--port', '0'], target)
  expect(daemonAttempt.exitCode).not.toBe(0)
  expect(daemonAttempt.stderr + daemonAttempt.stdout).toMatch(/restore recovery is required/)
  expect(existsSync(join(target, 'bazilion.db'))).toBe(false)

  // Simulate the operator's explicit recovery before removing the marker.
  renameSync(previous, target)
  cleanupLivenessArtifacts(target)
  rmSync(parent, { recursive: true, force: true })
})

test('directory sync failure after the first rename preserves the only original home', async () => {
  const parent = join(tmpdir(), `bz-first-rename-sync-${randomUUID()}`)
  const target = join(parent, 'home')
  const staging = join(parent, 'staging')
  const payload = join(staging, 'payload')
  const previous = join(staging, 'previous-home')
  mkdirSync(target, { recursive: true })
  mkdirSync(payload, { recursive: true })
  writeFileSync(join(target, 'old.txt'), 'old')
  writeFileSync(join(payload, 'new.txt'), 'new')
  const lock = await acquireHomeRestoreLock(target)

  let failure: unknown
  try {
    installValidatedPayload(payload, target, staging, lock, {
      rename: renameSync,
      fsyncDirectory() {
        throw new Error('simulated directory fsync failure')
      },
    })
  } catch (error) {
    failure = error
  }

  // Mirror restoreCmd's cleanup decision: recovery failures must retain the
  // staging directory because it now owns the only original-home copy.
  const preserveStaging = failure instanceof RestoreRecoveryRequiredError
  if (!preserveStaging) rmSync(staging, { recursive: true, force: true })
  lock.release()

  expect(failure).toBeInstanceOf(RestoreRecoveryRequiredError)
  expect((failure as RestoreRecoveryRequiredError).message).toContain(
    'simulated directory fsync failure',
  )
  expect(existsSync(target)).toBe(false)
  expect(readFileSync(join(previous, 'old.txt'), 'utf8')).toBe('old')
  expect(existsSync(payload)).toBe(true)

  const runtimePath = daemonLivenessPath(target)
  const record = JSON.parse(readFileSync(runtimePath, 'utf8')) as Record<string, unknown>
  expect(record.state).toBe('recovery-required')
  expect(record.recoveryPath).toBe(previous)

  renameSync(previous, target)
  cleanupLivenessArtifacts(target)
  rmSync(parent, { recursive: true, force: true })
})

test('double install and rollback failure retains a recovery-required marker', async () => {
  const parent = join(tmpdir(), `bz-double-failure-${randomUUID()}`)
  const target = join(parent, 'home')
  const staging = join(parent, 'staging')
  const payload = join(staging, 'payload')
  const previous = join(staging, 'previous-home')
  mkdirSync(target, { recursive: true })
  mkdirSync(payload, { recursive: true })
  writeFileSync(join(target, 'old.txt'), 'old')
  writeFileSync(join(payload, 'new.txt'), 'new')
  const lock = await acquireHomeRestoreLock(target)
  let renameCount = 0

  expect(() =>
    installValidatedPayload(payload, target, staging, lock, {
      rename(source, destination) {
        renameCount++
        if (renameCount === 1) renameSync(source, destination)
        else throw new Error(renameCount === 2 ? 'install failed' : 'rollback failed')
      },
    }),
  ).toThrow(RestoreRecoveryRequiredError)
  lock.release()
  expect(existsSync(target)).toBe(false)
  expect(readFileSync(join(previous, 'old.txt'), 'utf8')).toBe('old')

  const runtimePath = daemonLivenessPath(target)
  const record = JSON.parse(readFileSync(runtimePath, 'utf8')) as Record<string, unknown>
  expect(record.state).toBe('recovery-required')
  expect(record.recoveryPath).toBe(previous)
  record.pid = await exitedProcessId()
  writeFileSync(runtimePath, `${JSON.stringify(record)}\n`)
  await expect(acquireHomeRestoreLock(target)).rejects.toThrow(/recovery data is at/)

  renameSync(previous, target)
  cleanupLivenessArtifacts(target)
  rmSync(parent, { recursive: true, force: true })
})
