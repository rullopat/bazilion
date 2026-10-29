import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import {
  compileDarwinSeatbeltPolicy,
  DARWIN_NATIVE_POLICY,
} from '../../runtime/shell/native/seatbelt.ts'
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

export type NativeDarwinViewOptions = NativeViewOptions
export interface NativeDarwinView {
  readonly backend: 'darwin-seatbelt'
  readonly definition: string
  readonly runtimeFacts: NativeRuntimeFacts
  readonly workspace: string
  readonly workspaceIdentity: string
  readonly cwd: string
  readonly env: Readonly<NodeJS.ProcessEnv>
  readonly manager: NativeFileCapture
  readonly stdio: readonly 'pipe'[]
  arguments(nonce: string): string[]
  revalidate(): Promise<void>
  /** FD closure only; retain owner and slot while creation/settlement are uncertain. */
  close(): void
}
const owners = new WeakSet<object>(),
  closed = new WeakSet<object>()
const refusal = () => new NativeLayoutError('unavailable')
const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
/** Apple Silicon launch plan. Same safety inputs; a native policy, not a remapped Linux filesystem. */
export async function prepareNativeDarwinView(
  input: NativeDarwinViewOptions,
  runtime: NativeRuntime,
): Promise<NativeDarwinView> {
  const options = snapshotNativeViewOptions(input)
  let root: ContextDirectory | undefined,
    scratch: NativeLayoutCapture | undefined,
    loan: NativeRuntimeLoan | undefined,
    inputs: NativeInputs | undefined,
    profile: NativeFileCapture | undefined,
    cwd: ContextDirectory | undefined
  try {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') throw refusal()
    options.signal?.throwIfAborted()
    loan = retainNativeRuntime(runtime)
    if (runtime.facts.backend !== 'darwin-seatbelt') throw refusal()
    await runtime.revalidate()
    const node = runtime.node,
      manager = runtime.manager,
      entry = runtime.entry,
      relative = options.cwd,
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
      temporary = join(privateRoot, 'scratch'),
      ipc = join(temporary, 'ipc')
    mkdirSync(control, { mode: 0o700 })
    mkdirSync(temporary, { mode: 0o700 })
    for (const name of ['home', 'tmp', 'ipc']) mkdirSync(join(temporary, name), { mode: 0o700 })
    inputs = await captureNativeInputs({
      ...options,
      readOnlyDirectories: [
        ...options.readOnlyDirectories,
        ...runtime.directories.map((directory) => directory.canonicalPath),
      ],
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
    const policy = compileDarwinSeatbeltPolicy({
      workspace: inputs.workspace.canonicalPath,
      scratch: temporary,
      ipcDirectory: ipc,
      readOnlyInputs: [
        ...inputs.directories.map((directory) => ({
          path: directory.canonicalPath,
          kind: 'directory' as const,
          executable: true,
        })),
        ...inputs.files.map((file) => ({
          path: file.canonicalPath,
          kind: 'file' as const,
          executable: file.executable,
        })),
      ],
      metadataDirectories: runtime.metadataDirectories,
      unavailableInputs: inputs.unavailable,
    })
    const profilePath = join(control, 'policy.sb')
    writeFileSync(profilePath, policy, { flag: 'wx', mode: 0o400 })
    profile = captureNativeFile({ path: profilePath, executable: false })
    const env = Object.freeze({
      ...values,
      PATH: `${dirname(node)}:/usr/bin:/bin`,
      HOME: join(temporary, 'home'),
      TMPDIR: ipc,
      LANG: 'C',
      LC_ALL: 'C',
      SHELL: '/bin/bash',
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
    const definition = createHash('sha256')
      .update(
        JSON.stringify([
          'native-darwin-view-v1',
          DARWIN_NATIVE_POLICY,
          process.arch,
          inputs.fingerprint,
          runtime.facts.fingerprint,
          createHash('sha256').update(policy).digest('hex'),
          relative,
          env,
        ]),
      )
      .digest('hex')
    const held = { root, scratch, entry, inputs, profile, cwd, loan }
    let issued = false
    const result: NativeDarwinView = Object.freeze({
      backend: 'darwin-seatbelt',
      definition,
      runtimeFacts: runtime.facts,
      workspace: held.inputs.workspace.canonicalPath,
      workspaceIdentity: held.inputs.workspace.directory.identity,
      cwd: commandCwd,
      env,
      manager,
      stdio: Object.freeze(['pipe', 'pipe', 'pipe'] as const),
      arguments(nonce: string) {
        assertNativeDarwinView(result)
        if (
          issued ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce)
        )
          throw refusal()
        issued = true
        return ['-f', profilePath, node, '--jitless', held.entry.entryPath, nonce, commandCwd]
      },
      async revalidate() {
        assertNativeDarwinView(result)
        held.root.validateIdentity()
        held.cwd.validateIdentity()
        await runtime.revalidate()
        held.profile.revalidate()
        await held.inputs.revalidate()
        await held.scratch.revalidate()
        assertNativeDarwinView(result)
      },
      close() {
        if (closed.has(result)) return
        closed.add(result)
        held.cwd.close()
        held.inputs.close()
        held.scratch.close()
        held.profile.close()
        held.root.close()
        held.loan.release()
      },
    })
    root.validateIdentity()
    owners.add(result)
    return result
  } catch (error) {
    cwd?.close()
    inputs?.close()
    scratch?.close()
    profile?.close()
    root?.close()
    loan?.release()
    if (error instanceof NativeLayoutError) throw error
    throw refusal()
  }
}
export function assertNativeDarwinView(value: unknown): asserts value is NativeDarwinView {
  if (!value || typeof value !== 'object' || !owners.has(value) || closed.has(value))
    throw refusal()
}
