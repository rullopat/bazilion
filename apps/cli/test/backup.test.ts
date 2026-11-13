import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { generateIdentity, identityToRecipient } from 'age-encryption'
import { create, extract, Header, list } from 'tar'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  loadProfile,
  openConfig,
  openDb,
  openSecrets,
  resolveAgent,
  resolvePaths,
  webTokenRepo,
} from '../../daemon/src/core/index.ts'
import { DAEMON_PID_FILE } from '../../daemon/src/lib/daemon-liveness.ts'
import { installRestoredHome } from '../src/commands/backup.ts'
import { extractAgentId, runCli } from './helpers.ts'
import { restartTestServer, startTestServer, type TestServer } from './server-fixture.ts'

const daemonEntry = join(import.meta.dirname, '..', '..', 'daemon', 'src', 'index.ts')

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

interface AppendedTarEntry {
  path: string
  type?: 'File' | 'SymbolicLink' | 'Link'
  body?: string
  linkpath?: string
}

/** Copy of a backup with extra raw tar entries appended (tar itself would refuse to write them). */
function appendTarEntries(source: string, entries: AppendedTarEntry[]): string {
  const raw = gunzipSync(readFileSync(source))
  let end = 0
  while (end + 512 <= raw.length) {
    const block = raw.subarray(end, end + 512)
    if (block.every((byte) => byte === 0)) break
    const header = new Header(block)
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
      size: entry.type && entry.type !== 'File' ? 0 : body.length,
      mtime: new Date(),
    })
    const headerBlock = Buffer.alloc(512)
    header.encode(headerBlock)
    appended.push(headerBlock)
    if (body.length > 0 && (entry.type ?? 'File') === 'File') {
      appended.push(body, Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length))
    }
  }
  appended.push(Buffer.alloc(1024))
  const output = join(tmpdir(), `bz-appended-${randomUUID()}.tar.gz`)
  writeFileSync(output, gzipSync(Buffer.concat(appended)))
  return output
}

/** Copy of a backup whose extracted files were changed by `mutate`. */
async function repack(archive: string, mutate: (dir: string) => void): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'bz-repack-'))
  try {
    await extract({ file: archive, cwd: dir })
    mutate(dir)
    const output = join(tmpdir(), `bz-repacked-${randomUUID()}.tar.gz`)
    await create({ file: output, cwd: dir, gzip: true, portable: true }, ['.'])
    return output
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function createBackup(): Promise<string> {
  const archive = join(tmpdir(), `bz-backup-${randomUUID()}.tar.gz`)
  const created = await server.cli(['backup', 'create', archive])
  expect(created.exitCode, created.stderr).toBe(0)
  return archive
}

/** A restore target `<parent>/home`; a private parent shows anything restore leaves behind. */
function makeTarget(withData = true): { parent: string; home: string; cleanup(): void } {
  const parent = mkdtempSync(join(tmpdir(), 'bz-restore-'))
  const home = join(parent, 'home')
  if (withData) {
    mkdirSync(home)
    writeFileSync(join(home, 'keep.txt'), 'original-data')
  }
  return { parent, home, cleanup: () => rmSync(parent, { recursive: true, force: true }) }
}

async function expectRefused(archive: string, message: RegExp, extraArgs = ['--force']) {
  const target = makeTarget()
  try {
    const restored = await runCli(
      ['backup', 'restore', archive, '--home', target.home, ...extraArgs],
      target.home,
    )
    expect(restored.exitCode).not.toBe(0)
    expect(restored.stderr).toMatch(message)
    expect(readdirSync(target.parent)).toEqual(['home'])
    expect(readdirSync(target.home)).toEqual(['keep.txt'])
  } finally {
    target.cleanup()
  }
}

async function exitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''])
  await new Promise((resolve) => child.on('close', resolve))
  return child.pid ?? 0
}

function tempEntries(prefix: string): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((entry) => entry.startsWith(prefix)))
}

test('backup create writes a tar.gz of the home around an online database snapshot', async () => {
  writeFileSync(join(server.home, 'marker.txt'), 'hello')
  writeFileSync(join(server.home, 'teams', 'default', 'memory', '.qmd-index.sqlite'), 'cache')
  mkdirSync(join(server.home, 'browsers', 'agent-x'), { recursive: true })
  writeFileSync(join(server.home, 'browsers', 'agent-x', 'cookies.db'), 'site-credentials')
  mkdirSync(join(server.home, 'teams', 'default', 'browsers'), { recursive: true })
  writeFileSync(join(server.home, 'teams', 'default', 'browsers', 'notes.txt'), 'work product')
  expect(existsSync(join(server.home, 'bazilion.db-wal'))).toBe(true)
  expect(existsSync(join(server.home, DAEMON_PID_FILE))).toBe(true)
  const archive = join(tmpdir(), `bz-backup-${randomUUID()}.tar.gz`)

  const created = await server.cli(['backup', 'create', archive])
  expect(created.exitCode, created.stderr).toBe(0)
  expect(created.stderr).toContain('not encrypted')
  expect(created.stdout).toContain(`backup written to ${archive}`)
  expect(existsSync(`${archive}.partial`)).toBe(false)

  const members: string[] = []
  await list({
    file: archive,
    onReadEntry: (entry) => members.push(entry.path.replace(/^\.\//, '')),
  })
  expect(members.filter((path) => path === 'bazilion.db')).toHaveLength(1)
  expect(members).toContain('marker.txt')
  expect(members).toContain('teams/default/browsers/notes.txt')
  for (const excluded of [
    'bazilion.db-wal',
    'bazilion.db-shm',
    DAEMON_PID_FILE,
    'teams/default/memory/.qmd-index.sqlite',
  ]) {
    expect(members).not.toContain(excluded)
  }
  // Browser profiles hold site logins and never leave the home.
  expect(members.some((path) => path === 'browsers' || path.startsWith('browsers/'))).toBe(false)
  rmSync(archive, { force: true })
})

test('restore installs a backup into a new home that the daemon then starts on', async () => {
  writeFileSync(join(server.home, 'marker.txt'), 'restored-value')
  const profile = await server.cli(['profile', 'create', 'kept', '--model', 'lmstudio:test-model'])
  expect(profile.exitCode, profile.stderr).toBe(0)
  const spawned = await server.cli(['agent', 'spawn', '--profile', 'kept', '--name', 'Kept Agent'])
  expect(spawned.exitCode, spawned.stderr).toBe(0)
  const agentId = extractAgentId(spawned.stdout)
  for (const [key, value] of [
    ['LMSTUDIO_URL', 'http://backup-config.example/v1'],
    ['OPENAI_API_KEY', 'backup-secret-value'],
  ] as const) {
    expect((await server.cli(['config', 'set', key, value])).exitCode).toBe(0)
  }
  writeFileSync(join(server.home, 'agents', agentId, 'sessions', 'proof.jsonl'), '{"ok":true}\n')
  writeFileSync(join(server.home, 'teams', 'default', 'memory', 'proof.md'), '# shared memory\n')
  mkdirSync(join(server.home, 'skills', 'backup-skill'))
  writeFileSync(join(server.home, 'skills', 'backup-skill', 'SKILL.md'), '# Backup skill\n')
  const archive = await createBackup()

  const target = makeTarget(false)
  const restored = await runCli(['backup', 'restore', archive, '--home', target.home], target.home)
  expect(restored.exitCode, restored.stderr).toBe(0)
  expect(restored.stdout).toContain(`restored ${archive} to ${target.home}`)
  expect(readdirSync(target.parent)).toEqual(['home'])
  expect(readdirSync(target.home).filter((entry) => entry.startsWith('bazilion.db'))).toEqual([
    'bazilion.db',
  ])
  expect(readFileSync(join(target.home, 'marker.txt'), 'utf8')).toBe('restored-value')
  expect(
    readFileSync(join(target.home, 'agents', agentId, 'sessions', 'proof.jsonl'), 'utf8'),
  ).toBe('{"ok":true}\n')
  expect(readFileSync(join(target.home, 'teams', 'default', 'memory', 'proof.md'), 'utf8')).toBe(
    '# shared memory\n',
  )
  expect(readFileSync(join(target.home, 'skills', 'backup-skill', 'SKILL.md'), 'utf8')).toBe(
    '# Backup skill\n',
  )
  const auth = JSON.parse(readFileSync(join(target.home, 'auth.json'), 'utf8')) as { token: string }
  expect(auth.token).toBe(server.token)
  // Owner-only, whatever modes the archive carried.
  expect(statSync(target.home).mode & 0o777).toBe(0o700)
  for (const name of ['auth.json', 'bazilion.db']) {
    expect(statSync(join(target.home, name)).mode & 0o777).toBe(0o600)
  }

  // Agent and Profile directories follow the home the database now lives in.
  const paths = resolvePaths(target.home)
  const db = openDb(paths.db)
  try {
    expect(loadProfile(db, 'kept').profile.dir).toBe(paths.profileDir('kept'))
    expect(resolveAgent(db, paths, agentId).agent.dir).toBe(paths.agentDir(agentId))
    expect(openConfig(db).get('LMSTUDIO_URL')).toBe('http://backup-config.example/v1')
    expect(openSecrets(db, auth.token).get('OPENAI_API_KEY')).toBe('backup-secret-value')
  } finally {
    db.close()
  }

  const restoredServer = await restartTestServer({ home: target.home, token: auth.token })
  try {
    expect(existsSync(join(target.home, DAEMON_PID_FILE))).toBe(true)
    const agents = await restoredServer.cli(['agent', 'list'])
    expect(agents.exitCode, agents.stderr).toBe(0)
    expect(agents.stdout).toContain('Kept Agent')
  } finally {
    await restoredServer.stop({ keepHome: true })
  }
  // A graceful shutdown (SIGTERM) releases the home.
  expect(existsSync(join(target.home, DAEMON_PID_FILE))).toBe(false)
  rmSync(archive, { force: true })
  target.cleanup()
})

test('an encrypted backup round-trips through its age identity', async () => {
  const marker = `encrypted-marker-${randomUUID()}`
  writeFileSync(join(server.home, 'encrypted-proof.txt'), marker)
  const live = openDb(resolvePaths(server.home).db)
  const device = webTokenRepo.create(live, 'preserved-device')
  live.close()
  const identity = await generateIdentity()
  const encrypted = join(tmpdir(), `bz-backup-${randomUUID()}.tar.gz.age`)
  const identityFile = join(tmpdir(), `bz-identity-${randomUUID()}.txt`)
  writeFileSync(identityFile, `# created: test\n${identity}\n`, { mode: 0o600 })

  const created = await server.cli([
    'backup',
    'create',
    encrypted,
    '--recipient',
    await identityToRecipient(identity),
  ])
  expect(created.exitCode, created.stderr).toBe(0)
  expect(created.stderr).not.toContain('not encrypted')
  const ciphertext = readFileSync(encrypted)
  expect(ciphertext.subarray(0, 22).toString('ascii')).toBe('age-encryption.org/v1\n')
  expect(ciphertext.includes(Buffer.from(marker))).toBe(false)
  expect(ciphertext.includes(Buffer.from('SQLite format 3'))).toBe(false)

  const target = makeTarget(false)
  const withoutIdentity = await runCli(
    ['backup', 'restore', encrypted, '--home', target.home],
    target.home,
  )
  expect(withoutIdentity.exitCode).not.toBe(0)
  expect(withoutIdentity.stderr).toContain('this backup is encrypted; pass --identity')
  const restored = await runCli(
    ['backup', 'restore', encrypted, '--identity', identityFile, '--home', target.home],
    target.home,
  )
  expect(restored.exitCode, restored.stderr).toBe(0)
  expect(readFileSync(join(target.home, 'encrypted-proof.txt'), 'utf8')).toBe(marker)
  const restoredDb = openDb(resolvePaths(target.home).db)
  expect(webTokenRepo.findActiveByToken(restoredDb, device.token)?.label).toBe('preserved-device')
  restoredDb.close()

  rmSync(encrypted, { force: true })
  rmSync(identityFile, { force: true })
  target.cleanup()
})

test('a wrong identity or modified ciphertext leaves the target home untouched', async () => {
  const identity = await generateIdentity()
  const encrypted = join(tmpdir(), `bz-backup-${randomUUID()}.tar.gz.age`)
  const identityFile = join(tmpdir(), `bz-identity-${randomUUID()}.txt`)
  const wrongIdentityFile = join(tmpdir(), `bz-wrong-identity-${randomUUID()}.txt`)
  writeFileSync(identityFile, `${identity}\n`, { mode: 0o600 })
  const wrongIdentity = await generateIdentity()
  writeFileSync(wrongIdentityFile, `${wrongIdentity}\n`, { mode: 0o600 })
  const created = await server.cli([
    'backup',
    'create',
    encrypted,
    '--recipient',
    await identityToRecipient(identity),
  ])
  expect(created.exitCode, created.stderr).toBe(0)

  const wrong = ['--force', '--identity', wrongIdentityFile]
  await expectRefused(encrypted, /could not decrypt the backup/, wrong)
  const tampered = readFileSync(encrypted)
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1
  writeFileSync(encrypted, tampered)
  await expectRefused(encrypted, /could not decrypt the backup/, [
    '--force',
    '--identity',
    identityFile,
  ])

  for (const file of [encrypted, identityFile, wrongIdentityFile]) rmSync(file, { force: true })
})

test('a cancelled backup download releases its online snapshot', async () => {
  const largeFile = join(server.home, 'cancel-proof.bin')
  writeFileSync(largeFile, randomBytes(4 * 1024 * 1024))
  const before = tempEntries('bazilion-backup-')

  const response = await fetch(`${server.url}/api/backup`, {
    headers: { authorization: `Bearer ${server.token}`, origin: server.url },
  })
  expect(response.status).toBe(200)
  const reader = response.body?.getReader()
  await reader?.read()
  await reader?.cancel('test cancellation')

  const leaked = () => [...tempEntries('bazilion-backup-')].filter((entry) => !before.has(entry))
  for (let attempt = 0; attempt < 20 && leaked().length > 0; attempt++) await delay(25)
  expect(leaked()).toEqual([])
  rmSync(largeFile, { force: true })
})

test('restore keeps a linked Team as a link to its external target', async () => {
  const external = mkdtempSync(join(tmpdir(), 'bz-linked-team-target-'))
  writeFileSync(join(external, 'external.txt'), 'outside the backup')
  const added = await server.cli(['team', 'add', 'portable-link', '--link', external])
  expect(added.exitCode, added.stderr).toBe(0)
  const archive = await createBackup()

  const target = makeTarget(false)
  const restored = await runCli(['backup', 'restore', archive, '--home', target.home], target.home)
  expect(restored.exitCode, restored.stderr).toBe(0)
  const slot = join(target.home, 'teams', 'portable-link')
  expect(lstatSync(slot).isSymbolicLink()).toBe(true)
  expect(readlinkSync(slot)).toBe(external)
  expect(readFileSync(join(external, 'external.txt'), 'utf8')).toBe('outside the backup')

  rmSync(archive, { force: true })
  target.cleanup()
  rmSync(external, { recursive: true, force: true })
})

test('restore keeps relative symbolic links inside Team work product', async () => {
  const notes = join(server.home, 'teams', 'default', 'notes')
  mkdirSync(notes)
  writeFileSync(join(notes, 'current.md'), '# Current notes\n')
  symlinkSync('current.md', join(notes, 'latest.md'), 'file')
  const archive = await createBackup()

  const target = makeTarget(false)
  const restored = await runCli(['backup', 'restore', archive, '--home', target.home], target.home)
  expect(restored.exitCode, restored.stderr).toBe(0)
  const link = join(target.home, 'teams', 'default', 'notes', 'latest.md')
  expect(readlinkSync(link)).toBe('current.md')
  expect(readFileSync(link, 'utf8')).toBe('# Current notes\n')

  rmSync(archive, { force: true })
  target.cleanup()
})

test('backup create refuses an output inside the home or over an existing file', async () => {
  const inside = join(server.home, 'local-backup.tar.gz')
  const nested = await server.cli(['backup', 'create', inside])
  expect(nested.exitCode).not.toBe(0)
  expect(nested.stderr).toContain('write the backup outside the Bazilion home')
  expect(existsSync(inside)).toBe(false)

  const scratch = mkdtempSync(join(tmpdir(), 'bz-existing-'))
  const existing = join(scratch, 'backup.tar.gz')
  writeFileSync(existing, 'existing-good-backup')
  const overwrite = await server.cli(['backup', 'create', existing])
  expect(overwrite.exitCode).not.toBe(0)
  expect(overwrite.stderr).toContain('refusing to overwrite')
  expect(readFileSync(existing, 'utf8')).toBe('existing-good-backup')

  // A .partial file someone else placed is neither written to nor removed.
  const planted = join(scratch, 'planted.tar.gz')
  writeFileSync(`${planted}.partial`, 'not yours')
  const partial = await server.cli(['backup', 'create', planted])
  expect(partial.exitCode).not.toBe(0)
  expect(partial.stderr).toContain('already exists')
  expect(readFileSync(`${planted}.partial`, 'utf8')).toBe('not yours')
  expect(existsSync(planted)).toBe(false)
  rmSync(scratch, { recursive: true, force: true })
})

test('a download that ends early leaves no backup behind', async () => {
  const complete = await createBackup()
  const prefix = readFileSync(complete).subarray(0, Math.floor(statSync(complete).size / 2))
  // A clean end of a short body looks like success at the HTTP level.
  const shortServer = createHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/gzip' })
    response.end(prefix)
  })
  await new Promise<void>((resolve) => shortServer.listen(0, '127.0.0.1', resolve))
  const scratch = mkdtempSync(join(tmpdir(), 'bz-short-download-'))
  try {
    const result = await server.cli(['backup', 'create', join(scratch, 'backup.tar.gz')], {
      BAZILION_SERVER: `http://127.0.0.1:${(shortServer.address() as AddressInfo).port}`,
      BAZILION_TOKEN: 'test-token',
    })
    expect(result.exitCode).not.toBe(0)
    expect(readdirSync(scratch)).toEqual([])
  } finally {
    await new Promise((resolve) => shortServer.close(resolve))
    rmSync(scratch, { recursive: true, force: true })
    rmSync(complete, { force: true })
  }
})

test('restore needs --force for a non-empty home and then replaces it', async () => {
  writeFileSync(join(server.home, 'fresh.txt'), 'from-backup')
  const archive = await createBackup()
  await expectRefused(archive, /not empty; pass --force/, [])

  const target = makeTarget()
  // A pidfile naming a dead process is stale and does not block the restore.
  writeFileSync(join(target.home, DAEMON_PID_FILE), `${await exitedProcessId()}\n`)
  const restored = await runCli(
    ['backup', 'restore', archive, '--home', target.home, '--force'],
    target.home,
  )
  expect(restored.exitCode, restored.stderr).toBe(0)
  expect(restored.stdout).toContain(`moving the current home aside to ${target.home}.pre-restore-`)
  expect(readdirSync(target.parent)).toEqual(['home'])
  expect(existsSync(join(target.home, 'keep.txt'))).toBe(false)
  expect(existsSync(join(target.home, DAEMON_PID_FILE))).toBe(false)
  expect(readFileSync(join(target.home, 'fresh.txt'), 'utf8')).toBe('from-backup')

  rmSync(archive, { force: true })
  target.cleanup()
})

test('restore and a second daemon refuse a home whose daemon is running', async () => {
  const archive = await createBackup()
  const pid = readFileSync(join(server.home, DAEMON_PID_FILE), 'utf8').trim()
  const restored = await runCli(
    ['backup', 'restore', archive, '--home', server.home, '--force'],
    server.home,
  )
  expect(restored.exitCode).not.toBe(0)
  expect(restored.stderr).toContain(`a bazilion daemon (pid ${pid}) is running on ${server.home}`)

  const second = spawn(process.execPath, ['--import', 'tsx/esm', daemonEntry], {
    env: { ...process.env, BAZILION_HOME: server.home, HOST: '127.0.0.1', PORT: '0' },
  })
  let stderr = ''
  second.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const code = await new Promise((resolve) => second.on('close', resolve))
  expect(code).toBe(1)
  expect(stderr).toContain(`a bazilion daemon (pid ${pid}) is running`)
  expect(readFileSync(join(server.home, DAEMON_PID_FILE), 'utf8').trim()).toBe(pid)
  expect((await fetch(`${server.url}/api/health`)).ok).toBe(true)
  rmSync(archive, { force: true })
})

test('restore refuses a missing file and the filesystem root', async () => {
  const target = makeTarget()
  const missing = await runCli(
    ['backup', 'restore', '/definitely/not/a/real/path.tar.gz', '--home', target.home],
    target.home,
  )
  expect(missing.exitCode).not.toBe(0)
  expect(missing.stderr).toContain('backup file not found')
  target.cleanup()

  const archive = await createBackup()
  const root = await runCli(['backup', 'restore', archive, '--home', '../'.repeat(64)], tmpdir())
  expect(root.exitCode).not.toBe(0)
  expect(root.stderr).toContain('refusing to restore over the filesystem root')
  rmSync(archive, { force: true })
})

test('parallel online backups stay consistent during concurrent WAL writes', async () => {
  // A real WAL writer waits for the backup's brief source locks instead of failing at once.
  const liveDb = new DatabaseSync(join(server.home, 'bazilion.db'), { timeout: 5_000 })
  liveDb.exec("PRAGMA journal_mode = WAL; DELETE FROM config WHERE key LIKE 'backup_probe_%';")
  const writer = (async () => {
    for (let id = 1; id <= 150; id++) {
      liveDb.exec('BEGIN IMMEDIATE')
      const insert = liveDb.prepare('INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)')
      insert.run(`backup_probe_left_${id}`, String(id), Date.now())
      insert.run(`backup_probe_right_${id}`, String(id), Date.now())
      liveDb.exec('COMMIT')
      await delay(2)
    }
  })()
  const archives = await Promise.all([createBackup(), createBackup(), writer])
  liveDb.close()

  for (const archive of archives.slice(0, 2) as string[]) {
    const target = makeTarget(false)
    const restored = await runCli(['backup', 'restore', archive, '--home', target.home], tmpdir())
    expect(restored.exitCode, restored.stderr).toBe(0)
    const snapshot = new DatabaseSync(join(target.home, 'bazilion.db'), { readOnly: true })
    const count = (side: string) =>
      (
        snapshot
          .prepare(`SELECT COUNT(*) AS count FROM config WHERE key LIKE 'backup_probe_${side}_%'`)
          .get() as { count: number }
      ).count
    expect(count('left')).toBeGreaterThan(0)
    expect(count('left')).toBe(count('right'))
    snapshot.close()
    target.cleanup()
    rmSync(archive, { force: true })
  }
})

test.each([
  [
    'a damaged database',
    (dir: string) => writeFileSync(join(dir, 'bazilion.db'), 'this is not a SQLite database'),
    /backup database is unusable/,
  ],
  [
    'a database with another schema',
    (dir: string) => {
      const db = new DatabaseSync(join(dir, 'bazilion.db'))
      db.exec('DROP TABLE team_template_edges')
      db.close()
    },
    /schema differs from this release/,
  ],
  [
    'an auth.json that is not the database bootstrap token',
    (dir: string) => {
      writeFileSync(join(dir, 'auth.json'), `${JSON.stringify({ token: 'wrong-token' })}\n`)
      // An active device token is not enough: auth.json must hold the bootstrap token.
      const db = new DatabaseSync(join(dir, 'bazilion.db'))
      db.prepare(
        `INSERT INTO web_tokens (id, label, kind, token_hash, created_at, expires_at)
         VALUES (?, 'secondary', 'device', ?, ?, ?)`,
      ).run(
        randomUUID(),
        createHash('sha256').update('wrong-token').digest('hex'),
        Date.now(),
        Date.now() + 86_400_000,
      )
      db.close()
    },
    /auth\.json does not match the database/,
  ],
  [
    'an archive without auth.json',
    (dir: string) => rmSync(join(dir, 'auth.json')),
    /backup is missing auth\.json/,
  ],
])('restore refuses %s and leaves the target untouched', async (_name, mutate, message) => {
  const valid = await createBackup()
  const broken = await repack(valid, mutate)
  await expectRefused(broken, message)
  rmSync(valid, { force: true })
  rmSync(broken, { force: true })
})

test('restore refuses a truncated archive and leaves the target untouched', async () => {
  const archive = await createBackup()
  truncateSync(archive, Math.floor(statSync(archive).size / 2))
  await expectRefused(archive, /unexpected end of file/)
  rmSync(archive, { force: true })
})

test.each([
  ['a path leaving the home', [{ path: '../escaped.txt', body: 'x' }], /unsafe path/],
  ['an absolute path', [{ path: '/tmp/bz-absolute.txt', body: 'x' }], /unsafe path/],
  ['a hard link', [{ path: 'hard', type: 'Link', linkpath: 'auth.json' }], /unsupported Link/],
  [
    'an absolute link outside a Team slot',
    [{ path: 'notes/link', type: 'SymbolicLink', linkpath: tmpdir() }],
    /symbolic link leaving the home: notes\/link/,
  ],
  [
    'a relative link leaving the home',
    [{ path: 'teams/default/escape', type: 'SymbolicLink', linkpath: '../../../outside' }],
    /symbolic link leaving the home: teams\/default\/escape/,
  ],
  [
    'an entry below a linked Team slot',
    [
      { path: 'teams/linked', type: 'SymbolicLink', linkpath: tmpdir() },
      { path: 'teams/linked/escaped.txt', body: 'must not follow the link' },
    ],
    /backup places teams\/linked\/escaped\.txt below a symbolic link/,
  ],
] as const)('restore refuses an archive with %s', async (_name, entries, message) => {
  const valid = await createBackup()
  const hostile = appendTarEntries(valid, [...entries])
  await expectRefused(hostile, message)
  expect(existsSync('/tmp/bz-absolute.txt')).toBe(false)
  rmSync(valid, { force: true })
  rmSync(hostile, { force: true })
})

test('a failed swap puts the previous home back', () => {
  const target = makeTarget()
  expect(() => installRestoredHome(join(target.parent, 'missing'), target.home)).toThrow()
  expect(readdirSync(target.parent)).toEqual(['home'])
  expect(readFileSync(join(target.home, 'keep.txt'), 'utf8')).toBe('original-data')
  target.cleanup()
})
