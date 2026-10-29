import { createHash } from 'node:crypto'
import {
  fstatSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { release, version } from 'node:os'
import { dirname, join } from 'node:path'
import type { NativeExecutionFacts } from '@bazilion/api-types'
import {
  compileDarwinSeatbeltPolicy,
  DARWIN_NATIVE_POLICY,
} from '../../runtime/shell/native/seatbelt.ts'
import { compileLinuxSeccompFilter } from '../../runtime/shell/native/seccomp.ts'
import { DarwinCensusReader, getDarwinCensusCalls } from '../process/darwin-census.ts'
import { getLinuxPidfdCalls } from '../process/linux.ts'
import { ContextDirectory } from '../repository-context/files.ts'
import { type NativeBackend, type NativeEntryArtifacts, stageNativeEntry } from './artifacts.ts'
import { captureLinuxElfClosure } from './elf.ts'
import { captureNativeFile, type NativeFileCapture } from './files.ts'
import { captureNativeLayout, type NativeLayoutCapture, NativeLayoutError } from './layout.ts'
import { nativeMountIdentity } from './mounts.ts'

const PROGRAMS = Object.freeze([
  '/usr/bin/bash',
  '/usr/bin/true',
  '/usr/bin/cat',
  '/usr/bin/ls',
  '/usr/bin/grep',
  '/usr/bin/sed',
  '/usr/bin/find',
  '/usr/bin/sleep',
  '/usr/bin/env',
  '/usr/bin/git',
  '/usr/bin/mkdir',
  '/usr/bin/cp',
  '/usr/bin/mv',
  '/usr/bin/rm',
  '/usr/bin/touch',
])
export type NativeRuntimeFacts = NativeExecutionFacts
/** Daemon-private frozen toolchain owner, not availability/turn admission or a wire capability. */
export interface NativeRuntime {
  readonly facts: NativeRuntimeFacts
  readonly rootPath: string
  readonly node: string
  readonly manager: NativeFileCapture
  readonly entry: NativeEntryArtifacts
  readonly files: readonly NativeFileCapture[]
  readonly directories: readonly NativeLayoutCapture[]
  readonly bindings: readonly { readonly path: string; readonly file: NativeFileCapture }[]
  readonly metadataDirectories: readonly string[]
  /** A copy: every namespace gets a fresh offset-zero filter descriptor. */
  seccompBytes(): Buffer
  revalidate(): Promise<void>
  /** Refuses new jobs; actual closure waits for every retained view, including uncertain jobs. */
  close(): boolean
}
export interface NativeRuntimeLoan {
  readonly runtime: NativeRuntime
  release(): void
}
interface State {
  closing: boolean
  closed: boolean
  loans: number
  finish(): boolean
}
const states = new WeakMap<object, State>()
const refusal = () => new NativeLayoutError('unavailable')
function state(runtime: NativeRuntime): State {
  const value = states.get(runtime)
  if (!value || value.closed) throw refusal()
  return value
}
export function retainNativeRuntime(runtime: NativeRuntime): NativeRuntimeLoan {
  const value = state(runtime)
  if (value.closing) throw refusal()
  value.loans++
  let released = false
  return Object.freeze({
    runtime,
    release() {
      if (released) return
      released = true
      value.loans--
      value.finish()
    },
  })
}
function pinnedKoffi() {
  const require = createRequire(import.meta.url),
    entry = realpathSync(require.resolve('koffi')),
    root = dirname(entry)
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
    ffi = require('koffi') as typeof import('koffi')
  if (pkg.name !== 'koffi' || pkg.version !== '3.3.3' || ffi.version !== '3.3.3') throw refusal()
  const nativeRoot = dirname(
    realpathSync(createRequire(entry).resolve('@koromix/koffi-darwin-arm64')),
  )
  const native = JSON.parse(readFileSync(join(nativeRoot, 'package.json'), 'utf8'))
  if (native.name !== '@koromix/koffi-darwin-arm64' || native.version !== '3.3.3') throw refusal()
  return { root, nativeRoot }
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

/** Capture once before model invocation. Revalidation never adopts changed code/libraries. */
export async function prepareNativeRuntime(
  privateRoot: string,
  signal?: AbortSignal,
): Promise<NativeRuntime> {
  let root: ContextDirectory | undefined,
    entry: NativeEntryArtifacts | undefined,
    manager: NativeFileCapture | undefined,
    nodeFile: NativeFileCapture | undefined,
    closure: ReturnType<typeof captureLinuxElfClosure> | undefined
  const directories: NativeLayoutCapture[] = []
  const systems: { directory: ContextDirectory; mount: string; stamp: string }[] = []
  const systemStamp = (directory: ContextDirectory) => {
    const info = fstatSync(directory.fd, { bigint: true })
    if (info.uid !== 0n || (info.mode & 0o22n) !== 0n) throw refusal()
    return [info.dev, info.ino, info.mode, info.uid, info.gid, info.mtimeNs, info.ctimeNs]
      .map(String)
      .join(':')
  }
  const lifetime = new AbortController(),
    captureSignal = AbortSignal.any([...(signal ? [signal] : []), lifetime.signal])
  const begin = () => {
    const timer = setTimeout(() => lifetime.abort(new NativeLayoutError('limit')), 5000)
    timer.unref()
    return timer
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const backend: NativeBackend =
      process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch)
        ? 'linux-bwrap'
        : process.platform === 'darwin' && process.arch === 'arm64'
          ? 'darwin-seatbelt'
          : (() => {
              throw refusal()
            })()
    captureSignal.throwIfAborted()
    const info = lstatSync(privateRoot)
    if (
      realpathSync(privateRoot) !== privateRoot ||
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700 ||
      readdirSync(privateRoot).length
    )
      throw refusal()
    root = new ContextDirectory(privateRoot)
    const control = join(privateRoot, 'control')
    mkdirSync(control, { mode: 0o700 })
    entry = stageNativeEntry(control, backend)
    const node = realpathSync(process.execPath)
    manager = captureNativeFile({
      path: backend === 'linux-bwrap' ? '/usr/bin/bwrap' : '/usr/bin/sandbox-exec',
      executable: true,
      rootOwned: true,
    })
    if (manager.canonicalPath !== manager.requestedPath) throw refusal()
    let filter: Buffer = Buffer.alloc(0)
    let policyFingerprint: string
    const metadataDirectories: string[] = []
    if (backend === 'linux-bwrap') {
      const calls = getLinuxPidfdCalls(),
        self = calls.open(process.pid)
      try {
        if (self.fd < 0 || self.errno !== 0 || calls.state(self.fd) !== 'live') throw refusal()
      } finally {
        if (self.fd >= 0) calls.close(self.fd)
      }
      const triplet = process.arch === 'x64' ? 'x86_64-linux-gnu' : 'aarch64-linux-gnu'
      const libraries = [
        ...new Set(
          [
            '/usr/lib',
            '/usr/lib64',
            '/lib',
            '/lib64',
            `/usr/lib/${triplet}`,
            `/lib/${triplet}`,
          ].flatMap((path) => {
            try {
              return [realpathSync(path)]
            } catch {
              return []
            }
          }),
        ),
      ]
      closure = captureLinuxElfClosure([...PROGRAMS, node], libraries)
      filter = compileLinuxSeccompFilter(process.arch as 'x64' | 'arm64')
      policyFingerprint = digest(filter)
    } else {
      if ('kind' in new DarwinCensusReader(getDarwinCensusCalls()).ownIdentity()) throw refusal()
      for (const path of ['/System/Library', '/usr/lib', '/bin', '/usr/bin']) {
        const directory = new ContextDirectory(path)
        try {
          systems.push({
            directory,
            mount: nativeMountIdentity(directory, false),
            stamp: systemStamp(directory),
          })
        } catch (error) {
          directory.close()
          throw error
        }
      }
      nodeFile = captureNativeFile({ path: node, executable: true })
      const koffi = pinnedKoffi(),
        modules = join(control, 'node_modules')
      mkdirSync(modules, { mode: 0o700 })
      symlinkSync(koffi.root, join(modules, 'koffi'), 'dir')
      const readableRoots = [
        koffi.root,
        koffi.nativeRoot,
        '/System/Library',
        '/usr/lib',
        '/bin',
        '/usr/bin',
      ].sort()
      timer = begin()
      for (const registeredPath of [koffi.root, koffi.nativeRoot])
        directories.push(
          await captureNativeLayout({
            registeredPath,
            writable: false,
            readableRoots,
            readOnlyPaths: [],
            signal: captureSignal,
          }),
        )
      clearTimeout(timer)
      timer = undefined
      metadataDirectories.push(dirname(koffi.root), dirname(koffi.nativeRoot), modules)
      // Canonical serialization shape captures every policy branch without ephemeral job paths.
      policyFingerprint = digest(
        JSON.stringify([
          DARWIN_NATIVE_POLICY,
          compileDarwinSeatbeltPolicy({
            workspace: '/bazilion-native-contract/workspace',
            scratch: '/bazilion-native-contract/scratch',
            ipcDirectory: '/bazilion-native-contract/scratch/ipc',
            readOnlyInputs: [
              { path: '/bazilion-native-contract/code', kind: 'directory', executable: true },
              { path: '/bazilion-native-contract/input', kind: 'file', executable: false },
            ],
            metadataDirectories: ['/bazilion-native-contract/metadata'],
            unavailableInputs: [{ path: '/bazilion-native-contract/private', kind: 'directory' }],
          }),
        ]),
      )
    }
    const files = Object.freeze([
      ...(closure?.files ?? []),
      ...(nodeFile ? [nodeFile] : []),
      ...entry.files,
    ])
    const fingerprint = digest(
      JSON.stringify([
        'native-runtime-v1',
        backend,
        process.arch,
        process.version,
        release(),
        version(),
        policyFingerprint,
        manager.fingerprint,
        entry.fingerprint,
        closure?.files.map((file) => file.fingerprint) ?? nodeFile?.fingerprint,
        directories.map((directory) => directory.fingerprint),
        systems.map((system) => [system.directory.identity, system.mount, system.stamp]),
      ]),
    )
    const held = { root, entry, manager, nodeFile, closure }
    let validating = false
    const value: State = {
      closing: false,
      closed: false,
      loans: 0,
      finish() {
        if (value.closed) return true
        if (!value.closing || value.loans) return false
        value.closed = true
        lifetime.abort(refusal())
        for (const directory of directories) directory.close()
        for (const system of systems) system.directory.close()
        held.entry.close()
        held.nodeFile?.close()
        held.closure?.close()
        held.manager.close()
        held.root.close()
        return true
      },
    }
    const runtime: NativeRuntime = Object.freeze({
      rootPath: privateRoot,
      facts: Object.freeze({
        backend,
        architecture: process.arch as 'x64' | 'arm64',
        nodeVersion: process.version,
        kernelRelease: release(),
        policyFingerprint,
        fingerprint,
      }),
      node,
      manager,
      entry,
      files,
      directories: Object.freeze(directories),
      bindings: Object.freeze(closure?.bindings ?? []),
      metadataDirectories: Object.freeze(metadataDirectories),
      seccompBytes() {
        state(runtime)
        if (backend !== 'linux-bwrap') throw refusal()
        return Buffer.from(filter)
      },
      async revalidate() {
        state(runtime)
        if (validating) throw refusal()
        validating = true
        const timer = begin()
        try {
          captureSignal.throwIfAborted()
          held.root.validateIdentity()
          for (const system of systems) {
            system.directory.validateIdentity()
            if (
              nativeMountIdentity(system.directory, false) !== system.mount ||
              systemStamp(system.directory) !== system.stamp
            )
              throw new NativeLayoutError('changed')
          }
          held.manager.revalidate()
          held.nodeFile?.revalidate()
          held.closure?.revalidate()
          for (const file of held.entry.files) file.revalidate()
          for (const directory of directories) await directory.revalidate()
          captureSignal.throwIfAborted()
          state(runtime)
        } finally {
          clearTimeout(timer)
          validating = false
        }
      },
      close() {
        value.closing = true
        return value.finish()
      },
    })
    root.validateIdentity()
    captureSignal.throwIfAborted()
    states.set(runtime, value)
    return runtime
  } catch (error) {
    clearTimeout(timer)
    for (const directory of directories) directory.close()
    for (const system of systems) system.directory.close()
    nodeFile?.close()
    closure?.close()
    entry?.close()
    manager?.close()
    root?.close()
    if (error instanceof NativeLayoutError) throw error
    throw refusal()
  }
}
