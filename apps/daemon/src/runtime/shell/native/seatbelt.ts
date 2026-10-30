import { posix } from 'node:path'

export interface SeatbeltInput {
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly executable: boolean
}
export interface SeatbeltPaths {
  readonly workspace: string
  readonly scratch: string
  readonly ipcDirectory: string
  readonly readOnlyInputs: readonly SeatbeltInput[]
  readonly metadataDirectories: readonly string[]
  readonly unavailableInputs: readonly Omit<SeatbeltInput, 'executable'>[]
}
export const DARWIN_NATIVE_POLICY = 'ipc-only-anchored-v1'
const MAX_INPUTS = 256
const MAX_PROFILE_BYTES = 512 * 1024
const SYSTEM_INPUTS: readonly SeatbeltInput[] = [
  { path: '/System/Library', kind: 'directory', executable: true },
  { path: '/usr/lib', kind: 'directory', executable: true },
  { path: '/bin', kind: 'directory', executable: true },
  { path: '/usr/bin', kind: 'directory', executable: true },
]
const SYSCTLS = [
  'hw.pagesize',
  'hw.pagesize_compat',
  'hw.ncpu',
  'hw.activecpu',
  'hw.memsize',
  'hw.machine',
  'kern.ostype',
  'kern.osrelease',
  'kern.osversion',
  'kern.version',
  'kern.hostname',
  'kern.maxfilesperproc',
]
const unavailable = () => new Error('Native macOS filesystem policy is unavailable')
function path(value: string): string {
  if (
    typeof value !== 'string' ||
    !posix.isAbsolute(value) ||
    value === '/' ||
    posix.normalize(value) !== value ||
    value.endsWith('/') ||
    Buffer.byteLength(value) > 1024 ||
    Buffer.from(value, 'utf8').toString('utf8') !== value ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw unavailable()
  return value
}
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
function within(value: string, root: string): boolean {
  return value === root || value.startsWith(`${root}/`)
}
function overlaps(left: string, right: string): boolean {
  return within(left, right) || within(right, left)
}
function filter(input: { path: string; kind: 'file' | 'directory' }): string {
  return `(${input.kind === 'file' ? 'literal' : 'subpath'} ${quote(input.path)})`
}
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

/**
 * Serialization only, NOT admission or a capability. The daemon must first pin/validate the roots,
 * refuse unsafe existing shared inodes/special files, capture trusted code and revalidate before
 * input release. Never expose these paths or generated policy as worker/model configuration.
 * Host/runtime inputs are explicit; no personal HOME, PATH search or ambient resource discovery.
 */
export function compileDarwinSeatbeltPolicy(paths: SeatbeltPaths): string {
  const workspace = path(paths.workspace)
  const scratch = path(paths.scratch)
  const ipc = path(paths.ipcDirectory)
  if (overlaps(workspace, scratch) || !within(ipc, scratch) || ipc === scratch) throw unavailable()
  if (
    !Array.isArray(paths.readOnlyInputs) ||
    paths.readOnlyInputs.length > MAX_INPUTS ||
    !Array.isArray(paths.metadataDirectories) ||
    paths.metadataDirectories.length > MAX_INPUTS ||
    !Array.isArray(paths.unavailableInputs) ||
    paths.unavailableInputs.length > MAX_INPUTS
  )
    throw unavailable()
  const inputs = [...SYSTEM_INPUTS, ...paths.readOnlyInputs].map((input) => {
    if (
      !input ||
      !['file', 'directory'].includes(input.kind) ||
      typeof input.executable !== 'boolean'
    )
      throw unavailable()
    return { path: path(input.path), kind: input.kind, executable: input.executable }
  })
  const forbidden = paths.unavailableInputs.map((input) => {
    if (!input || !['file', 'directory'].includes(input.kind)) throw unavailable()
    return { path: path(input.path), kind: input.kind }
  })
  for (const root of [workspace, scratch]) {
    for (const input of inputs) {
      if (input.path === root || (input.kind === 'directory' && within(root, input.path)))
        throw unavailable()
    }
    if (forbidden.some((input) => overlaps(root, input.path))) throw unavailable()
  }
  // A broad readable ancestor of a credential/private state root is never silently admitted.
  if (inputs.some((input) => forbidden.some((blocked) => overlaps(input.path, blocked.path))))
    throw unavailable()

  const memory = { path: posix.join(workspace, 'memory'), kind: 'directory' as const }
  const readOnly = [memory, ...inputs]
  const readOnlyFilters = sortedUnique(readOnly.map(filter))
  const executableFilters = sortedUnique([
    `(subpath ${quote(workspace)})`,
    `(subpath ${quote(scratch)})`,
    ...inputs.filter((input) => input.executable).map(filter),
  ])
  const metadata = sortedUnique([
    workspace,
    scratch,
    ...inputs.map((input) => input.path),
    ...paths.metadataDirectories.map(path),
  ])
  // Lock writable roots AND intermediate ancestors of readonly carveouts. Without these anchors,
  // rename(workspace, scratch/moved) can move memory outside its path-based deny and make it writable.
  const anchors = new Set([workspace, scratch])
  for (const input of readOnly) {
    for (const root of [workspace, scratch]) {
      if (!within(input.path, root)) continue
      let parent = posix.dirname(input.path)
      while (within(parent, root)) {
        anchors.add(parent)
        if (parent === root) break
        parent = posix.dirname(parent)
      }
    }
  }
  const readable = sortedUnique([
    `(subpath ${quote(workspace)})`,
    `(subpath ${quote(scratch)})`,
    ...inputs.map(filter),
  ])
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow signal (target same-sandbox))',
    '(deny sysctl-read)',
    // Explicit family denial is required: default/sysctl denial alone leaked procargs on tested XNU.
    '(deny process-info*)',
    '(allow process-info* (target same-sandbox))',
    '(deny system-mac-syscall)',
    '(allow system-mac-syscall (require-all (mac-policy-name "Sandbox") (mac-syscall-number 67)))',
    `(allow sysctl-read ${SYSCTLS.map((name) => `(sysctl-name ${quote(name)})`).join(' ')})`,
    '(allow file-read* (literal "/"))',
    `(allow file-read-metadata ${metadata.map((entry) => `(path-ancestors ${quote(entry)})`).join(' ')})`,
    ...(paths.metadataDirectories.length
      ? [
          `(allow file-read-metadata ${sortedUnique(paths.metadataDirectories.map(path))
            .map((entry) => `(subpath ${quote(entry)})`)
            .join(' ')})`,
        ]
      : []),
    `(allow file-read* ${readable.join(' ')})`,
    `(allow file-map-executable ${executableFilters.join(' ')})`,
    `(allow file-write* (require-all (require-any (subpath ${quote(workspace)}) (subpath ${quote(scratch)})) (require-not (require-any ${readOnlyFilters.join(' ')}))))`,
    `(deny file-write-unlink ${[...anchors]
      .sort()
      .map((entry) => `(literal ${quote(entry)})`)
      .join(' ')})`,
    // Do not grant file-link: new hardlinks to readonly inputs/carveouts must stay denied.
    '(allow file-read* file-write-data (literal "/dev/null"))',
    '(deny network*)',
    '(deny system-socket)',
    '(allow system-socket (socket-domain AF_UNIX))',
    `(allow network-bind (local unix-socket (subpath ${quote(ipc)})))`,
    `(allow network-outbound (remote unix-socket (subpath ${quote(ipc)})))`,
    ...(forbidden.length
      ? [
          `(deny file-read* file-write* file-map-executable ${sortedUnique(forbidden.map(filter)).join(' ')})`,
        ]
      : []),
  ]
  const policy = `${lines.join('\n')}\n`
  if (Buffer.byteLength(policy) > MAX_PROFILE_BYTES) throw unavailable()
  return policy
}
