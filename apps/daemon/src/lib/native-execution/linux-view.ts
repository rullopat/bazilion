import { createHash } from 'node:crypto'
import {
  fstatSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { ContextDirectory } from '../repository-context/files.ts'
import { captureNativeFile, type NativeFileCapture } from './files.ts'
import { captureNativeInputs, type NativeInputs } from './inputs.ts'
import { captureNativeLayout, type NativeLayoutCapture, NativeLayoutError } from './layout.ts'
import {
  type NativeRuntime,
  type NativeRuntimeFacts,
  type NativeRuntimeLoan,
  retainNativeRuntime,
} from './runtime.ts'

import { type NativeViewOptions, snapshotNativeViewOptions } from './view-options.ts'

export type NativeLinuxViewOptions = NativeViewOptions
export interface NativeLinuxView {
  readonly backend: 'linux-bwrap'
  readonly definition: string
  readonly runtimeFacts: NativeRuntimeFacts
  readonly workspace: string
  readonly workspaceIdentity: string
  readonly cwd: string
  readonly env: Readonly<NodeJS.ProcessEnv>
  readonly manager: NativeFileCapture
  readonly stdio: readonly (number | 'pipe')[]
  arguments(nonce: string): string[]
  revalidate(): Promise<void>
  /** FD closure only. Caller must retain this owner and the slot through uncertain creation/exit. */
  close(): void
}
const owners = new WeakSet<object>(),
  closed = new WeakSet<object>()
const refusal = () => new NativeLayoutError('unavailable')
const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)

/** Minimal FD-mounted launch plan. No model/profile/command arguments or host-tree fallback. */
export async function prepareNativeLinuxView(
  input: NativeLinuxViewOptions,
  runtime: NativeRuntime,
): Promise<NativeLinuxView> {
  const options = snapshotNativeViewOptions(input)
  let root: ContextDirectory | undefined,
    scratch: NativeLayoutCapture | undefined,
    loan: NativeRuntimeLoan | undefined,
    inputs: NativeInputs | undefined,
    filter: NativeFileCapture | undefined,
    cwd: ContextDirectory | undefined
  try {
    if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw refusal()
    options.signal?.throwIfAborted()
    loan = retainNativeRuntime(runtime)
    if (runtime.facts.backend !== 'linux-bwrap') throw refusal()
    await runtime.revalidate()
    const node = runtime.node,
      manager = runtime.manager,
      entry = runtime.entry
    const relative = options.cwd,
      values = options.env
    const privateRoot = realpathSync(options.root),
      info = lstatSync(options.root)
    if (
      privateRoot !== options.root ||
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700 ||
      readdirSync(privateRoot).length ||
      overlaps(privateRoot, realpathSync(options.workspace)) ||
      overlaps(runtime.rootPath, realpathSync(options.workspace)) ||
      overlaps(runtime.rootPath, privateRoot)
    )
      throw refusal()
    root = new ContextDirectory(privateRoot)
    const control = join(privateRoot, 'control'),
      temporary = join(privateRoot, 'scratch')
    mkdirSync(control, { mode: 0o700 })
    mkdirSync(temporary, { mode: 0o700 })
    for (const name of ['home', 'tmp', 'ipc']) mkdirSync(join(temporary, name), { mode: 0o700 })
    const filterBytes = runtime.seccompBytes()
    const filterPath = join(control, 'seccomp.bpf')
    writeFileSync(filterPath, filterBytes, { mode: 0o400, flag: 'wx' })
    filter = captureNativeFile({ path: filterPath, executable: false })
    const observedFilter = Buffer.alloc(filterBytes.length)
    if (
      fstatSync(filter.fd).size !== filterBytes.length ||
      readSync(filter.fd, observedFilter, 0, observedFilter.length, 0) !== observedFilter.length ||
      !observedFilter.equals(filterBytes)
    )
      throw refusal()
    inputs = await captureNativeInputs({
      ...options,
      readOnlyFiles: [
        ...options.readOnlyFiles,
        ...runtime.files.map((file) => ({ path: file.canonicalPath, executable: file.executable })),
      ],
    })
    cwd =
      relative === '.'
        ? new ContextDirectory(inputs.workspace.canonicalPath)
        : inputs.workspace.directory.directory(relative)
    cwd.validateIdentity()
    const commandCwd = posix.join(inputs.workspace.canonicalPath, relative)
    if (realpathSync(cwd.path) !== commandCwd) throw refusal()
    const env = Object.freeze({
      ...values,
      PATH: `${dirname(node)}:/usr/bin:/bin`,
      HOME: join(temporary, 'home'),
      TMPDIR: join(temporary, 'ipc'),
      LANG: 'C',
      LC_ALL: 'C',
      SHELL: '/usr/bin/bash',
      PWD: commandCwd,
      TZ: 'UTC',
    })
    scratch = await captureNativeLayout({
      registeredPath: temporary,
      writable: true,
      readableRoots: [],
      readOnlyPaths: [],
      signal: options.signal,
    })
    const args = [
      '--unshare-user',
      '--unshare-pid',
      '--unshare-net',
      '--unshare-ipc',
      '--unshare-uts',
      '--die-with-parent',
      '--new-session',
      '--cap-drop',
      'ALL',
      '--dir',
      '/usr/bin',
      '--dir',
      '/usr/lib',
      '--symlink',
      'usr/bin',
      '/bin',
      '--symlink',
      'usr/lib',
      '/lib',
      '--symlink',
      'usr/lib',
      '/lib64',
      '--proc',
      '/proc',
      '--remount-ro',
      '/proc',
      '--dev',
      '/dev',
      '--chdir',
      commandCwd,
      '--seccomp',
      '3',
      '--json-status-fd',
      '4',
      '--block-fd',
      '5',
    ]
    const descriptors: (number | 'pipe')[] = ['pipe', 'pipe', 'pipe', filter.fd, 'pipe', 'pipe']
    const destinations = new Map<string, number>()
    function bind(fd: number, target: string, writable: boolean) {
      const previous = destinations.get(target)
      if (previous !== undefined) {
        if (previous !== fd) throw refusal()
        return
      }
      destinations.set(target, fd)
      args.push(writable ? '--bind-fd' : '--ro-bind-fd', String(descriptors.length), target)
      descriptors.push(fd)
    }
    bind(inputs.workspace.directory.fd, inputs.workspace.canonicalPath, true)
    bind(scratch.directory.fd, temporary, true)
    const mountedDirectories = new Set<string>()
    for (const directory of inputs.directories) {
      if (mountedDirectories.has(directory.canonicalPath)) continue
      mountedDirectories.add(directory.canonicalPath)
      bind(directory.directory.fd, directory.canonicalPath, false)
    }
    const libraryFiles = new Set(runtime.bindings.map((binding) => binding.file.canonicalPath))
    for (const binding of runtime.bindings)
      bind(binding.file.fd, binding.path.replace(/^\/lib(?:64)?(?=\/)/, '/usr/lib'), false)
    const mountedFiles = new Set<string>()
    for (const file of inputs.files) {
      if (libraryFiles.has(file.canonicalPath) || mountedFiles.has(file.canonicalPath)) continue
      mountedFiles.add(file.canonicalPath)
      bind(file.fd, file.canonicalPath, false)
    }
    args.push('--remount-ro', '/')
    root.validateIdentity()
    const definition = createHash('sha256')
      .update(
        JSON.stringify([
          'native-linux-view-v1',
          process.arch,
          inputs.fingerprint,
          runtime.facts.fingerprint,
          relative,
          env,
        ]),
      )
      .digest('hex')
    const held = { root, scratch, entry, inputs, filter, cwd, loan }
    let issued = false
    const result: NativeLinuxView = Object.freeze({
      backend: 'linux-bwrap',
      definition,
      runtimeFacts: runtime.facts,
      workspace: held.inputs.workspace.canonicalPath,
      workspaceIdentity: held.inputs.workspace.directory.identity,
      cwd: commandCwd,
      env,
      manager,
      stdio: Object.freeze(descriptors),
      arguments(nonce: string) {
        assertNativeLinuxView(result)
        if (
          issued ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce)
        )
          throw refusal()
        issued = true
        return [...args, '--', node, '--jitless', held.entry.entryPath, nonce]
      },
      async revalidate() {
        assertNativeLinuxView(result)
        held.root.validateIdentity()
        held.cwd.validateIdentity()
        await runtime.revalidate()
        held.filter.revalidate()
        await held.inputs.revalidate()
        await held.scratch.revalidate()
        assertNativeLinuxView(result)
      },
      close() {
        if (closed.has(result)) return
        closed.add(result)
        held.cwd.close()
        held.inputs.close()
        held.scratch.close()
        held.filter.close()
        held.root.close()
        held.loan.release()
      },
    })
    owners.add(result)
    return result
  } catch (error) {
    cwd?.close()
    inputs?.close()
    scratch?.close()
    filter?.close()
    root?.close()
    loan?.release()
    if (error instanceof NativeLayoutError) throw error
    throw refusal()
  }
}
export function assertNativeLinuxView(value: unknown): asserts value is NativeLinuxView {
  if (!value || typeof value !== 'object' || !owners.has(value) || closed.has(value))
    throw refusal()
}
