import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, isAbsolute, join, parse, posix, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Decrypter, Encrypter } from 'age-encryption'
import { defineCommand } from 'citty'
import { extract, list } from 'tar'
import { type SchemaObject, schemaMatches } from '../../../daemon/src/core/db/schema.ts'
import { assertDaemonStopped } from '../../../daemon/src/lib/daemon-liveness.ts'
import { readAuthFile } from '../auth-file.ts'
import { loadClientConfig } from '../client.ts'
import { canonicalPath, resolveCliPaths } from '../paths.ts'

const createCmd = defineCommand({
  meta: { name: 'create', description: 'Download a backup of the Bazilion home' },
  args: {
    output: {
      type: 'positional',
      required: false,
      description: 'Output file (default: bazilion-backup-<date>.tar.gz, plus .age when encrypted)',
    },
    recipient: { type: 'string', description: 'Encrypt the backup to this age recipient (age1…)' },
  },
  async run({ args }) {
    const date = new Date().toISOString().slice(0, 10)
    const suffix = args.recipient ? '.tar.gz.age' : '.tar.gz'
    const output = canonicalPath(args.output ?? `bazilion-backup-${date}${suffix}`)
    if (existsSync(output)) throw new Error(`refusing to overwrite ${output}`)
    const home = resolveCliPaths().home
    const fromHome = relative(home, output)
    if (fromHome !== '..' && !fromHome.startsWith(`..${sep}`) && !isAbsolute(fromHome)) {
      throw new Error(`write the backup outside the Bazilion home (${home})`)
    }
    // Set up first, so a mistyped recipient fails before the download starts.
    const encrypter = new Encrypter()
    if (args.recipient) encrypter.addRecipient(args.recipient)
    else console.warn('warning: this backup is not encrypted and contains every stored credential')

    const cfg = loadClientConfig()
    const res = await fetch(`${cfg.serverUrl}/api/backup`, {
      headers: { authorization: `Bearer ${cfg.token}`, origin: cfg.serverUrl },
    })
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(`backup failed: ${body.error ?? res.statusText}`)
    }
    const partial = `${output}.partial`
    // Created here or not at all: never write into, or follow, a file that is already there.
    const fd = openSync(partial, 'wx', 0o600)
    try {
      const [archive, check] = res.body.tee()
      const written = args.recipient ? await encrypter.encrypt(archive) : archive
      await Promise.all([
        pipeline(Readable.fromWeb(written), createWriteStream(partial, { fd })),
        // A response cut short can still end cleanly: read the archive through to its end.
        pipeline(Readable.fromWeb(check), list({ strict: true })),
      ])
      renameSync(partial, output)
    } finally {
      rmSync(partial, { force: true })
    }
    console.log(`backup written to ${output}`)
  },
})

const AGE_HEADER = Buffer.from('age-encryption.org/v1\n')

function isAgeEncrypted(file: string): boolean {
  const header = Buffer.alloc(AGE_HEADER.length)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, header, 0, header.length, 0)
  } finally {
    closeSync(fd)
  }
  return header.equals(AGE_HEADER)
}

async function decrypt(file: string, output: string, identityFile: string): Promise<void> {
  const decrypter = new Decrypter()
  const identities = readFileSync(identityFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('AGE-SECRET-KEY-'))
  if (identities.length === 0) throw new Error(`no AGE-SECRET-KEY in ${identityFile}`)
  for (const identity of identities) decrypter.addIdentity(identity)
  try {
    const plain = await decrypter.decrypt(
      Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
    )
    await pipeline(Readable.fromWeb(plain), createWriteStream(output, { mode: 0o600 }))
  } catch {
    throw new Error('could not decrypt the backup: wrong identity, or the file is damaged')
  }
}

/**
 * Refuse what restore must not write: paths leaving the home, special files, entries below a
 * symbolic link, and links leaving the home other than a linked Team (`teams/<slug>`, absolute).
 * The rest of the archive, its database included, is trusted: restore only backups you trust.
 */
async function checkArchive(file: string): Promise<void> {
  // Collect first: an error thrown while tar is still reading would escape as a crash.
  const raw: Array<{ path: string; type: string; linkpath: string }> = []
  await list({
    file,
    strict: true,
    onReadEntry: (entry) =>
      raw.push({ path: entry.path, type: entry.type, linkpath: entry.linkpath ?? '' }),
  })
  const entries: Array<{ path: string; type: string }> = []
  const links = new Set<string>()
  for (const entry of raw) {
    const segments = entry.path.split('/').filter((segment) => segment && segment !== '.')
    const path = segments.join('/')
    if (entry.path.startsWith('/') || segments.includes('..')) {
      throw new Error(`backup contains an unsafe path: ${entry.path}`)
    }
    if (!['File', 'Directory', 'SymbolicLink'].includes(entry.type)) {
      throw new Error(`backup contains an unsupported ${entry.type} entry: ${path}`)
    }
    if (entry.type === 'SymbolicLink') {
      const resolved = posix.normalize(posix.join(posix.dirname(path), entry.linkpath))
      const leaves = posix.isAbsolute(entry.linkpath)
        ? !/^teams\/[^/]+$/.test(path)
        : resolved === '..' || resolved.startsWith('../')
      if (leaves) throw new Error(`backup contains a symbolic link leaving the home: ${path}`)
      links.add(path)
    }
    entries.push({ path, type: entry.type })
  }
  for (const { path } of entries) {
    const segments = path.split('/')
    for (let i = 1; i < segments.length; i++) {
      if (links.has(segments.slice(0, i).join('/'))) {
        throw new Error(`backup places ${path} below a symbolic link`)
      }
    }
  }
  for (const required of ['bazilion.db', 'auth.json']) {
    if (!entries.some((entry) => entry.path === required && entry.type === 'File')) {
      throw new Error(`backup is missing ${required}`)
    }
  }
}

/** The restored home must open on this release: intact, same schema, matching auth.json. */
function checkDatabase(home: string): void {
  const token = readAuthFile(join(home, 'auth.json')).token
  // Opened read-write only so that closing it removes the -wal/-shm files a WAL database makes.
  const db = new DatabaseSync(join(home, 'bazilion.db'))
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get()
    if (integrity?.integrity_check !== 'ok') throw new Error('the database is damaged')
    if (!schemaMatches((query) => db.prepare(query).all() as unknown as SchemaObject[])) {
      throw new Error('the database schema differs from this release; use a backup from it')
    }
    const bootstrap = db
      .prepare(
        "SELECT 1 FROM web_tokens WHERE token_hash = ? AND kind = 'bootstrap' AND revoked_at IS NULL",
      )
      .get(createHash('sha256').update(token).digest('hex'))
    if (!bootstrap) throw new Error('auth.json does not match the database')
  } catch (error) {
    throw new Error(`backup database is unusable: ${(error as Error).message}`)
  } finally {
    db.close()
  }
}

/** Swap the staged home in; the current home stays in place until the new one is. */
export function installRestoredHome(staged: string, home: string): void {
  if (!existsSync(home)) {
    renameSync(staged, home)
    return
  }
  const previous = `${home}.pre-restore-${Date.now()}`
  console.log(`moving the current home aside to ${previous}`)
  renameSync(home, previous)
  try {
    renameSync(staged, home)
  } catch (error) {
    renameSync(previous, home)
    throw error
  }
  try {
    rmSync(previous, { recursive: true, force: true })
  } catch {
    console.warn(`warning: could not delete the previous home at ${previous}; remove it by hand`)
  }
}

const restoreCmd = defineCommand({
  meta: {
    name: 'restore',
    description: 'Restore a backup into the Bazilion home (stop the daemon first)',
  },
  args: {
    file: { type: 'positional', required: true, description: 'Backup file (.tar.gz or .age)' },
    home: { type: 'string', description: 'Restore into this home instead of BAZILION_HOME' },
    force: { type: 'boolean', description: 'Replace a non-empty home, deleting its current data' },
    identity: { type: 'string', description: 'age identity file of an encrypted backup' },
  },
  async run({ args }) {
    const file = resolve(args.file)
    if (!existsSync(file)) throw new Error(`backup file not found: ${file}`)
    const home = resolveCliPaths(args.home).home
    if (home === parse(home).root) throw new Error('refusing to restore over the filesystem root')
    assertDaemonStopped(home)
    if (existsSync(home) && readdirSync(home).length > 0 && !args.force) {
      throw new Error(`${home} is not empty; pass --force to replace it (its data is deleted)`)
    }

    mkdirSync(dirname(home), { recursive: true })
    const staging = mkdtempSync(join(dirname(home), '.bazilion-restore-'))
    try {
      // Check and extract a private copy, so the archive cannot change between the two.
      const archive = join(staging, 'backup.tar.gz')
      if (isAgeEncrypted(file)) {
        if (!args.identity) throw new Error('this backup is encrypted; pass --identity <file>')
        await decrypt(file, archive, args.identity)
      } else {
        copyFileSync(file, archive)
      }
      await checkArchive(archive)
      const staged = join(staging, 'home')
      mkdirSync(staged, { mode: 0o700 })
      // preservePaths keeps a linked Team's absolute target; checkArchive refused unsafe entries.
      await extract({ file: archive, cwd: staged, strict: true, preservePaths: true })
      // Owner-only, whatever modes the archive carried.
      chmodSync(staged, 0o700)
      for (const name of ['auth.json', 'bazilion.db']) chmodSync(join(staged, name), 0o600)
      checkDatabase(staged)
      // Again: a daemon may have started on the home while the archive was checked.
      assertDaemonStopped(home)
      installRestoredHome(staged, home)
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
    console.log(`restored ${file} to ${home}`)
    console.log('start the daemon with: bazilion serve')
  },
})

export const backupCommand = defineCommand({
  meta: { name: 'backup', description: 'Back up and restore the Bazilion home' },
  subCommands: { create: createCmd, restore: restoreCmd },
})
