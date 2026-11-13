import { createHash } from 'node:crypto'
import {
  type BigIntStats,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from 'node:fs'
import { join } from 'node:path'

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

export class ContextReadError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function identity(stat: Pick<Stats | BigIntStats, 'dev' | 'ino'>): string {
  return `${stat.dev}:${stat.ino}`
}
function stamp(stat: BigIntStats): string {
  return `${identity(stat)}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}

function component(name: string): void {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name))
    throw new ContextReadError('unsafe_target')
}

/** Linux reaches an opened directory through its descriptor (/proc/self/fd); elsewhere
 * (untested) through its canonical path. */
const FD_PATHS = process.platform === 'linux'

/**
 * One capture owns its directory descriptors, source observations and final validation.
 * Every open is no-follow and `validate()` re-checks each directory's dev/ino identity.
 * This is not an atomic namespace snapshot.
 */
export class ContextDirectory {
  readonly fd: number
  readonly identity: string
  readonly registeredPath: string
  readonly label: string
  private readonly parent?: ContextDirectory
  private readonly canonicalPath: string
  private readonly originalIdentity: { dev: bigint; ino: bigint }
  private readonly children: ContextDirectory[] = []
  private listing: string | undefined
  private readonly observedFiles = new Map<string, string | null>()
  private closed = false

  constructor(registeredPath: string, label = '.', parent?: ContextDirectory) {
    this.registeredPath = registeredPath
    this.label = label
    this.parent = parent
    if (parent) component(registeredPath)
    parent?.assertOpen()
    const canonicalPath = parent
      ? join(parent.canonicalPath, registeredPath)
      : realpathSync(registeredPath)
    this.canonicalPath = canonicalPath
    let fd: number | undefined
    try {
      fd = openSync(
        parent ? join(parent.path, registeredPath) : canonicalPath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      const stat = fstatSync(fd, { bigint: true })
      if (!stat.isDirectory() || stat.ino <= 0n) throw new ContextReadError('root_changed')
      this.fd = fd
      this.originalIdentity = { dev: stat.dev, ino: stat.ino }
      this.identity = hash(identity(stat))
      fd = undefined // ownership transfers only after complete admission
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }

  get path(): string {
    return FD_PATHS ? `/proc/self/fd/${this.fd}` : this.canonicalPath
  }

  /** The worktree path handed to an external Git process (descriptor-pinned on Linux). */
  get gitWorktreePath(): string {
    return FD_PATHS ? `/proc/${process.pid}/fd/${this.fd}` : this.canonicalPath
  }

  /** Every public method is synchronous, so one check on entry covers the whole call. */
  private assertOpen(): void {
    if (this.closed) throw new ContextReadError('unreadable')
  }

  directory(name: string): ContextDirectory {
    component(name)
    const child = new ContextDirectory(
      name,
      this.label === '.' ? name : `${this.label}/${name}`,
      this,
    )
    this.children.push(child)
    return child
  }

  entry(name: string): Stats | null {
    component(name)
    this.assertOpen()
    try {
      return lstatSync(join(this.path, name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new ContextReadError('unreadable')
    }
  }

  private observe(name: string): BigIntStats | null {
    try {
      return lstatSync(join(this.path, name), { bigint: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new ContextReadError('unreadable')
    }
  }

  list(): string[] {
    this.assertOpen()
    const names = this.listNames()
    this.listing = JSON.stringify(names)
    return names
  }

  private listNames(): string[] {
    const handle = opendirSync(this.path)
    const names: string[] = []
    try {
      let entry = handle.readSync()
      while (entry) {
        if (names.length >= 16_384) throw new ContextReadError('directory_entry_limit')
        names.push(entry.name)
        entry = handle.readSync()
      }
      return names.sort()
    } finally {
      handle.closeSync()
    }
  }

  read(name: string, maxBytes: number): Buffer | null {
    component(name)
    this.assertOpen()
    const entry = this.observe(name)
    if (!entry) {
      this.observedFiles.set(name, null)
      return null
    }
    if (!entry.isFile() || entry.isSymbolicLink()) throw new ContextReadError('unsafe_file')
    if (entry.ino <= 0n) throw new ContextReadError('unreadable')
    if (entry.size > maxBytes) throw new ContextReadError('byte_limit')
    let fd: number | undefined
    try {
      fd = openSync(
        join(this.path, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      const before = fstatSync(fd, { bigint: true })
      if (!before.isFile() || stamp(entry) !== stamp(before))
        throw new ContextReadError('source_changed')
      // Read at most one byte past the limit so a file that grew is detected.
      const buffer = Buffer.alloc(Math.min(maxBytes, Number(before.size)) + 1)
      let size = 0
      while (size < buffer.length) {
        const count = readSync(fd, buffer, size, buffer.length - size, null)
        if (!count) break
        size += count
      }
      if (
        size > maxBytes ||
        BigInt(size) !== before.size ||
        stamp(fstatSync(fd, { bigint: true })) !== stamp(before)
      )
        throw new ContextReadError('source_changed')
      this.observedFiles.set(name, stamp(before))
      return buffer.subarray(0, size)
    } catch (error) {
      if (error instanceof ContextReadError) throw error
      throw new ContextReadError('unreadable')
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }

  validate(skipGit = false, names?: ReadonlySet<string>): void {
    this.assertOpen()
    const currentPath = this.parent
      ? join(this.parent.path, this.registeredPath)
      : realpathSync(this.registeredPath)
    const stat = lstatSync(currentPath, { bigint: true })
    if (!stat.isDirectory() || identity(stat) !== identity(this.originalIdentity))
      throw new ContextReadError('root_changed')
    const retained = fstatSync(this.fd, { bigint: true })
    if (!retained.isDirectory() || identity(retained) !== identity(this.originalIdentity))
      throw new ContextReadError('root_changed')
    if (this.listing !== undefined && JSON.stringify(this.listNames()) !== this.listing)
      throw new ContextReadError('source_changed')
    for (const [name, previous] of this.observedFiles) {
      if (names && !names.has(name)) continue
      const current = this.observe(name)
      if ((current ? stamp(current) : null) !== previous)
        throw new ContextReadError('source_changed')
    }
    for (const child of this.children) {
      if (!skipGit || !child.label.split('/').includes('.git')) child.validate(skipGit, names)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    let failure: unknown
    for (const child of this.children) {
      try {
        child.close()
      } catch (error) {
        failure ??= error
      }
    }
    try {
      closeSync(this.fd)
    } catch (error) {
      failure ??= error
    }
    if (failure) throw failure
  }
}
