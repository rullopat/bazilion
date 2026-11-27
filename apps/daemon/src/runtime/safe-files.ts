import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Why `readContainedFile` refused a file. */
export type ContainedFileRefusal = 'outside' | 'not_file' | 'changed' | 'too_large'

export class ContainedFileError extends Error {
  readonly reason: ContainedFileRefusal
  constructor(reason: ContainedFileRefusal) {
    super(`file refused: ${reason}`)
    this.name = 'ContainedFileError'
    this.reason = reason
  }
}

/**
 * Read a regular file whose real path stays inside `realRoot` (a canonical directory), at most
 * `maxBytes` bytes. The file is opened no-follow and non-blocking, and the descriptor must still
 * be the checked file at the same real path, so a link swapped in for the file is refused, a FIFO
 * or device is refused without blocking, and a file that grows past the cap while it is read is
 * refused. On Linux the descriptor's own path (`/proc/self/fd`) must be the checked real path,
 * which also refuses a directory above the file swapped for a link while it is opened; elsewhere
 * that race is not detected. A missing path throws the fs error.
 */
export function readContainedFile(path: string, realRoot: string, maxBytes: number): Buffer {
  const real = realpathSync(path)
  if (!isContained(realRoot, real)) throw new ContainedFileError('outside')
  const checked = statSync(real)
  if (!checked.isFile()) throw new ContainedFileError('not_file')
  if (checked.size > maxBytes) throw new ContainedFileError('too_large')
  const fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.dev !== checked.dev || opened.ino !== checked.ino)
      throw new ContainedFileError('changed')
    if (process.platform === 'linux' && openedPath(fd) !== real)
      throw new ContainedFileError('changed')
    let confirmed: string | undefined
    try {
      confirmed = realpathSync(path)
    } catch {}
    if (confirmed !== real) throw new ContainedFileError('changed')
    // The file's size, and one sentinel byte past it to detect growth after the checks: a cap
    // as large as a provider's upload limit (gigabytes) is never allocated for a small file.
    const expected = Math.min(maxBytes, opened.size)
    const buffer = Buffer.alloc(expected + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > maxBytes) throw new ContainedFileError('too_large')
    // It grew while being read: past the cap it is too large, within it it changed.
    if (length > expected)
      throw new ContainedFileError(fstatSync(fd).size > maxBytes ? 'too_large' : 'changed')
    return buffer.subarray(0, length)
  } finally {
    closeSync(fd)
  }
}

/**
 * Write a regular file whose real parent stays inside `realRoot` (a canonical directory), creating
 * it when missing. The file is opened no-follow and non-blocking (a link in its place, a FIFO or a
 * device is refused), and the descriptor must be the file at the checked path before anything is
 * written: on Linux by the kernel's own path for it, elsewhere by resolving the path again.
 */
export function writeContainedFile(path: string, realRoot: string, content: string | Buffer): void {
  const parent = realpathSync(dirname(path))
  if (!isContained(realRoot, parent)) throw new ContainedFileError('outside')
  const target = join(parent, basename(path))
  const fd = openSync(
    target,
    constants.O_WRONLY | constants.O_CREAT | noFollowFlag() | constants.O_NONBLOCK,
    0o666,
  )
  try {
    if (!fstatSync(fd).isFile()) throw new ContainedFileError('not_file')
    const where = process.platform === 'linux' ? openedPath(fd) : realpathSync(target)
    if (where !== target) throw new ContainedFileError('changed')
    ftruncateSync(fd, 0)
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    let written = 0
    while (written < bytes.length)
      written += writeSync(fd, bytes, written, bytes.length - written, written)
  } finally {
    closeSync(fd)
  }
}

/** Where an open descriptor really is, from the kernel (Linux); undefined if it cannot be read. */
function openedPath(fd: number): string | undefined {
  try {
    return readlinkSync(`/proc/self/fd/${fd}`)
  } catch {
    return undefined
  }
}

/** Resolve a real directory and reject a symlink at the selected root itself. */
export function resolveRealDirectory(path: string): string {
  const requested = resolve(path)
  const entry = lstatSync(requested)
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error('expected a real directory')
  }
  return realpathSync(requested)
}

/**
 * Create or validate a direct/nested directory below a registered root.
 * The root itself may be a deliberate Team symlink; the selected directory
 * may not be a symlink and its canonical target must stay below that root.
 */
export function ensureContainedRealDirectory(
  path: string,
  root: string,
  options: { create?: boolean } = {},
): string {
  const requestedRoot = resolve(root)
  const requested = resolve(path)
  if (!isContained(requestedRoot, requested)) throw new Error('directory escapes its root')
  const canonicalRoot = realpathSync(requestedRoot)
  try {
    const entry = lstatSync(requested)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error('expected a real directory')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.create) throw error
    const canonicalParent = realpathSync(dirname(requested))
    if (!isContained(canonicalRoot, canonicalParent)) throw new Error('directory escapes its root')
    mkdirSync(requested, { recursive: true, mode: 0o700 })
    const entry = lstatSync(requested)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error('expected a real directory')
    }
  }
  const canonical = realpathSync(requested)
  if (!isContained(canonicalRoot, canonical)) throw new Error('directory escapes its root')
  return canonical
}

/** Read one regular file while refusing a final-component symbolic link. */
export function readRegularFileNoFollow(path: string): string {
  const entry = lstatSync(path)
  if (entry.isSymbolicLink()) throw new Error('symbolic links are not allowed')
  if (!entry.isFile()) throw new Error('target is not a regular file')
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | noFollowFlag())
    if (!fstatSync(fd).isFile()) throw new Error('target is not a regular file')
    return readFileSync(fd, 'utf8')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
}

export function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * A file an Agent names on the host, read only when it lies in one of `roots` (its workspace, its
 * uploads), links resolved, as `deliver_file` reads. At most `maxBytes`, else the file's own size.
 */
export function readFromRoots(
  path: string,
  roots: readonly string[],
  cwd: string,
  maxBytes?: number,
): Buffer {
  const wanted = resolve(cwd, path)
  for (const root of roots) {
    let real: string
    try {
      real = realpathSync(root)
    } catch {
      continue
    }
    if (isContained(root, wanted) || isContained(real, wanted)) {
      return readContainedFile(wanted, real, maxBytes ?? statSync(wanted).size)
    }
  }
  throw new Error(`${path} is not in your workspace or uploads`)
}
