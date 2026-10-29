import { createRequire } from 'node:module'
import { constants } from 'node:os'

/** Ephemeral observations only: neither these IDs nor a restored receipt authorize signalling. */
export interface DarwinCensusIdentity {
  readonly pid: number
  readonly uniqueId: string
  readonly execVersion: number
}
export interface DarwinCensusRow extends DarwinCensusIdentity {
  readonly state: 'live' | 'zombie'
}
export interface DarwinCensusCalls {
  pids(buffer: Buffer): { count: number; errno: number }
  identity(pid: number, buffer: Buffer): { bytes: number; errno: number }
  short(pid: number, buffer: Buffer): { bytes: number; errno: number }
}
export type DarwinCensusReason =
  | 'unavailable'
  | 'budget'
  | 'pid_list'
  | 'identity'
  | 'layout'
  | 'scope_input'
  | 'owner'
  | 'drift'
export interface DarwinCensusUnknown {
  readonly kind: 'unknown'
  readonly reason: DarwinCensusReason
}
export interface DarwinCensusInventory {
  readonly kind: 'inventory'
  readonly rows: readonly DarwinCensusRow[]
}
export interface DarwinCensusView {
  readonly kind: 'view'
  readonly owner: DarwinCensusIdentity
  readonly members: readonly DarwinCensusIdentity[]
  readonly outsideCount: number
  readonly zombieCount: number
}
export interface DarwinDomainObservation {
  readonly kind: 'observation'
  readonly state: 'empty_at_capture' | 'busy'
  readonly owner: DarwinCensusIdentity
  readonly members: readonly DarwinCensusIdentity[]
}

export const DARWIN_CENSUS_MAX_PIDS = 16_384
export const DARWIN_CENSUS_BUDGET_MS = 500
const IDENTITY_BYTES = 56
const SHORT_BYTES = 64
const EPERM = constants.errno.EPERM
const unknown = (reason: DarwinCensusReason): DarwinCensusUnknown =>
  Object.freeze({ kind: 'unknown', reason })
const validPid = (pid: number) => Number.isSafeInteger(pid) && pid > 0 && pid <= 0x7fffffff

function validIdentity(value: DarwinCensusIdentity): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every((key) => ['pid', 'uniqueId', 'execVersion', 'state'].includes(key)) &&
    validPid(value.pid) &&
    typeof value.uniqueId === 'string' &&
    /^[1-9][0-9]{0,19}$/.test(value.uniqueId) &&
    BigInt(value.uniqueId) <= 0xffffffffffffffffn &&
    Number.isInteger(value.execVersion) &&
    value.execVersion >= -0x80000000 &&
    value.execVersion <= 0x7fffffff &&
    value.execVersion !== 0
  )
}
export function sameDarwinCensusIdentity(
  left: DarwinCensusIdentity,
  right: DarwinCensusIdentity,
): boolean {
  return (
    left.pid === right.pid &&
    left.uniqueId === right.uniqueId &&
    left.execVersion === right.execVersion
  )
}
function copyIdentity(value: DarwinCensusIdentity): DarwinCensusIdentity {
  return Object.freeze({ pid: value.pid, uniqueId: value.uniqueId, execVersion: value.execVersion })
}
function validRows(rows: readonly DarwinCensusRow[]): boolean {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > DARWIN_CENSUS_MAX_PIDS)
    return false
  let previous = 0
  for (const row of rows) {
    if (
      !row ||
      !validIdentity(row) ||
      row.pid <= previous ||
      (row.state !== 'live' && row.state !== 'zombie')
    )
      return false
    previous = row.pid
  }
  return true
}

/**
 * Closed libproc reader shared by the outside collector and the policy-confined observer.
 * Tests may inject this narrow syscall surface/clock; neither is an IPC/model argument.
 * Keep this worker-reachable module erasable by native strip-only Node.
 */
export class DarwinCensusReader {
  private readonly calls: DarwinCensusCalls
  private readonly pid: number
  private readonly now: () => number

  constructor(calls: DarwinCensusCalls, pid = process.pid, now = () => performance.now()) {
    this.calls = calls
    this.pid = pid
    this.now = now
  }

  private overBudget(started: number): boolean {
    const elapsed = this.now() - started
    return !Number.isFinite(elapsed) || elapsed < 0 || elapsed > DARWIN_CENSUS_BUDGET_MS
  }

  private pids(): number[] | DarwinCensusUnknown {
    const buffer = Buffer.alloc((DARWIN_CENSUS_MAX_PIDS + 1) * 4)
    const result = this.calls.pids(buffer)
    if (
      !Number.isInteger(result.count) ||
      result.count <= 0 ||
      result.count > DARWIN_CENSUS_MAX_PIDS ||
      result.errno !== 0
    )
      return unknown('pid_list')
    const seen = new Set<number>()
    let kernelSeen = false
    for (let index = 0; index < result.count; index++) {
      const pid = buffer.readInt32LE(index * 4)
      // Reserved kernel PID zero cannot be a userspace writer or a reusable job slot.
      if (pid === 0 && !kernelSeen) {
        kernelSeen = true
        continue
      }
      if (!validPid(pid) || seen.has(pid)) return unknown('pid_list')
      seen.add(pid)
    }
    if (!seen.has(this.pid)) return unknown('owner')
    return [...seen].sort((a, b) => a - b)
  }

  private identity(pid: number): DarwinCensusIdentity | DarwinCensusUnknown {
    const buffer = Buffer.alloc(IDENTITY_BYTES)
    const result = this.calls.identity(pid, buffer)
    if (result.bytes !== IDENTITY_BYTES || result.errno !== 0) return unknown('identity')
    // Published Apple proc_info_private.h ABI, absent from the public SDK. This accepted
    // compatibility dependency must never silently fall back to wall-clock/group inference.
    if (buffer.readBigUInt64LE(40) !== 0n || buffer.readBigUInt64LE(48) !== 0n)
      return unknown('layout')
    const identity = {
      pid,
      uniqueId: buffer.readBigUInt64LE(16).toString(),
      execVersion: buffer.readInt32LE(32),
    }
    return validIdentity(identity) ? Object.freeze(identity) : unknown('layout')
  }

  private row(pid: number): DarwinCensusRow | DarwinCensusUnknown {
    const before = this.identity(pid)
    if ('kind' in before) return before
    const buffer = Buffer.alloc(SHORT_BYTES)
    const result = this.calls.short(pid, buffer)
    if (result.bytes !== SHORT_BYTES || result.errno !== 0) return unknown('identity')
    const state = buffer.readUInt32LE(12)
    if (buffer.readUInt32LE(0) !== pid || state < 2 || state > 5) return unknown('layout')
    const after = this.identity(pid)
    if ('kind' in after) return after
    if (!sameDarwinCensusIdentity(before, after)) return unknown('drift')
    return Object.freeze({ ...before, state: state === 5 ? 'zombie' : 'live' })
  }

  /** Self facts for a trusted scoped observer; not signalling or settlement authority. */
  ownIdentity(): DarwinCensusIdentity | DarwinCensusUnknown {
    try {
      const row = this.row(this.pid)
      if ('kind' in row) return row
      return row.state === 'live' ? copyIdentity(row) : unknown('owner')
    } catch {
      return unknown('unavailable')
    }
  }

  /** Trusted outside controller: bounded complete versioned inventory, including foreign zombies. */
  inventory(): DarwinCensusInventory | DarwinCensusUnknown {
    const started = this.now()
    try {
      const first = this.pids()
      if (!Array.isArray(first)) return first
      const rows: DarwinCensusRow[] = []
      for (const pid of first) {
        if (this.overBudget(started)) return unknown('budget')
        const row = this.row(pid)
        if ('kind' in row) return row
        rows.push(row)
      }
      const last = this.pids()
      if (!Array.isArray(last)) return last
      if (first.length !== last.length || first.some((pid, index) => pid !== last[index]))
        return unknown('drift')
      if (this.overBudget(started)) return unknown('budget')
      return Object.freeze({ kind: 'inventory', rows: Object.freeze(rows) })
    } catch {
      return unknown('unavailable')
    }
  }

  /**
   * Only inside the admitted immutable same-sandbox policy. Flavor 17 and short BSD info
   * do not apply the same-UID restriction, so a changed UID cannot be mistaken for foreign.
   * Only EPERM is a policy exclusion; disappearance, partial data and all other errors are unknown.
   */
  scope(
    inventory: DarwinCensusInventory,
    owner: DarwinCensusIdentity,
  ): DarwinCensusView | DarwinCensusUnknown {
    const started = this.now()
    try {
      if (inventory.kind !== 'inventory' || !validRows(inventory.rows) || !validIdentity(owner))
        return unknown('scope_input')
      if (owner.pid !== this.pid) return unknown('owner')
      let ownerSeen = false
      let outsideCount = 0
      let zombieCount = 0
      const members: DarwinCensusIdentity[] = []
      for (const expected of inventory.rows) {
        if (this.overBudget(started)) return unknown('budget')
        const probe = Buffer.alloc(IDENTITY_BYTES)
        const result = this.calls.identity(expected.pid, probe)
        if (result.bytes === 0 && result.errno === EPERM && expected.pid !== owner.pid) {
          outsideCount++
          continue
        }
        if (result.bytes !== IDENTITY_BYTES || result.errno !== 0) return unknown('identity')
        const actual = this.row(expected.pid)
        if ('kind' in actual) return actual
        if (!sameDarwinCensusIdentity(expected, actual)) return unknown('drift')
        if (expected.state === 'zombie' && actual.state !== 'zombie') return unknown('drift')
        if (actual.pid === owner.pid) {
          if (actual.state !== 'live' || !sameDarwinCensusIdentity(actual, owner))
            return unknown('owner')
          ownerSeen = true
        } else if (actual.state === 'zombie') zombieCount++
        else
          members.push(
            Object.freeze({
              pid: actual.pid,
              uniqueId: actual.uniqueId,
              execVersion: actual.execVersion,
            }),
          )
      }
      if (!ownerSeen) return unknown('owner')
      if (this.overBudget(started)) return unknown('budget')
      return Object.freeze({
        kind: 'view',
        owner: copyIdentity(owner),
        members: Object.freeze(members),
        outsideCount,
        zombieCount,
      })
    } catch {
      return unknown('unavailable')
    }
  }
}

/**
 * Compose facts, NOT a release capability. The caller must first fence further spawning and
 * bind/revalidate the original live ChildProcess + public native birth authority around the
 * entire exchange. Complete identical lifetime/exec-version vectors bracket the filtered view;
 * no single process-list syscall is described as an atomic snapshot. Host-visible IDs stay private.
 */
export function composeDarwinDomainObservation(
  first: DarwinCensusInventory,
  view: DarwinCensusView,
  last: DarwinCensusInventory,
  owner: DarwinCensusIdentity,
  elapsedMs: number,
): DarwinDomainObservation | DarwinCensusUnknown {
  try {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > DARWIN_CENSUS_BUDGET_MS)
      return unknown('budget')
    if (
      first.kind !== 'inventory' ||
      last.kind !== 'inventory' ||
      view.kind !== 'view' ||
      !validRows(first.rows) ||
      !validRows(last.rows) ||
      !validIdentity(owner)
    )
      return unknown('scope_input')
    if (
      first.rows.length !== last.rows.length ||
      first.rows.some((row, index) => {
        const other = last.rows[index]
        return !other || !sameDarwinCensusIdentity(row, other)
      })
    )
      return unknown('drift')
    const byPid = new Map(first.rows.map((row) => [row.pid, row]))
    const ownerRow = byPid.get(owner.pid)
    const lastOwner = last.rows.find((row) => row.pid === owner.pid)
    if (
      ownerRow?.state !== 'live' ||
      lastOwner?.state !== 'live' ||
      !sameDarwinCensusIdentity(ownerRow, owner) ||
      !validIdentity(view.owner) ||
      !sameDarwinCensusIdentity(view.owner, owner)
    )
      return unknown('owner')
    if (
      !Array.isArray(view.members) ||
      view.members.length > DARWIN_CENSUS_MAX_PIDS ||
      !Number.isInteger(view.outsideCount) ||
      view.outsideCount < 0 ||
      !Number.isInteger(view.zombieCount) ||
      view.zombieCount < 0 ||
      view.members.length + view.outsideCount + view.zombieCount + 1 !== first.rows.length
    )
      return unknown('scope_input')
    const seen = new Set<number>()
    for (const member of view.members) {
      const row = byPid.get(member.pid)
      if (
        !validIdentity(member) ||
        member.pid === owner.pid ||
        seen.has(member.pid) ||
        !row ||
        !sameDarwinCensusIdentity(member, row)
      )
        return unknown('scope_input')
      seen.add(member.pid)
    }
    return Object.freeze({
      kind: 'observation',
      state: view.members.length ? 'busy' : 'empty_at_capture',
      owner: copyIdentity(owner),
      members: Object.freeze(view.members.map(copyIdentity)),
    })
  } catch {
    return unknown('unavailable')
  }
}

let calls: DarwinCensusCalls | undefined
/** Lazy closed binding. Linux never loads Koffi, and no caller selects a library/symbol/flavor. */
export function getDarwinCensusCalls(): DarwinCensusCalls {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch))
    throw new Error('Native macOS process inventory is unavailable')
  if (!calls) {
    try {
      const require = createRequire(import.meta.url)
      const ffi = require('koffi') as typeof import('koffi')
      if (ffi.version !== '3.3.3') throw new Error('unsupported binding')
      const proc = ffi.load('/usr/lib/libproc.dylib')
      const info = proc.func(
        'int proc_pidinfo(int pid, int flavor, uint64_t arg, _Out_ void *buffer, int size)',
      ) as (pid: number, flavor: number, arg: bigint, buffer: Buffer, size: number) => number
      const pids = proc.func('int proc_listallpids(_Out_ void *buffer, int size)') as (
        buffer: Buffer,
        size: number,
      ) => number
      const read = (pid: number, flavor: 13 | 17, buffer: Buffer) => {
        if (!validPid(pid)) throw new Error('invalid process identity')
        ffi.errno(0)
        const bytes = info(pid, flavor, 1n, buffer, buffer.length)
        return { bytes, errno: ffi.errno() }
      }
      calls = Object.freeze({
        pids: (buffer: Buffer) => {
          ffi.errno(0)
          const count = pids(buffer, buffer.length)
          return { count, errno: ffi.errno() }
        },
        identity: (pid: number, buffer: Buffer) => read(pid, 17, buffer),
        short: (pid: number, buffer: Buffer) => read(pid, 13, buffer),
      })
    } catch {
      throw new Error('Native macOS process inventory is unavailable')
    }
  }
  return calls
}
