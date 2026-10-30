import { createHash } from 'node:crypto'
import { type BigIntStats, fstatSync, realpathSync } from 'node:fs'
import { posix } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { ContextDirectory, ContextReadError } from '../repository-context/files.ts'
import { nativeMountIdentity } from './mounts.ts'

export const NATIVE_LAYOUT_LIMITS = Object.freeze({
  entries: 1_048_576,
  directories: 32_768,
  depth: 64,
  readableRoots: 256,
  deadlineMs: 5000,
})
type Reason =
  | 'unavailable'
  | 'changed'
  | 'limit'
  | 'special_file'
  | 'shared_inode'
  | 'symlink_escape'
  | 'nested_mount'
export class NativeLayoutError extends Error {
  readonly reason: Reason
  constructor(reason: Reason) {
    super('Native filesystem admission refused')
    this.reason = reason
  }
}
export interface NativeReadOnlyPath {
  readonly path: string
  readonly kind: 'file' | 'directory'
}
export interface NativeLayoutOptions {
  readonly registeredPath: string
  readonly writable: boolean
  /** Exact canonical roots already admitted by the daemon; not a model-configurable allowlist. */
  readonly readableRoots: readonly string[]
  readonly readOnlyPaths: readonly NativeReadOnlyPath[]
  readonly signal?: AbortSignal
}
export interface NativeLayoutCapture {
  /** Live daemon-private FD owner. Keep outside frozen/serialized worker DTOs. */
  readonly directory: ContextDirectory
  readonly canonicalPath: string
  readonly mountIdentity: string
  readonly writable: boolean
  readonly readableRoots: readonly string[]
  readonly readOnlyPaths: readonly NativeReadOnlyPath[]
  /** Readonly input symlink names whose targets add no root to the kernel's positive view. */
  readonly unavailableSymlinks: number
  /** Safety metadata only, never a code-content snapshot, test result or signalling authority. */
  readonly fingerprint: string
  readonly entries: number
  readonly directories: number
  revalidate(): Promise<void>
  close(): void
}
const captures = new WeakSet<object>()
const closedCaptures = new WeakSet<object>()
const within = (value: string, root: string) => value === root || value.startsWith(`${root}/`)
const stamp = (info: BigIntStats) =>
  [info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeNs, info.ctimeNs].map(String)
function canonical(value: string): string {
  if (
    typeof value !== 'string' ||
    !posix.isAbsolute(value) ||
    value === '/' ||
    value.endsWith('/') ||
    posix.normalize(value) !== value ||
    Buffer.byteLength(value) > 4096 ||
    Buffer.from(value, 'utf8').toString('utf8') !== value ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    throw new NativeLayoutError('unavailable')
  }
  return value
}
function sanitized(error: unknown): never {
  if (error instanceof NativeLayoutError) throw error
  if (error instanceof ContextReadError && ['source_changed', 'root_changed'].includes(error.code))
    throw new NativeLayoutError('changed')
  throw new NativeLayoutError('unavailable')
}

/**
 * Bounded full-tree safety admission, with no Git/ignore exclusions or file-content reads.
 * Linux traversal stays fd-relative; Darwin retains fs-safe registration/directory/file checks.
 * Two matching metadata passes are guarded observations, never an atomic namespace snapshot.
 * The exclusive workspace lease and kernel prevention of NEW escapes are separate requirements.
 */
export async function captureNativeLayout(
  options: NativeLayoutOptions,
): Promise<NativeLayoutCapture> {
  const signal = options.signal
  signal?.throwIfAborted()
  let directory: ContextDirectory | undefined
  try {
    if (
      !Array.isArray(options.readableRoots) ||
      !Array.isArray(options.readOnlyPaths) ||
      options.readableRoots.length > NATIVE_LAYOUT_LIMITS.readableRoots ||
      options.readOnlyPaths.length > NATIVE_LAYOUT_LIMITS.readableRoots ||
      typeof options.writable !== 'boolean'
    )
      throw new NativeLayoutError('unavailable')
    const writable = options.writable
    const registered = canonical(options.registeredPath)
    directory = new ContextDirectory(registered)
    const root = directory
    const rootPath = canonical(realpathSync(registered))
    const readable = Object.freeze(
      [...new Set([rootPath, ...options.readableRoots.map(canonical)])].sort(),
    )
    const protectedPaths = Object.freeze(
      options.readOnlyPaths
        .map((input) => {
          if (!input || !['file', 'directory'].includes(input.kind))
            throw new NativeLayoutError('unavailable')
          return Object.freeze({ path: canonical(input.path), kind: input.kind })
        })
        .sort(
          (left, right) =>
            left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind),
        ),
    )
    const mount = nativeMountIdentity(root, writable)

    async function scan(deadline: number) {
      const hash = createHash('sha256')
      hash.update(
        JSON.stringify(['native-layout-v1', rootPath, mount, writable, readable, protectedPaths]),
      )
      let entries = 0,
        directories = 0,
        unavailableSymlinks = 0
      const shared = new Map<
        string,
        { count: bigint; links: bigint; writable: boolean; readonly: boolean }
      >()
      const check = () => {
        signal?.throwIfAborted()
        if (performance.now() > deadline) throw new NativeLayoutError('limit')
      }
      function isWritable(absolute: string): boolean {
        return (
          writable &&
          !protectedPaths.some((input) =>
            input.kind === 'file' ? input.path === absolute : within(absolute, input.path),
          )
        )
      }
      async function walk(
        cursor: ContextDirectory,
        relative: string,
        depth: number,
      ): Promise<void> {
        check()
        if (depth > NATIVE_LAYOUT_LIMITS.depth || ++directories > NATIVE_LAYOUT_LIMITS.directories)
          throw new NativeLayoutError('limit')
        if (nativeMountIdentity(cursor, writable) !== mount)
          throw new NativeLayoutError('nested_mount')
        hash.update(
          JSON.stringify([relative, 'directory', ...stamp(fstatSync(cursor.fd, { bigint: true }))]),
        )
        for (const name of cursor.list()) {
          check()
          if (++entries > NATIVE_LAYOUT_LIMITS.entries) throw new NativeLayoutError('limit')
          const info = cursor.metadata(name)
          if (!info || info.ino <= 0n) throw new NativeLayoutError('changed')
          const rel = relative ? `${relative}/${name}` : name
          const absolute = posix.join(rootPath, rel)
          const metadata = [rel, ...stamp(info)]
          if (info.isDirectory()) {
            hash.update(JSON.stringify(metadata))
            await cursor.visitDirectory(name, (child) => walk(child, rel, depth + 1))
          } else if (info.isFile()) {
            if (info.nlink <= 0n) throw new NativeLayoutError('unavailable')
            if (writable && info.nlink > 1n) {
              const key = `${info.dev}:${info.ino}`
              const writable = isWritable(absolute)
              const previous = shared.get(key)
              if (previous) {
                if (previous.links !== info.nlink) throw new NativeLayoutError('changed')
                previous.count++
                previous.writable ||= writable
                previous.readonly ||= !writable
              } else
                shared.set(key, { count: 1n, links: info.nlink, writable, readonly: !writable })
            }
            hash.update(JSON.stringify(metadata))
          } else if (info.isSymbolicLink()) {
            if (info.size > 4096n) throw new NativeLayoutError('limit')
            const target = cursor.readLink(name)
            const lexical = posix.resolve(posix.dirname(absolute), target)
            let resolved: string | null = null
            if (readable.some((allowed) => within(lexical, allowed))) {
              try {
                resolved = realpathSync(posix.join(cursor.path, name))
              } catch {
                /* No new root. */
              }
              if (resolved && !readable.some((allowed) => within(resolved as string, allowed)))
                resolved = null
            }
            if (resolved === null) {
              if (writable) throw new NativeLayoutError('symlink_escape')
              // An immutable input may contain unavailable names. Record them; never discover or
              // mount their outside targets. The launch view MUST retain this capture as readonly,
              // prevent new link/rename escapes and include only the already-admitted roots.
              unavailableSymlinks++
            }
            hash.update(JSON.stringify([...metadata, target, resolved]))
          } else throw new NativeLayoutError('special_file')
          if (entries % 64 === 0) {
            await setImmediate()
            check()
          }
        }
        cursor.validate()
      }
      await walk(root, '', 0)
      for (const value of shared.values()) {
        if (value.writable && (value.count !== value.links || value.readonly))
          throw new NativeLayoutError('shared_inode')
      }
      root.validateIdentity()
      if (realpathSync(registered) !== rootPath) throw new NativeLayoutError('changed')
      check()
      return { fingerprint: hash.digest('hex'), entries, directories, unavailableSymlinks }
    }
    const deadline = performance.now() + NATIVE_LAYOUT_LIMITS.deadlineMs
    const first = await scan(deadline)
    const second = await scan(deadline)
    if (first.fingerprint !== second.fingerprint) throw new NativeLayoutError('changed')
    const capture: NativeLayoutCapture = Object.freeze({
      directory: root,
      canonicalPath: rootPath,
      mountIdentity: mount,
      writable,
      readableRoots: readable,
      readOnlyPaths: protectedPaths,
      ...second,
      async revalidate() {
        assertNativeLayoutCapture(capture)
        try {
          const current = await scan(performance.now() + NATIVE_LAYOUT_LIMITS.deadlineMs)
          if (current.fingerprint !== first.fingerprint) throw new NativeLayoutError('changed')
        } catch (error) {
          sanitized(error)
        }
      },
      close() {
        if (closedCaptures.has(capture)) return
        closedCaptures.add(capture)
        root.close()
      },
    })
    captures.add(capture)
    directory = undefined
    return capture
  } catch (error) {
    directory?.close()
    if (signal?.aborted) signal.throwIfAborted()
    sanitized(error)
  }
}

export function assertNativeLayoutCapture(value: unknown): asserts value is NativeLayoutCapture {
  if (
    typeof value !== 'object' ||
    value === null ||
    !captures.has(value) ||
    closedCaptures.has(value)
  )
    throw new NativeLayoutError('unavailable')
}
