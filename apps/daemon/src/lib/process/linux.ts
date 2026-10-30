import { closeSync, openSync, readlinkSync, readSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'

export class LinuxOwnershipError extends Error {
  constructor() {
    super('Native Linux process ownership unavailable')
  }
}
export interface LinuxProcessFact {
  readonly pid: number
  readonly parent: number
  readonly group: number
  readonly session: number
  readonly start: string
  readonly state: string
  readonly uid: number
  readonly namespacePids: readonly number[]
  readonly namespaces: Readonly<Record<'pid' | 'user' | 'mnt' | 'net' | 'ipc' | 'uts', string>>
}
function fail(): never {
  throw new LinuxOwnershipError()
}
const validPid = (pid: number) => Number.isSafeInteger(pid) && pid > 0 && pid <= 0x7fffffff
function bounded(path: string, maximum: number): string {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(maximum + 1)
    let total = 0
    while (total < buffer.length) {
      const count = readSync(fd, buffer, total, buffer.length - total, null)
      if (!count) break
      total += count
    }
    if (total > maximum) fail()
    return buffer.subarray(0, total).toString('utf8')
  } finally {
    closeSync(fd)
  }
}
export function parseLinuxProcessStat(source: string, expectedPid: number) {
  const close = source.lastIndexOf(')')
  if (close < 0 || !validPid(expectedPid) || !source.startsWith(`${expectedPid} (`)) fail()
  const fields = source
    .slice(close + 1)
    .trim()
    .split(/\s+/)
  const integer = (index: number, zero = false) => {
    const value = fields[index]
    if (!value || !/^\d+$/.test(value)) fail()
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < (zero ? 0 : 1) || parsed > 0x7fffffff) fail()
    return parsed
  }
  const start = fields[19]
  const state = fields[0]
  if (
    !start ||
    !/^\d+$/.test(start) ||
    BigInt(start) <= 0n ||
    BigInt(start) > 0xffffffffffffffffn ||
    !state ||
    !/^[RSDZTtXxKWPI]$/.test(state)
  )
    fail()
  return Object.freeze({
    pid: expectedPid,
    parent: integer(1, true),
    group: integer(2),
    session: integer(3),
    start,
    state,
  })
}

/** Bounded facts only. PID/namespace observations do not confer signalling authority. */
export function inspectLinuxProcess(pid: number): LinuxProcessFact | null {
  if (process.platform !== 'linux' || !validPid(pid)) fail()
  try {
    const path = `/proc/${pid}`
    const first = parseLinuxProcessStat(bounded(`${path}/stat`, 8192), pid)
    const uid = statSync(path).uid
    const status = bounded(`${path}/status`, 65536)
    const raw = /^NSpid:\s*([\d\t ]+)$/m.exec(status)?.[1]
    if (!raw || !Number.isSafeInteger(uid) || uid < 0 || uid > 0xffffffff) fail()
    const namespacePids = raw.trim().split(/\s+/).map(Number)
    if (
      !namespacePids.length ||
      namespacePids.length > 32 ||
      namespacePids[0] !== pid ||
      namespacePids.some((value) => !validPid(value))
    )
      fail()
    const namespaces = {} as Record<'pid' | 'user' | 'mnt' | 'net' | 'ipc' | 'uts', string>
    for (const key of ['pid', 'user', 'mnt', 'net', 'ipc', 'uts'] as const) {
      const link = readlinkSync(`${path}/ns/${key}`)
      const match = new RegExp(`^${key}:\\[(\\d+)\\]$`).exec(link)?.[1]
      if (!match || BigInt(match) <= 0n || BigInt(match) > 0xffffffffffffffffn) fail()
      namespaces[key] = match
    }
    const second = parseLinuxProcessStat(bounded(`${path}/stat`, 8192), pid)
    if (first.start !== second.start || statSync(path).uid !== uid) fail()
    return Object.freeze({
      ...second,
      uid,
      namespacePids: Object.freeze(namespacePids),
      namespaces: Object.freeze(namespaces),
    })
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    )
      return null
    throw new LinuxOwnershipError()
  }
}

export interface LinuxPidfdCalls {
  open(pid: number): { fd: number; errno: number }
  signal(fd: number, signal: 'SIGTERM' | 'SIGKILL'): { result: number; errno: number }
  state(fd: number): 'live' | 'exited' | 'unknown'
  close(fd: number): void
}
let cached: LinuxPidfdCalls | undefined
/** Closed public Linux ABI binding. Low-level calls are not a receipt/PID authority factory. */
export function getLinuxPidfdCalls(): LinuxPidfdCalls {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) fail()
  if (cached) return cached
  try {
    const require = createRequire(import.meta.url)
    const koffi = require('koffi') as typeof import('koffi')
    if (koffi.version !== '3.3.3') fail()
    // Resolve the libc symbols already loaded into this process, not a caller/PATH-selected DSO.
    const library = koffi.load(null)
    // The public kernel ABI is identical on the two admitted 64-bit architectures. Bind it
    // directly: older libc can support the kernel operations without exporting 2.36's wrappers.
    // No arbitrary syscall number/flags, libc-wrapper probing, or PID/group signalling fallback.
    const syscall = library.func('long syscall(long number, ...)')
    const poll = library.func('int poll(_Inout_ void *fds, unsigned long count, int timeout)')
    cached = Object.freeze({
      open(pid: number) {
        if (!validPid(pid)) fail()
        koffi.errno(0)
        const fd = syscall(434, 'int', pid, 'unsigned int', 0) as number
        return { fd, errno: koffi.errno() }
      },
      signal(fd: number, selected: 'SIGTERM' | 'SIGKILL') {
        if (!Number.isSafeInteger(fd) || fd < 0 || !['SIGTERM', 'SIGKILL'].includes(selected))
          fail()
        koffi.errno(0)
        const result = syscall(
          424,
          'int',
          fd,
          'int',
          selected === 'SIGTERM' ? 15 : 9,
          'const void *',
          null,
          'unsigned int',
          0,
        ) as number
        return { result, errno: koffi.errno() }
      },
      state(fd: number) {
        if (!Number.isSafeInteger(fd) || fd < 0) return 'unknown'
        const buffer = Buffer.alloc(8)
        buffer.writeInt32LE(fd, 0)
        buffer.writeInt16LE(1, 4)
        koffi.errno(0)
        const result = poll(buffer, 1, 0) as number
        const flags = buffer.readUInt16LE(6)
        if (result < 0 || result > 1 || flags & ~0x11) return 'unknown'
        if (result === 0) return flags === 0 ? 'live' : 'unknown'
        return flags & 0x11 ? 'exited' : 'unknown'
      },
      close(fd: number) {
        closeSync(fd)
      },
    })
    return cached
  } catch {
    fail()
  }
}
