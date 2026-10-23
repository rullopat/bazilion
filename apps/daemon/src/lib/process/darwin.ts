import { createRequire } from 'node:module'
import { constants } from 'node:os'

/** Observed process facts, not authority to signal a persisted PID after restart/restore. */
export interface DarwinProcessMember {
  pid: number
  parent: number
  group: number
  session: number
  uid: number
  start: string
  state: string
}

/** Closed native surface. Callers cannot supply a library, symbol, flavor or buffer size. */
export interface DarwinProcessCalls {
  bsd(pid: number, buffer: Buffer): { bytes: number; errno: number }
  birth(pid: number, buffer: Buffer): { status: number; errno: number }
  pids(group: number, buffer: Buffer): { count: number; errno: number }
  session(pid: number): { id: number; errno: number }
}

// Public Darwin proc_bsdinfo ABI (sys/proc_info.h / PROC_PIDTBSDINFO), not private kernel SPI.
// All fields before pbi_start_tvsec are 32-bit scalars or fixed-size char arrays; the final two
// fields are uint64_t seconds/microseconds. Reject any incomplete/unexpected response size.
const BSD_BYTES = 136
// Public rusage_info_v0 ABI (sys/resource.h): monotonic Mach birth time at byte 80. Combining it
// with the BSD observations avoids relying on wall-clock timestamps alone as signalling anchors.
const RUSAGE_BYTES = 96
const MAX_MEMBERS = 16_384
const INSPECTION_MS = 500
const ESRCH = constants.errno.ESRCH

function validPid(pid: number): boolean {
  return Number.isSafeInteger(pid) && pid > 0 && pid <= 0x7fffffff
}
function unavailable(): never {
  throw new Error('macOS process ownership cannot be inspected')
}
type BsdMember = Omit<DarwinProcessMember, 'session'>

/** Synchronous snapshots preserve the caller's capture-before-yield ownership boundary. */
export class DarwinProcessInspector {
  constructor(private readonly calls: DarwinProcessCalls) {}

  private bsd(pid: number): BsdMember | null {
    if (!validPid(pid)) return unavailable()
    const buffer = Buffer.alloc(BSD_BYTES)
    const result = this.calls.bsd(pid, buffer)
    if (result.bytes === 0 && result.errno === ESRCH) return null
    if (result.bytes !== BSD_BYTES) return unavailable()
    const state = buffer.readUInt32LE(4)
    const returnedPid = buffer.readUInt32LE(12)
    const parent = buffer.readUInt32LE(16)
    const uid = buffer.readUInt32LE(20)
    const group = buffer.readUInt32LE(100)
    const seconds = buffer.readBigUInt64LE(120)
    const micros = buffer.readBigUInt64LE(128)
    if (
      returnedPid !== pid ||
      !validPid(group) ||
      parent > 0x7fffffff ||
      state < 1 ||
      state > 5 ||
      seconds === 0n ||
      micros >= 1_000_000n
    )
      return unavailable()
    return {
      pid,
      parent,
      group,
      uid,
      start: `${seconds}:${micros}`,
      state: state === 5 ? 'Z' : String(state),
    }
  }

  private birth(pid: number): bigint | null {
    const buffer = Buffer.alloc(RUSAGE_BYTES)
    const result = this.calls.birth(pid, buffer)
    if (result.status === -1 && result.errno === ESRCH) return null
    if (result.status !== 0) return unavailable()
    const birth = buffer.readBigUInt64LE(80)
    if (birth === 0n) return unavailable()
    return birth
  }

  member(pid: number): DarwinProcessMember | null {
    const before = this.bsd(pid)
    if (!before) return null
    // A zombie has no executing writer. getsid may already refuse it; no session inference is
    // needed because group() never admits zombies as live signalling anchors.
    if (before.state === 'Z') return { ...before, session: 0 }
    const birth = this.birth(pid)
    if (birth === null) return null
    const session = this.calls.session(pid)
    if (session.id === -1 && session.errno === ESRCH) return null
    if (!validPid(session.id)) return unavailable()
    const after = this.bsd(pid)
    if (!after) return null
    const afterBirth = this.birth(pid)
    if (afterBirth === null) return null
    if (
      after.start !== before.start ||
      after.group !== before.group ||
      after.uid !== before.uid ||
      birth !== afterBirth
    )
      throw new Error('macOS process ownership changed during inspection')
    return { ...after, start: `${after.start}:${birth}`, session: session.id }
  }

  private pids(group: number): number[] {
    if (!validPid(group)) return unavailable()
    // One extra entry makes a full/truncated result a refusal, never proof of an empty group.
    const buffer = Buffer.alloc((MAX_MEMBERS + 1) * 4)
    const { count, errno } = this.calls.pids(group, buffer)
    if (count === -1 && errno === ESRCH) return []
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_MEMBERS) return unavailable()
    if (count === 0 && errno !== 0 && errno !== ESRCH) return unavailable()
    const seen = new Set<number>()
    for (let i = 0; i < count; i++) {
      const pid = buffer.readInt32LE(i * 4)
      if (!validPid(pid) || seen.has(pid)) return unavailable()
      seen.add(pid)
    }
    return [...seen]
  }

  group(pid: number): DarwinProcessMember[] {
    if (!validPid(pid) || pid <= 1) return unavailable()
    const started = performance.now()
    const members: DarwinProcessMember[] = []
    const stopped = new Set<number>()
    for (const memberPid of this.pids(pid)) {
      if (performance.now() - started > INSPECTION_MS)
        throw new Error('macOS process inspection over budget')
      const member = this.member(memberPid)
      if (!member) continue
      if (member.state === 'Z') {
        if (member.group === pid) stopped.add(memberPid)
      } else {
        if (member.group !== pid || member.session !== pid)
          throw new Error('macOS process group changed during inspection')
        members.push(member)
      }
    }
    // A leader can fork and disappear between enumeration and inspection. Never turn a missed
    // newly born child into an empty-group receipt. Only absent or observed zombie members may
    // remain in the confirmation list. This is bounded observation, not atomic containment.
    if (!members.length && this.pids(pid).some((memberPid) => !stopped.has(memberPid)))
      throw new Error('macOS process group changed during inspection')
    if (performance.now() - started > INSPECTION_MS)
      throw new Error('macOS process inspection over budget')
    return members
  }

  assertReady(): void {
    const self = this.member(process.pid)
    if (!self || self.parent !== process.ppid || self.state === 'Z') unavailable()
    // Check the list API too, before admitting a server. This is capability/readiness evidence,
    // not signalling authority for the daemon's own inherited process group.
    if (!this.pids(self.group).includes(process.pid)) unavailable()
  }
}

let inspector: DarwinProcessInspector | undefined

/** Lazy daemon-only binding: Linux never loads Koffi, and no host/compiler command is executed. */
export function getDarwinProcessInspector(): DarwinProcessInspector {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch))
    return unavailable()
  if (!inspector) {
    try {
      const require = createRequire(import.meta.url)
      const ffi = require('koffi') as typeof import('koffi')
      if (ffi.version !== '3.3.3') return unavailable()
      const proc = ffi.load('/usr/lib/libproc.dylib')
      const system = ffi.load('/usr/lib/libSystem.B.dylib')
      const bsd = proc.func(
        'int proc_pidinfo(int pid, int flavor, uint64_t arg, _Out_ void *buffer, int size)',
      ) as (pid: number, flavor: number, arg: bigint, buffer: Buffer, size: number) => number
      const pids = proc.func('int proc_listpgrppids(int group, _Out_ void *buffer, int size)') as (
        group: number,
        buffer: Buffer,
        size: number,
      ) => number
      const session = system.func('int getsid(int pid)') as (pid: number) => number
      const birth = proc.func('int proc_pid_rusage(int pid, int flavor, _Out_ void *buffer)') as (
        pid: number,
        flavor: number,
        buffer: Buffer,
      ) => number
      inspector = new DarwinProcessInspector({
        bsd: (pid, buffer) => {
          ffi.errno(0)
          const bytes = bsd(pid, 3, 0n, buffer, buffer.length)
          return { bytes, errno: ffi.errno() }
        },
        birth: (pid, buffer) => {
          ffi.errno(0)
          const status = birth(pid, 0, buffer)
          return { status, errno: ffi.errno() }
        },
        pids: (group, buffer) => {
          ffi.errno(0)
          const count = pids(group, buffer, buffer.length)
          return { count, errno: ffi.errno() }
        },
        session: (pid) => {
          ffi.errno(0)
          const id = session(pid)
          return { id, errno: ffi.errno() }
        },
      })
    } catch {
      return unavailable()
    }
  }
  return inspector
}
