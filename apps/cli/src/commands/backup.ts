import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, parse, posix, relative, resolve } from 'node:path'
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Decrypter, Encrypter } from 'age-encryption'
import { defineCommand } from 'citty'
import { extract, list, type ReadEntry } from 'tar'
import { assertCanonicalBackupSchema } from '../backup-schema.ts'
import { loadClientConfig } from '../client.ts'
import { acquireHomeRestoreLock, DAEMON_LIVENESS_FILENAME } from '../daemon-liveness.ts'
import { resolveCliPaths } from '../paths.ts'

const createCmd = defineCommand({
  meta: { name: 'create', description: 'Create a client-side encrypted backup of ~/.bazilion' },
  args: {
    output: {
      type: 'positional',
      required: false,
      description: 'Output path (default: .tar.gz.age with --recipient, otherwise .tar.gz)',
    },
    recipient: {
      type: 'string',
      description: 'age recipient (age1… or age1pq1…); encrypts before writing output',
    },
    plaintext: {
      type: 'boolean',
      description: 'Explicitly permit a sensitive unencrypted .tar.gz backup',
    },
  },
  async run({ args }) {
    if (args.recipient && args.plaintext) {
      throw new Error('--recipient and --plaintext are mutually exclusive')
    }
    if (!args.recipient && !args.plaintext) {
      throw new Error('choose --recipient <age1…> for encryption or explicitly pass --plaintext')
    }
    const cfg = loadClientConfig()
    const date = new Date().toISOString().slice(0, 10)
    const defaultSuffix = args.recipient ? '.tar.gz.age' : '.tar.gz'
    const outAbs = resolve(args.output ?? `bazilion-backup-${date}${defaultSuffix}`)
    if (existsSync(outAbs)) throw new Error(`refusing to overwrite existing backup: ${outAbs}`)
    const configuredHome = resolve(resolveCliPaths().home)
    const outputFromHome = relative(configuredHome, outAbs)
    if (!outputFromHome || (!outputFromHome.startsWith('..') && !isAbsolute(outputFromHome))) {
      throw new Error(
        `backup output must be outside BAZILION_HOME (${configuredHome}) to avoid nesting backups`,
      )
    }

    if (!args.recipient) {
      console.warn('warning: creating a plaintext backup containing all Bazilion credentials')
    }
    console.log(`${args.recipient ? 'encrypting' : 'downloading'} backup → ${outAbs}`)
    const res = await fetch(`${cfg.serverUrl}/api/backup`, {
      headers: { authorization: `Bearer ${cfg.token}`, origin: cfg.serverUrl },
    })
    if (!res.ok || !res.body) {
      let err: string = res.statusText
      try {
        const body = (await res.json()) as { error?: string }
        err = body.error ?? err
      } catch {}
      throw new Error(`backup failed: ${err}`)
    }
    // Keep the in-progress download in OS temp so a failed/cancelled transfer
    // never leaves a partial alongside the requested destination.
    const downloadDir = mkdtempSync(resolve(tmpdir(), 'bazilion-download-'))
    const partial = resolve(downloadDir, 'backup.tar.gz')
    try {
      if (args.recipient) {
        const [encryptSource, validateSource] = res.body.tee()
        const encrypter = new Encrypter()
        encrypter.addRecipient(args.recipient)
        const encrypted = await encrypter.encrypt(encryptSource)
        await Promise.all([
          pipeline(
            Readable.fromWeb(encrypted),
            createWriteStream(partial, { flags: 'wx', mode: 0o600 }),
          ),
          validateArchiveReadable(Readable.fromWeb(validateSource)),
        ])
      } else {
        await pipeline(
          Readable.fromWeb(res.body),
          createWriteStream(partial, { flags: 'wx', mode: 0o600 }),
        )
      }
      // A server/proxy can end a response cleanly after delivering only a
      // prefix. Parse the complete download before it can replace a known-good
      // output file or be reported as usable.
      if (!args.recipient) await validateArchive(partial)
      try {
        renameSync(partial, outAbs)
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EXDEV') throw error
        // Cross-device rename (commonly a separate /tmp filesystem): copy the
        // complete archive to a sibling, then atomically install that sibling.
        const installPartial = resolve(
          dirname(outAbs),
          `.${basename(outAbs)}.${randomUUID()}.installing`,
        )
        try {
          copyFileSync(partial, installPartial)
          chmodSync(installPartial, 0o600)
          renameSync(installPartial, outAbs)
        } finally {
          rmSync(installPartial, { force: true })
        }
      }
    } finally {
      rmSync(downloadDir, { recursive: true, force: true })
    }
    console.log('done')
  },
})

/**
 * Offline restore. Server must be stopped first — SQLite's DB files would get
 * corrupted if the running daemon has them open while tar overwrites them.
 * We check the default and configured loopback URLs as a best-effort safety
 * net, including daemons bound to a custom port.
 */
async function probeServerRunning(serverUrl: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 500)
    try {
      // /api/health is public — any HTTP response means the configured daemon
      // endpoint is live, without depending on the home token being readable.
      const res = await fetch(new URL('/api/health', serverUrl), { signal: ctrl.signal })
      return res.status >= 200 && res.status < 600
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

function loopbackServerUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const hostname = url.hostname.toLowerCase()
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) return null
    return url.origin
  } catch {
    return null
  }
}

function configuredLoopbackUrls(): string[] {
  const urls = new Set<string>(['http://127.0.0.1:4321'])
  const envUrl = loopbackServerUrl(process.env.BAZILION_SERVER)
  if (envUrl) urls.add(envUrl)
  try {
    const clientUrl = loopbackServerUrl(loadClientConfig().serverUrl)
    if (clientUrl) urls.add(clientUrl)
  } catch {
    // A missing/corrupt current auth file must not suppress the default probe.
  }
  return [...urls]
}

interface ArchiveEntry {
  path: string
  type: ReadEntry['type']
  linkpath?: string
}

const EXTRACTABLE_ENTRY_TYPES = new Set<ReadEntry['type']>([
  'File',
  'OldFile',
  'Directory',
  'SymbolicLink',
])

function normalizeArchivePath(rawPath: string): string {
  if (!rawPath || rawPath.includes('\0')) throw new Error('backup contains an invalid empty path')
  // Backslashes are path separators on Windows but ordinary characters on
  // POSIX. Reject them so one archive has the same containment semantics on
  // every platform Bazilion supports.
  if (rawPath.includes('\\')) {
    throw new Error(`backup contains a non-portable path: ${JSON.stringify(rawPath)}`)
  }
  if (rawPath.startsWith('/') || /^[A-Za-z]:/.test(rawPath)) {
    throw new Error(`backup contains an absolute path: ${JSON.stringify(rawPath)}`)
  }

  const segments: string[] = []
  for (const segment of rawPath.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      throw new Error(`backup path escapes the restore directory: ${JSON.stringify(rawPath)}`)
    }
    segments.push(segment)
  }
  return segments.join('/')
}

function validateArchiveSymbolicLink(path: string, rawTarget: string | undefined): void {
  if (!rawTarget || rawTarget.includes('\0')) {
    throw new Error(`backup contains an invalid symbolic link target: ${path}`)
  }

  const segments = path.split('/')
  const isTeamSlot =
    segments.length === 2 &&
    segments[0] === 'teams' &&
    /^[a-z0-9][a-z0-9-]*$/.test(segments[1] ?? '')

  // A registered linked Team is the one intentional external-link shape in
  // a Bazilion home. Preserve its host-native absolute target, but never
  // admit absolute links at arbitrary archive paths.
  const portableTarget = rawTarget.replaceAll('\\', '/')
  const absoluteOnAnyPlatform =
    isAbsolute(rawTarget) || posix.isAbsolute(portableTarget) || /^[A-Za-z]:\//.test(portableTarget)
  if (absoluteOnAnyPlatform) {
    if (!isTeamSlot) {
      throw new Error(`backup absolute symbolic links are only allowed for Team slots: ${path}`)
    }
    if (!isAbsolute(rawTarget)) {
      throw new Error(`backup contains an invalid Team link target: ${path}`)
    }
    return
  }

  // Team slots are registered with absolute targets so their identity does
  // not change when the Bazilion home moves. Other relative links are normal
  // work product; accept them only when their portable lexical target remains
  // inside the archive root. Entries beneath every symlink remain forbidden
  // by the complete-archive shape check below.
  if (isTeamSlot) {
    throw new Error(`backup contains an invalid Team link target: ${path}`)
  }
  if (/^[A-Za-z]:/.test(portableTarget)) {
    throw new Error(`backup contains a non-portable symbolic link target: ${path}`)
  }
  const target = posix.normalize(posix.join(posix.dirname(path), portableTarget))
  if (target === '..' || target.startsWith('../') || posix.isAbsolute(target)) {
    throw new Error(`backup symbolic link target escapes the restore directory: ${path}`)
  }
}

async function validateArchive(file: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = []
  await list({
    file,
    strict: true,
    onentry(entry) {
      if (entry.meta) return
      const path = normalizeArchivePath(entry.path)
      if (!path) return
      if (!EXTRACTABLE_ENTRY_TYPES.has(entry.type)) {
        throw new Error(`backup contains unsupported ${entry.type} entry: ${path}`)
      }
      if (entry.type === 'SymbolicLink') {
        validateArchiveSymbolicLink(path, entry.linkpath)
      }
      entries.push({ path, type: entry.type, linkpath: entry.linkpath })
    },
  })

  return validateArchiveEntries(entries)
}

async function validateArchiveReadable(stream: Readable): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = []
  const parser = list({
    strict: true,
    onentry(entry) {
      if (entry.meta) return
      const path = normalizeArchivePath(entry.path)
      if (!path) return
      if (!EXTRACTABLE_ENTRY_TYPES.has(entry.type)) {
        throw new Error(`backup contains unsupported ${entry.type} entry: ${path}`)
      }
      if (entry.type === 'SymbolicLink') validateArchiveSymbolicLink(path, entry.linkpath)
      entries.push({ path, type: entry.type, linkpath: entry.linkpath })
    },
  })
  await pipeline(stream, parser)
  return validateArchiveEntries(entries)
}

function validateArchiveEntries(entries: ArchiveEntry[]): ArchiveEntry[] {
  const byPath = new Map<string, ArchiveEntry>()
  for (const entry of entries) {
    if (byPath.has(entry.path)) throw new Error(`backup contains a duplicate path: ${entry.path}`)
    byPath.set(entry.path, entry)
  }

  const symlinks = new Set(
    entries.filter((entry) => entry.type === 'SymbolicLink').map((entry) => entry.path),
  )
  for (const entry of entries) {
    const segments = entry.path.split('/')
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join('/')
      if (symlinks.has(ancestor)) {
        throw new Error(`backup entry traverses symbolic link ${ancestor}: ${entry.path}`)
      }
      const ancestorEntry = byPath.get(ancestor)
      if (ancestorEntry && ancestorEntry.type !== 'Directory') {
        throw new Error(`backup entry traverses non-directory ${ancestor}: ${entry.path}`)
      }
    }
  }

  for (const required of ['bazilion.db', 'auth.json']) {
    const entry = byPath.get(required)
    if (!entry || (entry.type !== 'File' && entry.type !== 'OldFile')) {
      throw new Error(`backup is missing required regular file: ${required}`)
    }
  }
  for (const transient of [
    'bazilion.db-wal',
    'bazilion.db-shm',
    'bazilion.db-journal',
    DAEMON_LIVENESS_FILENAME,
  ]) {
    if (byPath.has(transient)) {
      throw new Error(`backup contains unsafe transient SQLite file: ${transient}`)
    }
  }

  return entries
}

function validateAuthFile(path: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`backup auth.json is invalid: ${detail}`)
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('token' in parsed) ||
    typeof parsed.token !== 'string' ||
    !parsed.token.trim()
  ) {
    throw new Error('backup auth.json is invalid: token is missing')
  }
  return parsed.token
}

function validateDatabase(path: string, authToken: string): void {
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(path, { readOnly: true })
    const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check: string
    }>
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      const detail = integrity.map((row) => row.integrity_check).join('; ') || 'no result'
      throw new Error(`integrity_check failed: ${detail}`)
    }

    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all()
    if (foreignKeyErrors.length > 0) {
      throw new Error(`foreign_key_check failed with ${foreignKeyErrors.length} violation(s)`)
    }

    assertCanonicalBackupSchema(db)

    const tokenHash = createHash('sha256').update(authToken).digest('hex')
    const activeBootstrap = db
      .prepare(
        `SELECT 1 FROM web_tokens
         WHERE token_hash = ? AND kind = 'bootstrap' AND revoked_at IS NULL
         LIMIT 1`,
      )
      .get(tokenHash)
    if (!activeBootstrap) {
      throw new Error('auth.json token does not match an active web_tokens row')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('backup database is invalid:')) {
      throw error
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`backup database is invalid: ${detail}`)
  } finally {
    db?.close()
  }
}

interface StoredEntityId {
  id: unknown
}

const SLUG_ID = /^[a-z0-9][a-z0-9-]*$/
const AGENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function validateEntityId(id: unknown, pattern: RegExp, entity: string): string {
  if (typeof id !== 'string' || !pattern.test(id)) {
    throw new Error(`${entity} has an invalid canonical id: ${JSON.stringify(id)}`)
  }
  return id
}

function containedChildDirectory(root: string, id: string, rowLabel: string): string {
  const child = resolve(root, id)
  const fromRoot = relative(root, child)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`${rowLabel} directory escapes its canonical root: ${JSON.stringify(id)}`)
  }
  return child
}

function requireExtractedDirectory(path: string, rowLabel: string): void {
  try {
    if (lstatSync(path).isDirectory()) return
  } catch {
    // Replace the platform-specific lstat error with one stable restore error.
  }
  throw new Error(`${rowLabel} is missing its canonical directory in the backup`)
}

function requireExtractedTeamSlot(path: string, rowLabel: string): void {
  try {
    const entry = lstatSync(path)
    if (entry.isDirectory() || entry.isSymbolicLink()) return
  } catch {
    // Replace the platform-specific lstat error with one stable restore error.
  }
  throw new Error(`${rowLabel} is missing its canonical Team slot in the backup`)
}

/**
 * `profiles.dir` and `agents.dir` are operational filesystem paths used by
 * daemon loaders, tools, sessions, and deletion. A backup can be restored on
 * another machine or under another --home, so source-home values must never
 * survive installation. Validate every DB-derived path component first, then
 * rewrite the staged DB to the final target paths before the atomic swap.
 */
function rebaseRestoredHomeDirectories(
  database: string,
  payload: string,
  targetHome: string,
): void {
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(database)
    db.exec('PRAGMA foreign_keys = ON')

    const profiles = db
      .prepare('SELECT id FROM profiles ORDER BY id')
      .all() as unknown as StoredEntityId[]
    const agents = db
      .prepare('SELECT id FROM agents ORDER BY id')
      .all() as unknown as StoredEntityId[]
    const teams = db
      .prepare('SELECT id FROM teams ORDER BY id')
      .all() as unknown as StoredEntityId[]

    const rewrites: Array<{ table: 'profiles' | 'agents'; id: string; dir: string }> = []
    for (const [table, rows, idPattern] of [
      ['profiles', profiles, SLUG_ID],
      ['agents', agents, AGENT_ID],
    ] as const) {
      const collection = table
      const stagedRoot = resolve(payload, collection)
      const targetRoot = resolve(targetHome, collection)
      for (const row of rows) {
        const id = validateEntityId(row.id, idPattern, `${table} row`)
        const rowLabel = `${table} row ${JSON.stringify(id)}`
        const stagedDir = containedChildDirectory(stagedRoot, id, rowLabel)
        requireExtractedDirectory(stagedDir, rowLabel)
        rewrites.push({
          table,
          id,
          dir: containedChildDirectory(targetRoot, id, rowLabel),
        })
      }
    }

    // Team paths are already derived from the active home at runtime, so
    // they need no DB rewrite. Their DB IDs are nevertheless path components;
    // validate them and require the archived canonical slot without following
    // an intentionally external linked-Team target.
    const stagedTeamsRoot = resolve(payload, 'teams')
    for (const row of teams) {
      const id = validateEntityId(row.id, SLUG_ID, 'teams row')
      const rowLabel = `teams row ${JSON.stringify(id)}`
      requireExtractedTeamSlot(containedChildDirectory(stagedTeamsRoot, id, rowLabel), rowLabel)
    }

    // Force all mutations into the canonical DB file. The daemon will switch
    // the installed DB back to WAL on startup; restore must not install a
    // private staging WAL/SHM tuple alongside it.
    db.exec('PRAGMA journal_mode = DELETE')
    db.exec('PRAGMA synchronous = FULL')
    let transactionOpen = false
    try {
      db.exec('BEGIN IMMEDIATE')
      transactionOpen = true
      const updateProfile = db.prepare('UPDATE profiles SET dir = ? WHERE id = ?')
      const updateAgent = db.prepare('UPDATE agents SET dir = ? WHERE id = ?')
      for (const rewrite of rewrites) {
        const result =
          rewrite.table === 'profiles'
            ? updateProfile.run(rewrite.dir, rewrite.id)
            : updateAgent.run(rewrite.dir, rewrite.id)
        if (result.changes !== 1) {
          throw new Error(`could not rebase ${rewrite.table} row ${JSON.stringify(rewrite.id)}`)
        }
      }

      const readProfile = db.prepare('SELECT dir FROM profiles WHERE id = ?')
      const readAgent = db.prepare('SELECT dir FROM agents WHERE id = ?')
      for (const rewrite of rewrites) {
        const row = (
          rewrite.table === 'profiles' ? readProfile.get(rewrite.id) : readAgent.get(rewrite.id)
        ) as { dir?: unknown } | undefined
        if (row?.dir !== rewrite.dir) {
          throw new Error(
            `could not verify rebased ${rewrite.table} row ${JSON.stringify(rewrite.id)}`,
          )
        }
      }
      db.exec('COMMIT')
      transactionOpen = false
    } catch (error) {
      if (transactionOpen) db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`backup database is invalid: ${detail}`)
  } finally {
    db?.close()
  }

  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(`${database}${suffix}`)) {
      throw new Error(`backup database is invalid: path rebasing left transient ${suffix} state`)
    }
  }
}

function removeRebuildableQmdIndexes(payload: string): void {
  const teamsDir = resolve(payload, 'teams')
  if (!existsSync(teamsDir) || !lstatSync(teamsDir).isDirectory()) return

  for (const team of readdirSync(teamsDir, { withFileTypes: true })) {
    // Linked Teams are leaf symlinks in the archive. Never follow them while
    // cleaning caches or restore could touch the external project directory.
    if (!team.isDirectory() || team.isSymbolicLink()) continue
    const memoryDir = resolve(teamsDir, team.name, 'memory')
    if (!existsSync(memoryDir) || !lstatSync(memoryDir).isDirectory()) continue
    for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith('.qmd-index.sqlite')) {
        rmSync(resolve(memoryDir, entry.name), { force: true })
      }
    }
  }
}

function revokeRestoredBrowserSessions(database: string): void {
  const db = new DatabaseSync(database)
  try {
    db.prepare('UPDATE web_sessions SET revoked_at = ? WHERE revoked_at IS NULL').run(Date.now())
  } finally {
    db.close()
  }
}

export function installValidatedPayload(
  payload: string,
  targetHome: string,
  staging: string,
  lifecycle?: Pick<
    import('../daemon-liveness.ts').HomeRestoreLock,
    'markSwapping' | 'markInstalled' | 'markRecoveryRequired'
  >,
  operations: {
    rename(source: string, destination: string): void
    fsyncDirectory?(path: string): void
    afterPreviousMoved?(): void
  } = { rename: renameSync },
): void {
  const previous = resolve(staging, 'previous-home')
  const hadPrevious = existsSync(targetHome)
  const targetParent = dirname(targetHome)
  const syncDirectory = operations.fsyncDirectory ?? fsyncDirectory

  const recoveryError = (
    message: string,
    recoveryPath: string,
    cause: unknown,
  ): RestoreRecoveryRequiredError => {
    let markerError: unknown
    try {
      lifecycle?.markRecoveryRequired(recoveryPath, hadPrevious)
    } catch (error) {
      markerError = error
    }
    const causeDetail = cause instanceof Error ? cause.message : String(cause)
    const markerDetail = markerError
      ? `; recovery marker update failed: ${markerError instanceof Error ? markerError.message : markerError}`
      : ''
    return new RestoreRecoveryRequiredError(
      `${message} (${causeDetail}); recovery data is at ${recoveryPath}${markerDetail}`,
      recoveryPath,
    )
  }

  lifecycle?.markSwapping(previous, hadPrevious)

  if (hadPrevious) {
    try {
      operations.rename(targetHome, previous)
    } catch (moveError) {
      // The old home never moved, so startup is safe once the phase is
      // durably returned to `installed`.
      lifecycle?.markInstalled()
      throw moveError
    }
    try {
      syncDirectory(targetParent)
      // Test-only fault hook proving that any handled failure after the first
      // rename is promoted to durable recovery-required state.
      operations.afterPreviousMoved?.()
    } catch (postMoveError) {
      throw recoveryError(
        'the previous home moved but the swap could not continue safely',
        previous,
        postMoveError,
      )
    }
  }

  try {
    operations.rename(payload, targetHome)
  } catch (installError) {
    if (hadPrevious) {
      try {
        operations.rename(previous, targetHome)
      } catch (rollbackError) {
        const installDetail =
          installError instanceof Error ? installError.message : String(installError)
        throw recoveryError(
          `restore install failed (${installDetail}) and rollback failed`,
          previous,
          rollbackError,
        )
      }

      try {
        syncDirectory(targetParent)
      } catch (rollbackSyncError) {
        throw recoveryError(
          'the previous home was restored but its directory entry could not be made durable',
          targetHome,
          rollbackSyncError,
        )
      }

      try {
        lifecycle?.markInstalled()
      } catch (phaseError) {
        throw recoveryError(
          'the previous home was restored but could not be marked safe',
          targetHome,
          phaseError,
        )
      }
    } else {
      lifecycle?.markInstalled()
    }
    throw installError
  }

  try {
    syncDirectory(targetParent)
  } catch (installSyncError) {
    throw recoveryError(
      'the restored home was installed but its directory entry could not be made durable',
      hadPrevious ? previous : targetHome,
      installSyncError,
    )
  }

  try {
    lifecycle?.markInstalled()
  } catch (phaseError) {
    throw recoveryError(
      'the restored home was installed but could not be marked safe',
      hadPrevious ? previous : targetHome,
      phaseError,
    )
  }
}

export class RestoreRecoveryRequiredError extends Error {
  readonly recoveryPath: string

  constructor(message: string, recoveryPath: string) {
    super(message)
    this.name = 'RestoreRecoveryRequiredError'
    this.recoveryPath = recoveryPath
  }
}

function fsyncDirectory(path: string): void {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } catch (error) {
    // Windows does not allow opening directories. File/lock fsync still
    // provides the strongest portable durability available there.
    if (process.platform !== 'win32') throw error
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function fsyncFile(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

const AGE_HEADER = Buffer.from('age-encryption.org/v1\n', 'ascii')

function isAgeEncrypted(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const header = Buffer.alloc(AGE_HEADER.length)
    return readSync(fd, header, 0, header.length, 0) === header.length && header.equals(AGE_HEADER)
  } finally {
    closeSync(fd)
  }
}

function readAgeIdentity(rawPath: string): string {
  const path = resolve(rawPath)
  const entry = lstatSync(path)
  if (!entry.isFile()) throw new Error(`age identity is not a regular file: ${path}`)
  if (process.platform !== 'win32' && (entry.mode & 0o077) !== 0) {
    throw new Error(`age identity must be owner-only (chmod 600): ${path}`)
  }
  const identities = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (identities.length !== 1 || !identities[0]?.startsWith('AGE-SECRET-KEY-')) {
    throw new Error('age identity file must contain exactly one supported AGE-SECRET-KEY entry')
  }
  return identities[0]
}

const restoreCmd = defineCommand({
  meta: {
    name: 'restore',
    description: 'Extract a backup tar.gz into ~/.bazilion (offline; server must be stopped)',
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Path to tar.gz backup file',
    },
    home: { type: 'string', description: 'Override BAZILION_HOME' },
    force: {
      type: 'boolean',
      description: 'Overwrite existing non-empty home (destroys existing data)',
    },
    identity: {
      type: 'string',
      description: 'Path to an age identity file required for encrypted backups',
    },
  },
  async run({ args }) {
    const file = resolve(args.file)
    if (!existsSync(file)) throw new Error(`backup file not found: ${file}`)

    const paths = resolveCliPaths(args.home)
    const targetHome = resolve(paths.home)
    if (targetHome === parse(targetHome).root) {
      throw new Error(`refusing to restore over filesystem root: ${targetHome}`)
    }

    const targetParent = dirname(targetHome)
    mkdirSync(targetParent, { recursive: true })
    const restoreLock = await acquireHomeRestoreLock(targetHome)

    try {
      // Keep probing known URLs for older daemons that predate the ownership
      // record. The lock above is authoritative for current daemons and stays
      // held until validation plus install/rollback have fully completed.
      const targetsConfiguredHome = targetHome === resolve(resolveCliPaths().home)
      if (targetsConfiguredHome) {
        for (const serverUrl of configuredLoopbackUrls()) {
          if (await probeServerRunning(serverUrl)) {
            throw new Error(
              `bazilion server appears to be running at ${serverUrl} — stop it before restoring.`,
            )
          }
        }
      }

      if (existsSync(targetHome)) {
        if (!lstatSync(targetHome).isDirectory()) {
          throw new Error(`${targetHome} exists and is not a directory`)
        }
        const entries = readdirSync(targetHome)
        if (entries.length > 0 && !args.force) {
          throw new Error(
            `${targetHome} is not empty. Pass --force to overwrite (destroys existing data).`,
          )
        }
      }

      const staging = mkdtempSync(resolve(targetParent, '.bazilion-restore-'))
      const stagedArchive = resolve(staging, 'backup.tar.gz')
      const payload = resolve(staging, 'payload')
      let preserveStaging = false

      try {
        // Validate and extract a private copy so an archive replaced by another
        // process between the two passes cannot bypass path validation.
        if (isAgeEncrypted(file)) {
          if (!args.identity) {
            throw new Error('encrypted backup requires --identity <owner-only age identity file>')
          }
          const identity = readAgeIdentity(args.identity)
          const decrypter = new Decrypter()
          decrypter.addIdentity(identity)
          let decrypted: ReadableStream<Uint8Array>
          try {
            decrypted = await decrypter.decrypt(
              Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
            )
          } catch {
            throw new Error('backup decryption failed: wrong identity or invalid encrypted header')
          }
          try {
            await pipeline(
              Readable.fromWeb(decrypted),
              createWriteStream(stagedArchive, { flags: 'wx', mode: 0o600 }),
            )
          } catch {
            throw new Error('backup decryption failed: ciphertext is truncated or modified')
          }
        } else {
          if (args.identity) {
            throw new Error('encrypted-only restore requested, but the backup is plaintext')
          }
          copyFileSync(file, stagedArchive)
          chmodSync(stagedArchive, 0o600)
        }
        await validateArchive(stagedArchive)
        mkdirSync(payload)
        await extract({
          file: stagedArchive,
          cwd: payload,
          strict: true,
          preserveOwner: false,
          // The private copy has already passed complete entry-path and link
          // validation above. Preserve paths here so an intentionally absolute
          // external linked-Team target is not stripped into a different,
          // payload-relative path by npm-tar.
          preservePaths: true,
        })

        const database = resolve(payload, 'bazilion.db')
        const authFile = resolve(payload, 'auth.json')
        if (!lstatSync(database).isFile() || !lstatSync(authFile).isFile()) {
          throw new Error('backup required files did not extract as regular files')
        }
        const authToken = validateAuthFile(authFile)
        validateDatabase(database, authToken)
        rebaseRestoredHomeDirectories(database, payload, targetHome)
        revokeRestoredBrowserSessions(database)
        // Recheck the canonical file after the controlled mutation. This also
        // proves the auth pairing and all schema/FK invariants still hold.
        validateDatabase(database, authToken)
        removeRebuildableQmdIndexes(payload)

        console.log(`installing validated backup ${file} → ${targetHome}`)
        try {
          installValidatedPayload(payload, targetHome, staging, restoreLock)
        } catch (error) {
          if (error instanceof RestoreRecoveryRequiredError) {
            preserveStaging = true
          }
          throw error
        }
      } finally {
        if (!preserveStaging) {
          try {
            rmSync(staging, { recursive: true, force: true })
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            console.warn(
              `warning: could not remove restore staging directory ${staging}: ${detail}`,
            )
          }
        }
      }
    } finally {
      restoreLock.release()
    }

    console.log(`restored to ${targetHome}`)
    console.log('start the server with: bazilion serve  (migrations apply automatically)')
  },
})

interface SecretEnvelope {
  salt: string
  iv: string
  tag: string
  data: string
}

function decryptSecretEnvelope(raw: string, password: string): string {
  const envelope = JSON.parse(raw) as SecretEnvelope
  const key = pbkdf2Sync(password, Buffer.from(envelope.salt, 'hex'), 100_000, 32, 'sha256')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

function encryptSecretEnvelope(value: string, password: string): string {
  const salt = randomBytes(16)
  const key = pbkdf2Sync(password, salt, 100_000, 32, 'sha256')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return JSON.stringify({
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  } satisfies SecretEnvelope)
}

function credentialInventory(home: string): {
  bootstrap: boolean
  activeTokens: number
  secretKeys: string[]
} {
  const authFile = resolve(home, 'auth.json')
  const database = resolve(home, 'bazilion.db')
  const token = validateAuthFile(authFile)
  validateDatabase(database, token)
  const db = new DatabaseSync(database, { readOnly: true })
  try {
    const activeTokens = db
      .prepare(
        "SELECT COUNT(*) AS count FROM web_tokens WHERE revoked_at IS NULL AND kind = 'device' AND expires_at > ?",
      )
      .get(Date.now()) as { count: number }
    const secretKeys = (
      db.prepare('SELECT key FROM secrets ORDER BY key').all() as unknown as Array<{ key: string }>
    ).map((row) => row.key)
    return { bootstrap: true, activeTokens: activeTokens.count, secretKeys }
  } finally {
    db.close()
  }
}

const inventoryCmd = defineCommand({
  meta: { name: 'inventory', description: 'List credential classes captured by a backup/home' },
  args: { home: { type: 'string', description: 'Override BAZILION_HOME' } },
  run({ args }) {
    const home = resolve(resolveCliPaths(args.home).home)
    const inventory = credentialInventory(home)
    console.log('credential classes present (values are never shown):')
    console.log(`  bootstrap token: ${inventory.bootstrap ? 'present' : 'missing'}`)
    console.log(`  active device/web/mobile tokens: ${inventory.activeTokens}`)
    for (const key of inventory.secretKeys) console.log(`  stored secret: ${key}`)
  },
})

const recoveryGuideCmd = defineCommand({
  meta: { name: 'recovery-guide', description: 'Print the credential-exposure recovery checklist' },
  run() {
    console.log('Bazilion credential exposure recovery:')
    console.log('1. Stop the Bazilion daemon and preserve the suspected archive for investigation.')
    console.log(
      '2. Run `bazilion backup inventory`, then `bazilion backup rotate-bootstrap --yes`.',
    )
    console.log('3. Regenerate the Telegram bot token with BotFather and save the replacement.')
    console.log(
      '4. Disconnect/revoke the affected OpenAI session or grant, then authenticate again.',
    )
    console.log('5. Rotate every provider or MCP credential named by the inventory.')
    console.log('6. Create and verify a fresh recipient-encrypted backup after external rotation.')
    console.log(
      'Local bootstrap rotation does not revoke copied Telegram/OpenAI/provider credentials.',
    )
  },
})

const rotateBootstrapCmd = defineCommand({
  meta: {
    name: 'rotate-bootstrap',
    description: 'Offline crash-safe bootstrap rotation; revokes every other local token',
  },
  args: {
    home: { type: 'string', description: 'Override BAZILION_HOME' },
    yes: { type: 'boolean', required: true, description: 'Confirm token revocation and home swap' },
  },
  async run({ args }) {
    if (!args.yes) throw new Error('--yes is required')
    const paths = resolveCliPaths(args.home)
    const targetHome = resolve(paths.home)
    if (targetHome === parse(targetHome).root) {
      throw new Error(`refusing to rotate filesystem root: ${targetHome}`)
    }
    const lock = await acquireHomeRestoreLock(targetHome)
    const parent = dirname(targetHome)
    const staging = mkdtempSync(resolve(parent, '.bazilion-rotate-'))
    const payload = resolve(staging, 'payload')
    let preserveStaging = false
    try {
      for (const serverUrl of configuredLoopbackUrls()) {
        if (await probeServerRunning(serverUrl)) {
          throw new Error(`bazilion server appears to be running at ${serverUrl} — stop it first.`)
        }
      }
      const oldAuth = JSON.parse(readFileSync(paths.authFile, 'utf8')) as {
        token?: unknown
        remote?: unknown
      }
      if (typeof oldAuth.token !== 'string' || !oldAuth.token) {
        throw new Error('auth.json is missing the bootstrap token')
      }
      validateDatabase(resolve(targetHome, 'bazilion.db'), oldAuth.token)

      cpSync(targetHome, payload, {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        preserveTimestamps: true,
      })
      const stagedDb = resolve(payload, 'bazilion.db')
      rmSync(stagedDb, { force: true })
      const sourceDb = new DatabaseSync(resolve(targetHome, 'bazilion.db'), { readOnly: true })
      try {
        await sqliteBackup(sourceDb, stagedDb)
      } finally {
        sourceDb.close()
      }
      for (const suffix of ['-wal', '-shm', '-journal'])
        rmSync(`${stagedDb}${suffix}`, { force: true })

      const newToken = randomBytes(24).toString('hex')
      const db = new DatabaseSync(stagedDb)
      try {
        db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE')
        try {
          const rows = db
            .prepare('SELECT key, envelope FROM secrets ORDER BY key')
            .all() as unknown as Array<{
            key: string
            envelope: string
          }>
          const updateSecret = db.prepare(
            'UPDATE secrets SET envelope = ?, updated_at = ? WHERE key = ?',
          )
          for (const row of rows) {
            let value: string
            try {
              value = decryptSecretEnvelope(row.envelope, oldAuth.token)
            } catch {
              throw new Error(`stored secret is unreadable and rotation was aborted: ${row.key}`)
            }
            updateSecret.run(encryptSecretEnvelope(value, newToken), Date.now(), row.key)
          }
          const oldHash = createHash('sha256').update(oldAuth.token).digest('hex')
          const newHash = createHash('sha256').update(newToken).digest('hex')
          const bootstrap = db
            .prepare(
              "UPDATE web_tokens SET token_hash = ?, last_used_at = NULL, revoked_at = NULL WHERE token_hash = ? AND kind = 'bootstrap' AND revoked_at IS NULL",
            )
            .run(newHash, oldHash)
          if (bootstrap.changes !== 1) throw new Error('active bootstrap token row was not unique')
          const revokedAt = Date.now()
          db.prepare(
            "UPDATE web_tokens SET revoked_at = ? WHERE kind != 'bootstrap' AND revoked_at IS NULL",
          ).run(revokedAt)
          db.prepare('UPDATE web_sessions SET revoked_at = ? WHERE revoked_at IS NULL').run(
            revokedAt,
          )
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      } finally {
        db.close()
      }

      const stagedAuth = resolve(payload, 'auth.json')
      const authPartial = resolve(payload, `.auth.json.${randomUUID()}.installing`)
      writeFileSync(authPartial, `${JSON.stringify({ ...oldAuth, token: newToken }, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      })
      renameSync(authPartial, stagedAuth)
      chmodSync(stagedAuth, 0o600)
      validateDatabase(stagedDb, newToken)
      const verification = credentialInventory(payload)
      if (!verification.bootstrap) throw new Error('rotated credential inventory is invalid')
      fsyncFile(stagedDb)
      fsyncFile(stagedAuth)
      fsyncDirectory(payload)

      try {
        installValidatedPayload(payload, targetHome, staging, lock)
      } catch (error) {
        if (error instanceof RestoreRecoveryRequiredError) preserveStaging = true
        throw error
      }
      console.log('bootstrap token rotated; all non-bootstrap Bazilion tokens were revoked')
      console.log('external Telegram, OpenAI, provider, and MCP credentials were not revoked')
    } finally {
      if (!preserveStaging) rmSync(staging, { recursive: true, force: true })
      lock.release()
    }
  },
})

export const backupCommand = defineCommand({
  meta: { name: 'backup', description: 'Encrypted backup, restore, and credential recovery' },
  subCommands: {
    create: createCmd,
    restore: restoreCmd,
    inventory: inventoryCmd,
    'recovery-guide': recoveryGuideCmd,
    'rotate-bootstrap': rotateBootstrapCmd,
  },
  // `bazilion backup` with no positional falls through to citty's subcommand
  // prompt ("No command specified"). The previous default (auto-download to
  // cwd) double-fired when a subcommand was used because citty runs parent's
  // `run` after the subcommand completes — explicit `create` / `restore` is
  // the supported form now.
})
