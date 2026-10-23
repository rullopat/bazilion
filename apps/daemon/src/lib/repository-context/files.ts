import { createHash } from 'node:crypto'
import {
  type BigIntStats,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  realpathSync,
  type Stats,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  assertDirectoryIdentitySync,
  openRootFileSync,
  readFileDescriptorBoundedSync,
} from '@openclaw/fs-safe/advanced'
import { FsSafeError } from '@openclaw/fs-safe/errors'

export const hash = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')

export class ContextReadError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export function identity(stat: Pick<Stats | BigIntStats, 'dev' | 'ino'>): string {
  return `${stat.dev}:${stat.ino}`
}
function stamp(stat: BigIntStats): string {
  return `${identity(stat)}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}

export function relativeParts(target: string): string[] {
  if (
    target.length > 4096 ||
    isAbsolute(target) ||
    [...target].some(
      (char) => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    target.split('/').some((part) => part === '..' || part === '.git')
  )
    throw new ContextReadError('unsafe_target')
  const parts = target.split('/').filter((part) => part && part !== '.')
  if (parts.length > 17) throw new ContextReadError('depth_limit')
  return parts
}

function component(name: string): void {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name))
    throw new ContextReadError('unsafe_target')
}

/**
 * One capture owns its directory descriptors, source observations and final validation.
 * Linux retains fd-relative no-follow access. Darwin uses public fs-safe rooted opens plus
 * exact retained-directory/registration checks around each operation and before acceptance.
 * Neither route is an atomic namespace snapshot. Library native-mode labels are not admission.
 */
export class ContextDirectory {
  readonly fd: number
  readonly identity: string
  readonly registeredPath: string
  readonly label: string
  private readonly parent?: ContextDirectory
  private readonly platform: 'linux' | 'darwin'
  private readonly canonicalPath: string
  private readonly originalIdentity: { dev: bigint; ino: bigint }
  private readonly children: ContextDirectory[] = []
  private listing: string | undefined
  private readonly observedFiles = new Map<string, string | null>()
  private closed = false

  constructor(registeredPath: string, label = '.', parent?: ContextDirectory) {
    const platform = parent?.platform ?? process.platform
    if (platform !== 'linux' && platform !== 'darwin')
      throw new ContextReadError('safe_reads_unavailable')
    this.platform = platform
    this.registeredPath = registeredPath
    this.label = label
    this.parent = parent
    if (parent) component(registeredPath)
    parent?.assertCurrent()
    const canonicalPath = parent
      ? join(parent.canonicalPath, registeredPath)
      : realpathSync(registeredPath)
    let fd: number | undefined
    try {
      if (platform === 'linux') {
        this.canonicalPath = canonicalPath
        fd = openSync(
          parent ? join(parent.path, registeredPath) : canonicalPath,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        )
      } else {
        const opened = openRootFileSync({
          rootPath: parent?.canonicalPath ?? canonicalPath,
          absolutePath: canonicalPath,
          boundaryLabel: 'registered repository',
          allowedType: 'directory',
          symlinks: 'reject',
        })
        if (!opened.ok) throw new ContextReadError('root_changed')
        this.canonicalPath = opened.path
        fd = opened.fd
      }
      const stat = fstatSync(fd, { bigint: true })
      if (!stat.isDirectory() || stat.ino <= 0n) throw new ContextReadError('root_changed')
      this.fd = fd
      this.originalIdentity = { dev: stat.dev, ino: stat.ino }
      this.identity = hash(identity(stat))
      if (platform === 'darwin') this.assertCurrent()
      fd = undefined // ownership transfers only after complete admission
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }

  get path(): string {
    return this.platform === 'linux' ? `/proc/self/fd/${this.fd}` : this.canonicalPath
  }

  /** Only the existing Linux backend admits a descriptor-pinned external Git worktree. */
  get gitWorktreePath(): string | null {
    return this.platform === 'linux' ? `/proc/${process.pid}/fd/${this.fd}` : null
  }

  private assertCurrent(): void {
    if (this.closed) throw new ContextReadError('unreadable')
    if (this.platform === 'linux') return
    this.parent?.assertCurrent()
    try {
      const registered = this.parent
        ? join(this.parent.canonicalPath, this.registeredPath)
        : realpathSync(this.registeredPath)
      if (!this.parent && registered !== this.canonicalPath)
        throw new ContextReadError('root_changed')
      assertDirectoryIdentitySync(registered, {
        ...this.originalIdentity,
        realPath: this.canonicalPath,
      })
      const retained = fstatSync(this.fd, { bigint: true })
      if (!retained.isDirectory() || identity(retained) !== identity(this.originalIdentity))
        throw new ContextReadError('root_changed')
    } catch {
      throw new ContextReadError('root_changed')
    }
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
    this.assertCurrent()
    try {
      const stat = lstatSync(join(this.path, name))
      this.assertCurrent()
      return stat
    } catch (error) {
      this.assertCurrent()
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      if (error instanceof ContextReadError) throw error
      throw new ContextReadError('unreadable')
    }
  }

  private observe(name: string): BigIntStats | null {
    this.assertCurrent()
    try {
      const stat = lstatSync(join(this.path, name), { bigint: true })
      this.assertCurrent()
      return stat
    } catch (error) {
      this.assertCurrent()
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      if (error instanceof ContextReadError) throw error
      throw new ContextReadError('unreadable')
    }
  }

  list(): string[] {
    const names = this.listNames()
    this.listing = JSON.stringify(names)
    return names
  }

  private listNames(): string[] {
    this.assertCurrent()
    const handle = opendirSync(this.path)
    const names: string[] = []
    try {
      let entry = handle.readSync()
      while (entry) {
        if (names.length >= 16_384) throw new ContextReadError('directory_entry_limit')
        names.push(entry.name)
        entry = handle.readSync()
      }
      this.assertCurrent()
      return names.sort()
    } finally {
      handle.closeSync()
    }
  }

  read(name: string, maxBytes: number): Buffer | null {
    component(name)
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
      if (this.platform === 'linux') {
        fd = openSync(
          join(this.path, name),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        )
      } else {
        this.assertCurrent()
        const opened = openRootFileSync({
          rootPath: this.canonicalPath,
          absolutePath: join(this.canonicalPath, name),
          boundaryLabel: 'captured repository directory',
          symlinks: 'reject',
          maxBytes,
        })
        if (!opened.ok) throw new ContextReadError('source_changed')
        fd = opened.fd
        this.assertCurrent()
      }
      const before = fstatSync(fd, { bigint: true })
      if (!before.isFile() || stamp(entry) !== stamp(before))
        throw new ContextReadError('source_changed')
      const buffer = readFileDescriptorBoundedSync(fd, maxBytes)
      if (
        BigInt(buffer.length) !== before.size ||
        stamp(fstatSync(fd, { bigint: true })) !== stamp(before)
      )
        throw new ContextReadError('source_changed')
      this.assertCurrent()
      this.observedFiles.set(name, stamp(before))
      return buffer
    } catch (error) {
      if (error instanceof ContextReadError) throw error
      if (error instanceof FsSafeError && error.code === 'too-large')
        throw new ContextReadError('source_changed')
      throw new ContextReadError('unreadable')
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }

  validate(skipGit = false, names?: ReadonlySet<string>): void {
    this.assertCurrent()
    const currentPath = this.parent
      ? join(this.parent.path, this.registeredPath)
      : realpathSync(this.registeredPath)
    const stat = lstatSync(currentPath, { bigint: true })
    if (!stat.isDirectory() || identity(stat) !== identity(this.originalIdentity))
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
