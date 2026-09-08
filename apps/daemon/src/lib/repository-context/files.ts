import { createHash } from 'node:crypto'
import {
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
import { isAbsolute, join } from 'node:path'

export const hash = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')

export class ContextReadError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function identity(stat: Stats): string {
  return `${stat.dev}:${stat.ino}`
}
function stamp(stat: Stats): string {
  return `${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
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

/**
 * Directory descriptors pin each ancestry component. On Linux /proc/self/fd provides openat-like
 * access with O_NOFOLLOW, including during renames. Unsupported platforms fail closed instead of
 * promising containment from a check-then-read path. The registered root may deliberately be linked.
 */
export class ContextDirectory {
  readonly fd: number
  readonly identity: string
  private readonly originalStamp: string
  private readonly children: ContextDirectory[] = []
  private listing: string | undefined
  private readonly observedFiles = new Map<string, string | null>()

  readonly registeredPath: string
  readonly label: string
  private readonly parent?: ContextDirectory

  constructor(registeredPath: string, label = '.', parent?: ContextDirectory) {
    this.registeredPath = registeredPath
    this.label = label
    this.parent = parent
    if (process.platform !== 'linux') throw new ContextReadError('safe_reads_unavailable')
    const path = parent ? join(parent.path, registeredPath) : realpathSync(registeredPath)
    this.fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const stat = fstatSync(this.fd)
    this.identity = hash(identity(stat))
    this.originalStamp = identity(stat)
  }

  get path(): string {
    return `/proc/self/fd/${this.fd}`
  }

  directory(name: string): ContextDirectory {
    const child = new ContextDirectory(
      name,
      this.label === '.' ? name : `${this.label}/${name}`,
      this,
    )
    this.children.push(child)
    return child
  }

  entry(name: string): Stats | null {
    try {
      return lstatSync(join(this.path, name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new ContextReadError('unreadable')
    }
  }

  list(): string[] {
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
    const entry = this.entry(name)
    if (!entry) {
      this.observedFiles.set(name, null)
      return null
    }
    if (!entry.isFile() || entry.isSymbolicLink()) throw new ContextReadError('unsafe_file')
    if (entry.size > maxBytes) throw new ContextReadError('byte_limit')
    let fd: number | undefined
    try {
      fd = openSync(
        join(this.path, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      const before = fstatSync(fd)
      if (!before.isFile() || stamp(entry) !== stamp(before))
        throw new ContextReadError('source_changed')
      const buffer = Buffer.alloc(Math.min(maxBytes + 1, before.size + 1))
      let size = 0
      while (size < buffer.length) {
        const count = readSync(fd, buffer, size, buffer.length - size, null)
        if (!count) break
        size += count
      }
      if (size > maxBytes || size !== before.size || stamp(fstatSync(fd)) !== stamp(before)) {
        throw new ContextReadError('source_changed')
      }
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
    const currentPath = this.parent
      ? join(this.parent.path, this.registeredPath)
      : realpathSync(this.registeredPath)
    const stat = lstatSync(currentPath)
    if (!stat.isDirectory() || identity(stat) !== this.originalStamp)
      throw new ContextReadError('root_changed')
    if (this.listing !== undefined && JSON.stringify(this.listNames()) !== this.listing) {
      throw new ContextReadError('source_changed')
    }
    for (const [name, previous] of this.observedFiles) {
      if (names && !names.has(name)) continue
      const current = this.entry(name)
      if ((current ? stamp(current) : null) !== previous)
        throw new ContextReadError('source_changed')
    }
    for (const child of this.children) {
      if (!skipGit || !child.label.split('/').includes('.git')) child.validate(skipGit, names)
    }
  }

  close(): void {
    for (const child of this.children) child.close()
    closeSync(this.fd)
  }
}
