import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OwnedDarwinWorker } from '../process/worker.ts'

export class DarwinBrowserKeychainError extends Error {
  constructor(
    readonly cleanupUnknown: boolean,
    diagnostic?: string,
  ) {
    let detail = ''
    try {
      const value = JSON.parse(diagnostic ?? '')
      if (
        [
          'admission',
          'binding',
          'interaction',
          'open',
          'create',
          'unlock',
          'settings',
          'verify-settings',
          'default',
        ].includes(value.phase) &&
        (value.status === null || Number.isSafeInteger(value.status))
      )
        detail = ` (phase=${value.phase}, status=${value.status})`
    } catch {
      /* Never disclose raw helper output or paths. */
    }
    super(`managed private browser keychain unavailable${detail}`)
  }
}

/** Filesystem-only preparation, separately testable without pretending native execution passed. */
export function prepareDarwinBrowserKeychain(home: string): { home: string; password: string } {
  for (const directory of [
    home,
    join(home, 'Library'),
    join(home, 'Library', 'Preferences'),
    join(home, 'Library', 'Keychains'),
  ]) {
    try {
      mkdirSync(directory, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.geteuid?.())
      throw new Error('unsafe private keychain directory')
    chmodSync(directory, 0o700)
  }
  const path = join(home, '.bazilion-keychain-secret')
  let fd: number
  try {
    fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      writeFileSync(fd, randomBytes(32).toString('hex'))
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let password: string
  try {
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.geteuid?.() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size !== 64
    )
      throw new Error('unsafe private keychain secret')
    password = readFileSync(fd, 'utf8')
    if (!/^[0-9a-f]{64}$/.test(password)) throw new Error('invalid private keychain secret')
  } finally {
    closeSync(fd)
  }
  // A private HOME must not redirect native preference/keychain writes outside the profile.
  for (const file of [
    join(home, 'Library', 'Preferences', 'com.apple.security.plist'),
    join(home, 'Library', 'Keychains', 'bazilion.keychain-db'),
  ]) {
    try {
      const stat = lstatSync(file)
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.uid !== process.geteuid?.()
      )
        throw new Error('unsafe private keychain state')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return { home, password }
}

/** Ordinary-user helper with no ambient credentials, private native preferences, no UI and no
 * password arguments/environment. Unknown child/group cleanup retains the browser owner marker. */
export async function ensureDarwinBrowserKeychain(home: string, timeoutMs: number): Promise<void> {
  if (process.platform !== 'darwin') throw new DarwinBrowserKeychainError(false)
  const input = prepareDarwinBrowserKeychain(home)
  const source = fileURLToPath(new URL('./darwin-keychain-entry.mjs', import.meta.url))
  const entry = existsSync(source)
    ? source
    : fileURLToPath(new URL('./browser-keychain.js', import.meta.url))
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8' },
  })
  let stdout = ''
  let stderr = ''
  let overflow = false
  child.stdout.on('data', (chunk) => {
    if (stdout.length + chunk.length > 1024) overflow = true
    else stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk) => {
    if (stderr.length + chunk.length <= 1024) stderr += chunk.toString('utf8')
  }) // Bounded, closed phase/status diagnostics only; never disclose raw native errors.
  child.stdin.on('error', () => {})
  const closed = new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code))
    child.once('error', () => {})
  })
  if (child.pid === undefined) {
    await closed
    throw new DarwinBrowserKeychainError(false)
  }
  let owner: OwnedDarwinWorker
  try {
    // Native keychain operations cross into a system service outside this process group.
    // Require a coded exit as well as EOF/absent group; forced exit cannot acknowledge those
    // external side effects or release the profile for a competing writer.
    owner = new OwnedDarwinWorker(child.pid, child, true)
  } catch {
    // No executable input was sent. EOF lets this exact fresh child exit without numeric-PID
    // signalling; nevertheless failed ownership admission must retain the profile as uncertain.
    child.stdin.end()
    throw new DarwinBrowserKeychainError(true)
  }
  child.stdin.end(JSON.stringify(input))
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    closed.then((code) => ({ timedOut: false, code })),
    new Promise<{ timedOut: boolean; code: null }>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true, code: null }), Math.max(1, timeoutMs))
    }),
  ])
  clearTimeout(timer)
  // On timeout, the existing live-authority adapter retires only its original admitted group.
  if (!(await owner.settled())) throw new DarwinBrowserKeychainError(true)
  if (result.timedOut || result.code !== 0 || overflow || stdout !== '{"ok":true}\n')
    throw new DarwinBrowserKeychainError(false, stderr)
}
