import { createHash } from 'node:crypto'
import { fstatSync, realpathSync } from 'node:fs'
import { posix } from 'node:path'
import { ContextDirectory } from '../repository-context/files.ts'
import { nativeTrustedCodeRoot } from './artifacts.ts'
import { captureNativeFile, type NativeFileCapture, type NativeFileOptions } from './files.ts'
import {
  captureNativeLayout,
  type NativeLayoutCapture,
  NativeLayoutError,
  type NativeReadOnlyPath,
} from './layout.ts'

export interface NativeInputsOptions {
  readonly workspace: string
  readonly readOnlyDirectories: readonly string[]
  readonly readOnlyFiles: readonly NativeFileOptions[]
  readonly unavailable: readonly NativeReadOnlyPath[]
  readonly signal?: AbortSignal
}
export interface NativeInputs {
  /** All live objects stay daemon-private; this is not a worker DTO or recovered capability. */
  readonly workspace: NativeLayoutCapture
  readonly directories: readonly NativeLayoutCapture[]
  readonly files: readonly NativeFileCapture[]
  readonly unavailable: readonly NativeReadOnlyPath[]
  readonly fingerprint: string
  revalidate(): Promise<void>
  close(): void
}
const owners = new WeakSet<object>()
const closed = new WeakSet<object>()
const refusal = () => new NativeLayoutError('unavailable')
const within = (a: string, b: string) => a === b || a.startsWith(`${b}/`)
const overlap = (a: string, b: string) => within(a, b) || within(b, a)
function path(value: string): string {
  if (
    typeof value !== 'string' ||
    !posix.isAbsolute(value) ||
    value === '/' ||
    posix.normalize(value) !== value ||
    value.endsWith('/') ||
    Buffer.byteLength(value) > 4096 ||
    Buffer.from(value, 'utf8').toString('utf8') !== value ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw refusal()
  return value
}

/**
 * Per-command safety capture under the caller's exclusive workspace lease. Workspace writes are
 * expected between positively settled commands: take a NEW capture, never silently rebind a live
 * one or treat these metadata fingerprints as frozen source/test evidence. Toolchain admission
 * and kernel launch installation are separate; this function alone grants no execution.
 */
export async function captureNativeInputs(options: NativeInputsOptions): Promise<NativeInputs> {
  const directories: NativeLayoutCapture[] = []
  const files: NativeFileCapture[] = []
  let registration: ContextDirectory | undefined
  let workspace: NativeLayoutCapture | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const lifetime = new AbortController()
  const originalSignal = options.signal
  const signal = AbortSignal.any([...(originalSignal ? [originalSignal] : []), lifetime.signal])
  const startBudget = () => {
    const timer = setTimeout(() => lifetime.abort(new NativeLayoutError('limit')), 5000)
    timer.unref()
    return timer
  }
  try {
    if (
      !['linux', 'darwin'].includes(process.platform) ||
      !Array.isArray(options.readOnlyDirectories) ||
      !Array.isArray(options.readOnlyFiles) ||
      !Array.isArray(options.unavailable) ||
      options.readOnlyDirectories.length + options.readOnlyFiles.length > 250 ||
      options.unavailable.length > 256
    )
      throw refusal()
    timer = startBudget()
    signal.throwIfAborted()
    const registered = path(options.workspace)
    const canonical = path(realpathSync(registered))
    if (overlap(canonical, realpathSync(nativeTrustedCodeRoot()))) throw refusal()
    registration = new ContextDirectory(registered)
    const original = fstatSync(registration.fd, { bigint: true })
    const memory = posix.join(canonical, 'memory')
    if (!registration.metadata('memory')?.isDirectory() || realpathSync(memory) !== memory)
      throw refusal()
    const readonlyDirectories = [
      ...new Set([posix.join(registered, 'memory'), ...options.readOnlyDirectories.map(path)]),
    ].sort()
    const canonicalDirectories = readonlyDirectories.map((value) => path(realpathSync(value)))
    const readonlyFiles = options.readOnlyFiles.map((value) =>
      Object.freeze({ ...value, path: path(value.path) }),
    )
    const unavailable = Object.freeze(
      options.unavailable.map((value) => {
        if (!value || !['file', 'directory'].includes(value.kind)) throw refusal()
        return Object.freeze({ path: path(value.path), kind: value.kind })
      }),
    )
    if (unavailable.some((value) => overlap(canonical, value.path))) throw refusal()
    for (const value of readonlyFiles) files.push(captureNativeFile(value))
    const readonly: NativeReadOnlyPath[] = [
      ...[...new Set(canonicalDirectories)].map((path) => ({ path, kind: 'directory' as const })),
      ...files.map((file) => ({ path: file.canonicalPath, kind: 'file' as const })),
    ]
    if (
      readonly.some(
        (value) =>
          value.path === canonical ||
          (value.kind === 'directory' && within(canonical, value.path)) ||
          unavailable.some((blocked) => overlap(value.path, blocked.path)),
      )
    )
      throw refusal()
    const readableRoots = [
      ...new Set([
        canonical,
        ...readonly.map((value) => value.path),
        ...(process.platform === 'darwin'
          ? ['/System/Library', '/usr/lib', '/bin', '/usr/bin']
          : []),
      ]),
    ].sort()
    if (readableRoots.length > 256) throw refusal()
    for (const [index, registeredPath] of readonlyDirectories.entries()) {
      signal.throwIfAborted()
      const captured = await captureNativeLayout({
        registeredPath,
        writable: false,
        readableRoots,
        readOnlyPaths: [],
        signal,
      })
      directories.push(captured)
      if (captured.canonicalPath !== canonicalDirectories[index]) throw refusal()
    }
    workspace = await captureNativeLayout({
      registeredPath: registered,
      writable: true,
      readableRoots,
      readOnlyPaths: readonly,
      signal,
    })
    registration.validateIdentity()
    const captured = fstatSync(workspace.directory.fd, { bigint: true })
    if (
      workspace.canonicalPath !== canonical ||
      original.dev !== captured.dev ||
      original.ino !== captured.ino
    )
      throw refusal()
    signal.throwIfAborted()
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          'native-inputs-v1',
          workspace.fingerprint,
          directories.map((value) => value.fingerprint),
          files.map((value) => value.fingerprint),
          unavailable,
        ]),
      )
      .digest('hex')
    const admitted = workspace
    let validating = false
    clearTimeout(timer)
    timer = undefined
    const result: NativeInputs = Object.freeze({
      workspace: admitted,
      directories: Object.freeze(directories),
      files: Object.freeze(files),
      unavailable,
      fingerprint,
      async revalidate() {
        assertNativeInputs(result)
        if (validating) throw refusal()
        validating = true
        const timer = startBudget()
        try {
          for (const file of files) {
            signal.throwIfAborted()
            file.revalidate()
          }
          for (const directory of [admitted, ...directories]) {
            signal.throwIfAborted()
            await directory.revalidate()
          }
          signal.throwIfAborted()
          assertNativeInputs(result)
        } finally {
          clearTimeout(timer)
          validating = false
        }
      },
      close() {
        if (closed.has(result)) return
        closed.add(result)
        lifetime.abort(refusal())
        admitted.close()
        for (const directory of directories) directory.close()
        for (const file of files) file.close()
      },
    })
    registration.close()
    registration = undefined
    owners.add(result)
    return result
  } catch (error) {
    clearTimeout(timer)
    registration?.close()
    workspace?.close()
    for (const directory of directories) directory.close()
    for (const file of files) file.close()
    if (error instanceof NativeLayoutError) throw error
    throw refusal()
  }
}
export function assertNativeInputs(value: unknown): asserts value is NativeInputs {
  if (!value || typeof value !== 'object' || !owners.has(value) || closed.has(value))
    throw refusal()
}
