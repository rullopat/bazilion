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
    // Exit/permission races among other users' processes are not our browser evidence.
    if ([1, 3, 13].includes(errno)) return null // EPERM, ESRCH, EACCES
    throw new Error(
      `Darwin process arguments cannot be inspected: status=${status}, errno=${errno}, pid=${pid}, self=${pid === process.pid}`,
    )
  }
  const count = size.readBigUInt64LE()
  if (count < 4n || count > BigInt(ARG_BYTES)) throw new Error('invalid process argument size')
  return buffer.subarray(0, Number(count))
}

function decode(buffer: Buffer): { argv: string[]; environ: string[] } {
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
  return { argv, environ: buffer.subarray(offset).toString('utf8').split('\0').filter(Boolean) }
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
  if (!self || !decode(self).argv.length) throw new Error('native process evidence unavailable')
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
    if (!candidate?.includes(Buffer.from(profileDir))) continue
    // Bind actual argv/environment to the same birth on both sides, not a first PID-only scan.
    const buffer = argumentsFor(pid)
    if (!buffer) continue
    const { argv, environ } = decode(buffer)
    if (!argv.some((arg) => arg.includes(profileDir))) continue
    const executable = Buffer.alloc(4096)
    const length = api.path(pid, executable, executable.length)
    if (length <= 0 || length >= executable.length)
      throw new Error('matched executable unavailable')
    const after = inspector.member(pid)
    if (!after || after.state === 'Z') continue
    if (before.start !== after.start || before.uid !== after.uid)
      throw new Error('matched process identity changed')
    const nul = executable.indexOf(0)
    const exe = executable.toString('utf8', 0, nul < 0 ? length : nul)
    const cmdline = argv.join(' ')
    found.push({
      pid,
      exe,
      argv,
      environ,
      cmdline,
      kind:
        argv.includes(`--user-data-dir=${profileDir}`) && !cmdline.includes('--type=')
          ? 'root'
          : 'child',
    })
  }
  return found.sort((a, b) => a.pid - b.pid)
}
