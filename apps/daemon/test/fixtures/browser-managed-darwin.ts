// Actual-browser evidence adapter only. Public libproc/sysctl; never production signalling
// authority. Read the exact matched profile's argv/environment, not broad browser-name claims.
import { createRequire } from 'node:module'
import { getDarwinProcessInspector } from '../../src/lib/process/darwin.ts'
import type { OwnedBrowserProcess } from './browser-managed.ts'

const MAX_PIDS = 16_384
const ARG_BYTES = 256 * 1024
let calls: ReturnType<typeof nativeCalls> | undefined
function nativeCalls() {
  const require = createRequire(import.meta.url)
  const ffi = require('koffi') as typeof import('koffi')
  if (ffi.version !== '3.3.3') throw new Error('unexpected process evidence binding')
  const proc = ffi.load('/usr/lib/libproc.dylib')
  const system = ffi.load('/usr/lib/libSystem.B.dylib')
  return {
    list: proc.func('int proc_listpids(uint32_t, uint32_t, void *, int)'),
    path: proc.func('int proc_pidpath(int, void *, uint32_t)'),
    sysctl: system.func('int sysctl(const int *, uint32_t, void *, void *, void *, ulong)'),
    errno: (value?: number) => (value === undefined ? ffi.errno() : ffi.errno(value)),
  }
}

function argumentsFor(pid: number): Buffer | null {
  calls ??= nativeCalls()
  const api = calls
  const mib = Buffer.alloc(12)
  mib.writeInt32LE(1, 0) // CTL_KERN
  mib.writeInt32LE(49, 4) // KERN_PROCARGS2 (public sys/sysctl.h)
  mib.writeInt32LE(pid, 8)
  const buffer = Buffer.alloc(ARG_BYTES)
  const size = Buffer.alloc(8)
  size.writeBigUInt64LE(BigInt(buffer.length))
  api.errno(0)
  const status = api.sysctl(mib, 3, buffer, size, null, 0)
  const errno = api.errno()
  if (status !== 0) {
    if ([1, 3, 13, 22].includes(errno)) {
      // Permission/exit races and XNU's EINVAL for a vanished task are not empty-process
      // proofs. Skip only after a fresh positive exit/zombie/uid-change observation.
      const current = getDarwinProcessInspector().member(pid)
      if (!current || current.state === 'Z' || current.uid !== process.geteuid?.()) return null
    }
    throw new Error(
      `Darwin process arguments cannot be inspected: status=${status}, errno=${errno}, pid=${pid}, self=${pid === process.pid}`,
    )
  }
  const count = size.readBigUInt64LE()
  if (count < 4n || count > BigInt(ARG_BYTES)) throw new Error('invalid process argument size')
  return buffer.subarray(0, Number(count))
}

function decodeArgv(buffer: Buffer): { argv: string[]; offset: number } {
  if (buffer.length < 4) throw new Error('incomplete native argc')
  const argc = buffer.readInt32LE()
  if (argc < 1 || argc > 4096) throw new Error('invalid native argc')
  let offset = buffer.indexOf(0, 4)
  if (offset < 4) throw new Error('missing native executable path')
  while (offset < buffer.length && buffer[offset] === 0) offset++
  const argv: string[] = []
  for (let i = 0; i < argc; i++) {
    const end = buffer.indexOf(0, offset)
    if (end < offset) throw new Error('incomplete native argv')
    argv.push(buffer.toString('utf8', offset, end))
    offset = end + 1
  }
  return { argv, offset }
}

export function decodeDarwinProcessArguments(buffer: Buffer): {
  argv: string[]
  environ: string[]
  environmentReported: boolean
} {
  const { argv, offset: environmentOffset } = decodeArgv(buffer)
  let offset = environmentOffset
  const environ: string[] = []
  // XNU intentionally returns argv ONLY for cs_restricted targets under SIP without a private
  // entitlement. Reaching the exact argv boundary is unreported, never an empty-env proof.
  const environmentReported = offset < buffer.length
  // KERN_PROCARGS2 copies the stack's strings, including padding and Darwin's apple vector.
  // The first empty entry ends environment evidence; filtering empty strings incorrectly
  // appended kernel metadata (ptr_munge/main_stack/etc.) to the child's environment.
  while (offset < buffer.length && buffer[offset] !== 0) {
    const end = buffer.indexOf(0, offset)
    if (end < offset) throw new Error('incomplete native environment')
    const entry = buffer.toString('utf8', offset, end)
    if (!/^[^=]+=/s.test(entry)) throw new Error('invalid native environment entry')
    environ.push(entry)
    offset = end + 1
  }
  return { argv, environ, environmentReported }
}

export function ownedDarwinBrowserProcesses(profileDir: string): OwnedBrowserProcess[] {
  if (process.platform !== 'darwin')
    throw new Error('Darwin process evidence requires actual macOS')
  calls ??= nativeCalls()
  const api = calls
  const inspector = getDarwinProcessInspector()
  inspector.assertReady()
  // Refuse unsupported/denied argument inspection, never turn it into an empty-process proof.
  const self = argumentsFor(process.pid)
  if (!self || !decodeDarwinProcessArguments(self).argv.length)
    throw new Error('native process evidence unavailable')
  const pids = Buffer.alloc((MAX_PIDS + 1) * 4)
  // PROC_UID_ONLY = 4. The browser launches as this user; unrelated root/system processes
  // need not expose argv to establish profile evidence. proc_listpids returns BYTES, not pids.
  const bytes = api.list(4, process.geteuid?.(), pids, pids.length)
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes % 4 !== 0 || bytes > MAX_PIDS * 4)
    throw new Error('native process enumeration unavailable/truncated')
  const count = bytes / 4
  const found: OwnedBrowserProcess[] = []
  const seen = new Set<number>()
  const started = performance.now()
  for (let i = 0; i < count; i++) {
    if (performance.now() - started > 5000) throw new Error('native process evidence over budget')
    const pid = pids.readInt32LE(i * 4)
    if (pid < 0 || seen.has(pid)) throw new Error('invalid native process enumeration')
    seen.add(pid)
    if (pid === 0 || pid === process.pid) continue
    const before = inspector.member(pid)
    if (!before || before.state === 'Z') continue
    if (before.uid !== process.geteuid?.()) continue // Positively observed uid change since list.
    const candidate = argumentsFor(pid)
    if (!candidate) continue
    // Identify only our profile in argv. Never search/decode an unrelated process's environment.
    let matches = false
    try {
      matches = decodeArgv(candidate).argv.some((arg) => arg.includes(profileDir))
    } finally {
      candidate.fill(0)
    }
    if (!matches) continue
    const matched = inspector.member(pid)
    if (!matched || matched.state === 'Z') continue
    if (matched.start !== before.start || matched.uid !== before.uid)
      throw new Error('matched process identity changed')
    // Bind the second read before decoding environment bytes, never a PID-only observation.
    const buffer = argumentsFor(pid)
    if (!buffer) continue
    const current = inspector.member(pid)
    if (!current || current.state === 'Z') {
      buffer.fill(0)
      continue
    }
    if (current.start !== before.start || current.uid !== before.uid) {
      buffer.fill(0)
      throw new Error('matched process identity changed')
    }
    let decoded: ReturnType<typeof decodeDarwinProcessArguments>
    try {
      // The profile must still match argv before any environment is decoded.
      if (!decodeArgv(buffer).argv.some((arg) => arg.includes(profileDir))) continue
      decoded = decodeDarwinProcessArguments(buffer)
    } finally {
      buffer.fill(0)
    }
    const { argv, environ, environmentReported } = decoded
    const executable = Buffer.alloc(4096)
    api.errno(0)
    const length = api.path(pid, executable, executable.length)
    const pathErrno = api.errno()
    // A process can exit after matching argv but before proc_pidpath. Observe its current
    // birth/liveness before rejecting the path read; never turn an alive unknown into absence.
    const after = inspector.member(pid)
    if (!after || after.state === 'Z') continue
    if (before.start !== after.start || before.uid !== after.uid)
      throw new Error('matched process identity changed')
    if (length <= 0 || length >= executable.length)
      throw new Error(`matched executable unavailable: status=${length}, errno=${pathErrno}`)
    const nul = executable.indexOf(0)
    const exe = executable.toString('utf8', 0, nul < 0 ? length : nul)
    const cmdline = argv.join(' ')
    found.push({
      pid,
      exe,
      argv,
      environ,
      environmentReported,
      cmdline,
      kind:
        argv.includes(`--user-data-dir=${profileDir}`) && !cmdline.includes('--type=')
          ? 'root'
          : 'child',
    })
  }
  return found.sort((a, b) => a.pid - b.pid)
}
