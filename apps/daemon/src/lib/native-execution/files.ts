import { createHash } from 'node:crypto'
import { type BigIntStats, closeSync, constants, fstatSync, openSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { openRootFileSync } from '@openclaw/fs-safe/advanced'
import { ContextDirectory } from '../repository-context/files.ts'
import { NativeLayoutError } from './layout.ts'

export interface NativeFileOptions {
  readonly path: string
  readonly executable: boolean
  readonly rootOwned?: boolean
}
export interface NativeFileCapture {
  /** Private retained readonly FD; never a serialized worker/model parameter. */
  readonly fd: number
  readonly requestedPath: string
  readonly canonicalPath: string
  readonly executable: boolean
  readonly fingerprint: string
  revalidate(): void
  close(): void
}
const captures = new WeakSet<object>()
const closed = new WeakSet<object>()
const stamp = (stat: BigIntStats) =>
  [
    stat.dev,
    stat.ino,
    stat.size,
    stat.mode,
    stat.nlink,
    stat.uid,
    stat.gid,
    stat.mtimeNs,
    stat.ctimeNs,
  ]
    .map(String)
    .join(':')
const unavailable = () => new NativeLayoutError('unavailable')

/** Select/pin an explicit readonly input, not its whole parent directory or personal HOME. */
export function captureNativeFile(options: NativeFileOptions): NativeFileCapture {
  let parent: ContextDirectory | undefined
  let fd: number | undefined
  try {
    const requested = options.path
    const executable = options.executable
    const rootOwned = options.rootOwned === true
    if (
      typeof requested !== 'string' ||
      !isAbsolute(requested) ||
      normalize(requested) !== requested ||
      requested.endsWith('/') ||
      Buffer.byteLength(requested) > 4096 ||
      typeof executable !== 'boolean' ||
      (options.rootOwned !== undefined && typeof options.rootOwned !== 'boolean') ||
      [...requested].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw unavailable()
    const canonical = realpathSync(requested)
    const directory = new ContextDirectory(dirname(canonical))
    parent = directory
    const name = basename(canonical)
    const before = directory.metadata(name)
    if (!before?.isFile() || before.ino <= 0n || before.nlink <= 0n) throw unavailable()
    const uid = process.getuid?.()
    if (rootOwned && before.uid !== 0n) throw unavailable()
    if (
      executable &&
      ((before.mode & 0o111n) === 0n ||
        (before.mode & 0o6022n) !== 0n ||
        (before.uid !== 0n && (uid === undefined || before.uid !== BigInt(uid))))
    )
      throw unavailable()
    if (process.platform === 'linux') {
      fd = openSync(
        join(directory.path, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
    } else if (process.platform === 'darwin') {
      const opened = openRootFileSync({
        rootPath: dirname(canonical),
        absolutePath: canonical,
        boundaryLabel: 'native readonly input',
        symlinks: 'reject',
      })
      if (!opened.ok) throw unavailable()
      fd = opened.fd
    } else throw unavailable()
    const retained = fd
    const observed = fstatSync(retained, { bigint: true })
    const original = stamp(before)
    if (!observed.isFile() || stamp(observed) !== original) throw unavailable()
    directory.validate()
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          'native-readonly-file-v1',
          requested,
          canonical,
          executable,
          rootOwned,
          original,
        ]),
      )
      .digest('hex')
    const capture: NativeFileCapture = Object.freeze({
      fd: retained,
      requestedPath: requested,
      canonicalPath: canonical,
      executable,
      fingerprint,
      revalidate() {
        assertNativeFileCapture(capture)
        try {
          directory.validate()
          if (
            realpathSync(requested) !== canonical ||
            stamp(fstatSync(retained, { bigint: true })) !== original
          )
            throw new NativeLayoutError('changed')
        } catch {
          throw new NativeLayoutError('changed')
        }
      },
      close() {
        if (closed.has(capture)) return
        closed.add(capture)
        try {
          closeSync(retained)
        } finally {
          directory.close()
        }
      },
    })
    captures.add(capture)
    fd = undefined
    parent = undefined
    return capture
  } catch {
    try {
      if (fd !== undefined) closeSync(fd)
    } finally {
      parent?.close()
    }
    throw unavailable()
  }
}

export function assertNativeFileCapture(value: unknown): asserts value is NativeFileCapture {
  if (typeof value !== 'object' || value === null || !captures.has(value) || closed.has(value))
    throw unavailable()
}
