import { constants } from 'node:os'
import { afterEach, expect, test, vi } from 'vitest'
import {
  type DarwinProcessCalls,
  DarwinProcessInspector,
  getDarwinProcessInspector,
} from '../../src/lib/process/darwin.ts'

interface Row {
  pid: number
  parent: number
  group: number
  uid: number
  seconds: bigint
  micros: bigint
  monotonic: bigint
  state: number
}
function fixture() {
  const rows = new Map<number, Row>()
  rows.set(300, {
    pid: 300,
    parent: process.pid,
    group: 300,
    uid: 501,
    seconds: 1_800_000_000n,
    micros: 1n,
    monotonic: 300_000n,
    state: 3,
  })
  const sessions = new Map([[300, 300]])
  const calls: DarwinProcessCalls = {
    bsd(pid, buffer) {
      const row = rows.get(pid)
      if (!row) return { bytes: 0, errno: constants.errno.ESRCH }
      buffer.writeUInt32LE(row.state, 4)
      buffer.writeUInt32LE(row.pid, 12)
      buffer.writeUInt32LE(row.parent, 16)
      buffer.writeUInt32LE(row.uid, 20)
      buffer.writeUInt32LE(row.group, 100)
      buffer.writeBigUInt64LE(row.seconds, 120)
      buffer.writeBigUInt64LE(row.micros, 128)
      return { bytes: 136, errno: 0 }
    },
    birth(pid, buffer) {
      const row = rows.get(pid)
      if (!row) return { status: -1, errno: constants.errno.ESRCH }
      buffer.writeBigUInt64LE(row.monotonic, 80)
      return { status: 0, errno: 0 }
    },
    pids(group, buffer) {
      const members = [...rows.values()].filter((row) => row.group === group)
      members.forEach((row, i) => {
        buffer.writeInt32LE(row.pid, i * 4)
      })
      return { count: members.length, errno: 0 }
    },
    session(pid) {
      const id = sessions.get(pid)
      return id ? { id, errno: 0 } : { id: -1, errno: constants.errno.ESRCH }
    },
  }
  return { rows, sessions, calls, inspector: new DarwinProcessInspector(calls) }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('Darwin birth identity retains microseconds and exact uint64 fields', () => {
  const f = fixture()
  const row = f.rows.get(300)
  if (!row) throw new Error('missing fixture')
  row.seconds = 9_007_199_254_740_993n
  row.micros = 42n
  const first = f.inspector.member(300)
  expect(first).toMatchObject({ pid: 300, session: 300, uid: 501 })
  expect(first?.start).toBe('9007199254740993:42:300000')
  row.micros = 43n
  expect(f.inspector.member(300)?.start).not.toBe(first?.start)
})

test('Darwin permission errors, partial ABI responses and invalid fields are unknown, not absent', () => {
  const f = fixture()
  vi.spyOn(f.calls, 'bsd').mockReturnValue({ bytes: 0, errno: constants.errno.EACCES })
  expect(() => f.inspector.member(300)).toThrow('cannot be inspected')
  vi.mocked(f.calls.bsd).mockReturnValue({ bytes: 135, errno: 0 })
  expect(() => f.inspector.member(300)).toThrow('cannot be inspected')
})

test.each([
  'pid',
  'group',
  'micros',
  'state',
] as const)('a malformed Darwin %s cannot become process identity', (field) => {
  const f = fixture()
  const row = f.rows.get(300)
  if (!row) throw new Error('missing fixture')
  if (field === 'pid') row.pid = 301
  if (field === 'group') row.group = 0
  if (field === 'micros') row.micros = 1_000_000n
  if (field === 'state') row.state = 0
  expect(() => f.inspector.member(300)).toThrow('cannot be inspected')
})

test.each([
  'birth',
  'group',
  'uid',
  'monotonic',
] as const)('Darwin %s drift across getsid refuses the composite observation', (field) => {
  const f = fixture()
  vi.spyOn(f.calls, 'session').mockImplementation(() => {
    const row = f.rows.get(300)
    if (!row) throw new Error('missing fixture')
    if (field === 'birth') row.micros++
    if (field === 'group') row.group++
    if (field === 'uid') row.uid++
    if (field === 'monotonic') row.monotonic++
    return { id: 300, errno: 0 }
  })
  expect(() => f.inspector.member(300)).toThrow('changed during inspection')
})

test('denied or unavailable monotonic birth evidence cannot fall back to a wall-clock anchor', () => {
  const f = fixture()
  vi.spyOn(f.calls, 'birth').mockReturnValue({ status: -1, errno: constants.errno.EACCES })
  expect(() => f.inspector.member(300)).toThrow('cannot be inspected')
  vi.mocked(f.calls.birth).mockImplementation(() => ({ status: 0, errno: 0 }))
  expect(() => f.inspector.member(300)).toThrow('cannot be inspected')
})

test('a process observed gone during composite inspection is absent, not a stale anchor', () => {
  const f = fixture()
  vi.spyOn(f.calls, 'session').mockImplementation(() => {
    f.rows.delete(300)
    return { id: 300, errno: 0 }
  })
  expect(f.inspector.member(300)).toBeNull()
})

test('a denied session query is unknown rather than an empty process group', () => {
  const f = fixture()
  vi.spyOn(f.calls, 'session').mockReturnValue({ id: -1, errno: constants.errno.EPERM })
  expect(() => f.inspector.group(300)).toThrow('cannot be inspected')
})

test('Darwin group inspection excludes zombies without dropping surviving live members', () => {
  const f = fixture()
  const row = f.rows.get(300)
  if (!row) throw new Error('missing fixture')
  f.rows.set(301, { ...row, pid: 301, parent: 300, state: 5 })
  f.rows.set(303, { ...row, pid: 303, parent: 300 })
  f.sessions.set(303, 300)
  expect(f.inspector.group(300).map((member) => member.pid)).toEqual([300, 303])
})

test('inconsistent Darwin session membership cannot become an empty-group receipt', () => {
  const f = fixture()
  f.sessions.set(300, 299)
  expect(() => f.inspector.group(300)).toThrow('group changed during inspection')
})

test('a leader disappearing during enumeration cannot hide a newly forked Darwin group member', () => {
  const f = fixture()
  const row = f.rows.get(300)
  if (!row) throw new Error('missing fixture')
  vi.spyOn(f.calls, 'session').mockImplementation(() => {
    f.rows.delete(300)
    f.rows.set(301, { ...row, pid: 301, parent: 1 })
    f.sessions.set(301, 300)
    return { id: 300, errno: 0 }
  })
  expect(() => f.inspector.group(300)).toThrow('group changed during inspection')
})

test.each([
  { count: -1, errno: constants.errno.EACCES },
  { count: 0, errno: constants.errno.EACCES },
  { count: 16_385, errno: 0 },
])('failed/truncated Darwin group lists cannot prove retirement: %j', (result) => {
  const f = fixture()
  vi.spyOn(f.calls, 'pids').mockReturnValue(result)
  expect(() => f.inspector.group(300)).toThrow('cannot be inspected')
})

test('duplicate and invalid native PID lists refuse instead of hiding ambiguous membership', () => {
  const f = fixture()
  vi.spyOn(f.calls, 'pids').mockImplementation((_group, buffer) => {
    buffer.writeInt32LE(300, 0)
    buffer.writeInt32LE(300, 4)
    return { count: 2, errno: 0 }
  })
  expect(() => f.inspector.group(300)).toThrow('cannot be inspected')
})

test('Darwin group inspection has a finite time budget', () => {
  const f = fixture()
  vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(501)
  expect(() => f.inspector.group(300)).toThrow('over budget')
})

test('native readiness checks the daemon identity and actual PID-list response before admission', () => {
  const f = fixture()
  const row = f.rows.get(300)
  if (!row) throw new Error('missing fixture')
  f.rows.set(process.pid, { ...row, pid: process.pid, parent: process.ppid })
  f.sessions.set(process.pid, 300)
  expect(() => f.inspector.assertReady()).not.toThrow()
  vi.spyOn(f.calls, 'pids').mockReturnValue({ count: 0, errno: 0 })
  expect(() => f.inspector.assertReady()).toThrow('cannot be inspected')
})

test('non-Darwin callers cannot activate the libproc binding by passing a PID', () => {
  vi.stubGlobal('process', { ...process, platform: 'linux' })
  expect(() => getDarwinProcessInspector()).toThrow('cannot be inspected')
})
