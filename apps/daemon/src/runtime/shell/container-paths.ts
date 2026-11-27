// Container paths for the file tools of a Docker turn. Commands see the Team workspace at
// /workspace (memory/ read-only), uploads at /inputs and skills under /skills; the file tools take
// the same paths and work on the host folders behind them. A path is checked by its real location,
// so a symlink in the workspace cannot lead a tool outside the mounts, nor into a read-only one;
// files are read and written through the contained-file helpers, which also refuse a link swapped
// in while they open the file.

import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { isContained, readContainedFile, writeContainedFile } from '../safe-files.ts'

export interface ContainerMount {
  /** Absolute path inside the container. */
  target: string
  /** Host directory behind it. */
  source: string
  writable: boolean
}

interface RealMount extends ContainerMount {
  /** `source` resolved, so real paths can be matched against it. */
  real: string
}

export interface ResolvedPath {
  /** The host path, through real directories. */
  host: string
  /** The real directory of the mount that holds it. */
  root: string
}

export class ContainerPaths {
  readonly #mounts: RealMount[]

  constructor(mounts: readonly ContainerMount[]) {
    // Longest target first, so /workspace/memory wins over /workspace.
    this.#mounts = mounts
      .filter((mount) => existsSync(mount.source))
      .map((mount) => ({ ...mount, real: realpathSync(mount.source) }))
      .sort((a, b) => b.target.length - a.target.length)
  }

  /** `text` with each mount's host folder written as its container path. */
  toContainer(text: string): string {
    let out = text
    // Longest source first, so a mount inside another is named by its own target.
    for (const mount of [...this.#mounts].sort((a, b) => b.real.length - a.real.length)) {
      out = out.replaceAll(mount.real, mount.target)
      if (mount.source !== mount.real) out = out.replaceAll(mount.source, mount.target)
    }
    return out
  }

  /** The host path behind a container path, by its mount only: no symlink is resolved. */
  lexical(containerPath: string): string {
    const path = posix.normalize(containerPath)
    if (!posix.isAbsolute(path)) throw new Error(`Not an absolute path: ${containerPath}`)
    const mount = this.#mounts.find((m) => path === m.target || path.startsWith(`${m.target}/`))
    if (!mount) {
      throw new Error(
        `${containerPath} is outside what the file tools can reach: /workspace, /inputs and /skills.`,
      )
    }
    const rel = posix.relative(mount.target, path)
    return rel ? join(mount.real, ...rel.split('/')) : mount.real
  }

  /**
   * The host path behind a container path, checked by its real location: an existing path must
   * resolve inside a mount (a writable one for `write`); a new one is checked by its nearest
   * existing parent.
   */
  resolve(containerPath: string, access: 'read' | 'write'): ResolvedPath {
    const host = this.lexical(containerPath)
    let existing = host
    const missing: string[] = []
    while (!existsSync(existing)) {
      const parent = dirname(existing)
      if (parent === existing) break
      missing.unshift(existing.slice(parent.length + 1))
      existing = parent
    }
    const real = realpathSync(existing)
    const holder = this.#mounts
      .filter((m) => isContained(m.real, real))
      .sort((a, b) => b.real.length - a.real.length)[0]
    if (!holder) throw new Error(`${containerPath} leads outside /workspace, /inputs and /skills.`)
    if (access === 'write' && !holder.writable) {
      throw new Error(`${this.toContainer(real)} is read-only.`)
    }
    return { host: missing.length > 0 ? join(real, ...missing) : real, root: holder.real }
  }

  /** The container path of a host path inside a mount; the path itself when none holds it. */
  containerPathOf(hostPath: string): string {
    for (const mount of [...this.#mounts].sort((a, b) => b.real.length - a.real.length)) {
      if (isContained(mount.real, hostPath)) {
        const rel = relative(mount.real, hostPath)
        return rel ? posix.join(mount.target, ...rel.split(sep)) : mount.target
      }
    }
    return hostPath
  }

  exists(containerPath: string): boolean {
    try {
      return existsSync(this.resolve(containerPath, 'read').host)
    } catch {
      return false
    }
  }

  readFile(containerPath: string): Buffer {
    const { host, root } = this.resolve(containerPath, 'read')
    return readContainedFile(host, root, statSync(host).size)
  }

  writeFile(containerPath: string, content: string | Buffer): void {
    const { host, root } = this.resolve(containerPath, 'write')
    writeContainedFile(host, root, content)
  }

  /** Create a directory and its missing parents, each checked to stay in a writable mount. */
  mkdir(containerPath: string): void {
    const { host, root } = this.resolve(containerPath, 'write')
    if (existsSync(host)) {
      if (!statSync(host).isDirectory()) throw new Error(`${containerPath} is not a directory.`)
      return
    }
    mkdirSync(host, { recursive: true })
    if (!isContained(root, realpathSync(host))) throw new Error(`${containerPath} left its mount.`)
  }

  access(containerPath: string, mode: 'read' | 'write'): void {
    const { host } = this.resolve(containerPath, mode)
    accessSync(host, mode === 'read' ? constants.R_OK : constants.R_OK | constants.W_OK)
  }

  /** Whether the entry is a directory; a link that leads outside counts as a file. */
  isDirectory(containerPath: string): boolean {
    try {
      return statSync(this.resolve(containerPath, 'read').host).isDirectory()
    } catch {
      return lstatSync(this.lexical(containerPath)).isDirectory()
    }
  }

  readdir(containerPath: string): string[] {
    return readdirSync(this.resolve(containerPath, 'read').host)
  }

  /** Remove a file: the entry named itself, never what a link there points at. */
  remove(containerPath: string): void {
    const path = posix.normalize(containerPath)
    const parent = this.resolve(posix.dirname(path), 'write')
    const entry = join(parent.host, posix.basename(path))
    if (lstatSync(entry).isDirectory()) throw new Error(`${containerPath} is a directory.`)
    unlinkSync(entry)
  }
}
