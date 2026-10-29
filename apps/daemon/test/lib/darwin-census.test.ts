import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import {
  composeDarwinDomainObservation,
  DARWIN_CENSUS_MAX_PIDS,
  type DarwinCensusCalls,
  type DarwinCensusIdentity,
  type DarwinCensusInventory,
  DarwinCensusReader,
  type DarwinCensusView,
  getDarwinCensusCalls,
} from '../../src/lib/process/darwin-census.ts'

const { EPERM, EACCES, ESRCH } = constants.errno
interface Row {
  pid: number
  unique: bigint
  version: number
  state: number
  inside: boolean
}
const owner: DarwinCensusIdentity = { pid: 100, uniqueId: '1000', execVersion: 10 }
function fixture() {
  const rows = new Map<number, Row>([
    [1, { pid: 1, unique: 1n, version: 1, state: 5, inside: false }],
    [100, { pid: 100, unique: 1000n, version: 10, state: 3, inside: true }],
    [101, { pid: 101, unique: 1001n, version: 11, state: 3, inside: true }],
    [102, { pid: 102, unique: 1002n, version: 12, state: 5, inside: true }],
    [200, { pid: 200, unique: 2000n, version: 20, state: 3, inside: false }],
  ])
  let listed = [200, 102, 0, 101, 100, 1]
  function calls(scoped: boolean): DarwinCensusCalls {
    const get = (pid: number) => {
      const row = rows.get(pid)
      if (!row) return { kind: 'error', errno: ESRCH } as const
      if (scoped && !row.inside) return { kind: 'error', errno: EPERM } as const
      return { kind: 'row', row } as const
    }
    return {
      pids(buffer) {
        listed.forEach((pid, index) => {
          buffer.writeInt32LE(pid, index * 4)
        })
        return { count: listed.length, errno: 0 }
      },
      identity(pid, buffer) {
        const found = get(pid)
        if (found.kind === 'error') return { bytes: 0, errno: found.errno }
        buffer.writeBigUInt64LE(found.row.unique, 16)
        buffer.writeInt32LE(found.row.version, 32)
        return { bytes: 56, errno: 0 }
      },
      short(pid, buffer) {
        const found = get(pid)
        if (found.kind === 'error') return { bytes: 0, errno: found.errno }
        buffer.writeUInt32LE(found.row.pid, 0)
        buffer.writeUInt32LE(found.row.state, 12)
        buffer.writeUInt32LE(pid === 1 ? 0 : 501, 36)
        return { bytes: 64, errno: 0 }
      },
    }
  }
  const outside = calls(false)
  const inside = calls(true)
  const reader = new DarwinCensusReader(outside, 100, () => 0)
  const observer = new DarwinCensusReader(inside, 100, () => 0)
  return {
    rows,
    outside,
    inside,
    reader,
    observer,
    setListed: (value: number[]) => {
      listed = value
    },
  }
}
function inventory(reader: DarwinCensusReader): DarwinCensusInventory {
  const result = reader.inventory()
  if (result.kind !== 'inventory') throw new Error(`fixture inventory: ${result.reason}`)
  return result
}
function view(observer: DarwinCensusReader, data: DarwinCensusInventory): DarwinCensusView {
  const result = observer.scope(data, owner)
  if (result.kind !== 'view') throw new Error(`fixture view: ${result.reason}`)
  return result
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('scoped self identity reuses complete ABI/birth checks and never admits a zombie owner', () => {
  const f = fixture()
  expect(f.observer.ownIdentity()).toEqual(owner)
  const own = f.rows.get(owner.pid)
  if (!own) throw new Error('fixture owner missing')
  own.state = 5
  expect(f.observer.ownIdentity()).toEqual({ kind: 'unknown', reason: 'owner' })
  f.rows.delete(owner.pid)
  expect(f.observer.ownIdentity()).toEqual({ kind: 'unknown', reason: 'identity_esrch' })
})

test('complete Darwin census sorts IDs, preserves uint64 precision and includes foreign zombies', () => {
  const f = fixture()
  const row = f.rows.get(200)
  if (!row) throw new Error('missing fixture')
  row.unique = 9_007_199_254_740_993n
  const data = inventory(f.reader)
  expect(data.rows.map((row) => row.pid)).toEqual([1, 100, 101, 102, 200])
  expect(data.rows[0]).toMatchObject({ pid: 1, state: 'zombie' })
  expect(data.rows.at(-1)?.uniqueId).toBe('9007199254740993')
  expect(Object.isFrozen(data.rows)).toBe(true)
  expect(Object.isFrozen(data.rows[0])).toBe(true)
  expect(Object.keys(data.rows[0] ?? {}).sort()).toEqual([
    'execVersion',
    'pid',
    'state',
    'uniqueId',
  ])
})

test('same-sandbox view counts foreign denials and dead members without hiding a live writer', () => {
  const f = fixture()
  const first = inventory(f.reader)
  const observed = view(f.observer, first)
  expect(observed).toMatchObject({ outsideCount: 2, zombieCount: 1, owner })
  expect(observed.members).toEqual([{ pid: 101, uniqueId: '1001', execVersion: 11 }])
  expect(
    composeDarwinDomainObservation(first, observed, inventory(f.reader), owner, 20),
  ).toMatchObject({ kind: 'observation', state: 'busy' })
})

test('only complete matching inventories and an accounted-for live owner produce empty-at-capture', () => {
  const f = fixture()
  const child = f.rows.get(101)
  if (!child) throw new Error('missing fixture')
  child.state = 5
  const first = inventory(f.reader)
  const result = composeDarwinDomainObservation(
    first,
    view(f.observer, first),
    inventory(f.reader),
    owner,
    10,
  )
  expect(result).toEqual({ kind: 'observation', state: 'empty_at_capture', owner, members: [] })
  expect(Object.isFrozen(result)).toBe(true)
})

test.each([
  { count: 0, errno: 0 },
  { count: -1, errno: EPERM },
  { count: 1.5, errno: 0 },
  { count: DARWIN_CENSUS_MAX_PIDS + 1, errno: 0 },
  { count: 1, errno: EACCES },
])('incomplete or truncated global PID lists are unknown: %j', (result) => {
  const f = fixture()
  vi.spyOn(f.outside, 'pids').mockReturnValue(result)
  expect(f.reader.inventory()).toEqual({ kind: 'unknown', reason: 'pid_list' })
})

test.each([
  { listed: [100, 100] },
  { listed: [0, 0, 100] },
  { listed: [-1, 100] },
  { listed: [1, 200] },
])('ambiguous PID set %j cannot be a complete inventory', ({ listed }) => {
  const f = fixture()
  f.setListed(listed)
  expect(f.reader.inventory().kind).toBe('unknown')
})

test.each([
  EPERM,
  EACCES,
  ESRCH,
])('outside collector error %d cannot silently remove a process', (errno) => {
  const f = fixture()
  vi.spyOn(f.outside, 'identity').mockReturnValue({ bytes: 0, errno })
  expect(f.reader.inventory()).toEqual({
    kind: 'unknown',
    reason:
      errno === EPERM ? 'identity_eperm' : errno === EACCES ? 'identity_eacces' : 'identity_esrch',
  })
})

test('partial identity/short responses and changed reserved ABI fields refuse', () => {
  const f = fixture()
  vi.spyOn(f.outside, 'identity').mockReturnValue({ bytes: 55, errno: 0 })
  expect(f.reader.inventory().kind).toBe('unknown')
  vi.restoreAllMocks()
  vi.spyOn(f.outside, 'short').mockReturnValue({ bytes: 63, errno: 0 })
  expect(f.reader.inventory().kind).toBe('unknown')
  vi.restoreAllMocks()
  const original = f.outside.identity
  vi.spyOn(f.outside, 'identity').mockImplementation((pid, buffer) => {
    const result = original(pid, buffer)
    buffer.writeBigUInt64LE(1n, 48)
    return result
  })
  expect(f.reader.inventory()).toEqual({ kind: 'unknown', reason: 'layout' })
})

test.each(['unique', 'version'] as const)('intra-row %s changes are refused', (field) => {
  const f = fixture()
  const original = f.outside.short
  vi.spyOn(f.outside, 'short').mockImplementation((pid, buffer) => {
    const result = original(pid, buffer)
    const row = f.rows.get(pid)
    if (!row) throw new Error('missing fixture')
    if (field === 'unique') row.unique++
    else row.version++
    return result
  })
  expect(f.reader.inventory()).toEqual({ kind: 'unknown', reason: 'drift' })
})

test.each([0, 1, 6])('unavailable/constructing process state %d is unknown', (state) => {
  const f = fixture()
  const row = f.rows.get(101)
  if (!row) throw new Error('missing fixture')
  row.state = state
  expect(f.reader.inventory().kind).toBe('unknown')
})

test('PID set changes after collection cannot hide a newly born child', () => {
  const f = fixture()
  const original = f.outside.pids
  let reads = 0
  vi.spyOn(f.outside, 'pids').mockImplementation((buffer) => {
    if (++reads === 2) f.setListed([1, 100, 101, 102, 200, 201])
    return original(buffer)
  })
  expect(f.reader.inventory()).toEqual({ kind: 'unknown', reason: 'drift' })
})

test.each([EACCES, ESRCH, 0])('scope error %d is not a foreign-policy exclusion', (errno) => {
  const f = fixture()
  const first = inventory(f.reader)
  vi.spyOn(f.inside, 'identity').mockReturnValue({ bytes: 0, errno })
  expect(f.observer.scope(first, owner)).toEqual({
    kind: 'unknown',
    reason: errno === EACCES ? 'identity_eacces' : errno === ESRCH ? 'identity_esrch' : 'identity',
  })
})

test.each([
  EPERM,
  EACCES,
  ESRCH,
])('short-BSD syscall error %d stays closed unknown diagnostic facts, not authority', (errno) => {
  const f = fixture()
  vi.spyOn(f.outside, 'short').mockReturnValue({ bytes: 0, errno })
  const value = f.reader.inventory()
  expect(value).toEqual({
    kind: 'unknown',
    reason: errno === EPERM ? 'short_eperm' : errno === EACCES ? 'short_eacces' : 'short_esrch',
  })
  expect(Object.keys(value).sort()).toEqual(['kind', 'reason'])
})

test('denied owner and changed expected process versions cannot produce a view', () => {
  const f = fixture()
  const first = inventory(f.reader)
  const row = f.rows.get(100)
  if (!row) throw new Error('missing fixture')
  row.inside = false
  expect(f.observer.scope(first, owner).kind).toBe('unknown')
  row.inside = true
  row.version++
  expect(f.observer.scope(first, owner)).toEqual({ kind: 'unknown', reason: 'drift' })
})

test('both per-reader and combined budgets fail closed without extending capture time', () => {
  const f = fixture()
  let ticks = 0
  const slow = new DarwinCensusReader(f.outside, 100, () => (ticks++ ? 501 : 0))
  expect(slow.inventory()).toEqual({ kind: 'unknown', reason: 'budget' })
  const first = inventory(f.reader)
  const observed = view(f.observer, first)
  for (const elapsed of [-1, 501, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(composeDarwinDomainObservation(first, observed, first, owner, elapsed)).toEqual({
      kind: 'unknown',
      reason: 'budget',
    })
  }
})

test.each([
  'unique',
  'version',
  'new-child',
] as const)('bracketing %s drift is unknown, never empty', (change) => {
  const f = fixture()
  const first = inventory(f.reader)
  const observed = view(f.observer, first)
  const row = f.rows.get(200)
  if (!row) throw new Error('missing fixture')
  if (change === 'unique') row.unique++
  else if (change === 'version') row.version++
  else {
    f.rows.set(201, { ...row, pid: 201, unique: 2001n })
    f.setListed([1, 100, 101, 102, 200, 201])
  }
  expect(composeDarwinDomainObservation(first, observed, inventory(f.reader), owner, 10)).toEqual({
    kind: 'unknown',
    reason: 'drift',
  })
})

test('a malformed or under-accounted view cannot manufacture an empty observation', () => {
  const f = fixture()
  const first = inventory(f.reader)
  const observed = view(f.observer, first)
  const malformed = [
    { ...observed, members: [] },
    { ...observed, members: [owner], outsideCount: 2 },
    { ...observed, kind: 'unknown' },
    { ...observed, owner: { ...owner, pid: 200 } },
    { ...observed, zombieCount: -1 },
    { ...observed, members: [...observed.members, ...observed.members], outsideCount: 1 },
  ]
  for (const value of malformed) {
    expect(
      composeDarwinDomainObservation(first, value as DarwinCensusView, first, owner, 10).kind,
    ).toBe('unknown')
  }
})

test('scope manifest rejects duplicate, unsorted, unsafe-integer and malformed opaque identities', () => {
  const f = fixture()
  const first = inventory(f.reader)
  const row = first.rows[0]
  if (!row) throw new Error('missing fixture')
  const invalid = [
    [],
    [row, row],
    [...first.rows].reverse(),
    [{ ...row, pid: Number.MAX_SAFE_INTEGER }],
    [{ ...row, uniqueId: '18446744073709551616' }],
    [{ ...row, uniqueId: '0' }],
    [{ ...row, execVersion: 0 }],
    [{ ...row, state: 'absent' }],
    [{ ...row, unexpected: 'not admitted' }],
  ]
  for (const rows of invalid) {
    expect(f.observer.scope({ kind: 'inventory', rows } as DarwinCensusInventory, owner).kind).toBe(
      'unknown',
    )
  }
})

test('a zombie owner is not a live census authority', () => {
  const f = fixture()
  const first = inventory(f.reader)
  const observed = view(f.observer, first)
  const row = f.rows.get(100)
  if (!row) throw new Error('missing fixture')
  row.state = 5
  expect(composeDarwinDomainObservation(first, observed, inventory(f.reader), owner, 10)).toEqual({
    kind: 'unknown',
    reason: 'owner',
  })
})

test('trusted staging strips types outside the sandbox so jitless helpers need no TypeScript WASM parser', () => {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-native-census-js-'))
  const source = readFileSync(
    fileURLToPath(new URL('../../src/lib/process/darwin-census.ts', import.meta.url)),
    'utf8',
  )
  const target = join(root, 'census.mjs')
  writeFileSync(target, stripTypeScriptTypes(source, { mode: 'strip' }), { mode: 0o600 })
  const result = spawnSync(
    process.execPath,
    [
      '--jitless',
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(target).href)}); if (typeof m.DarwinCensusReader !== 'function') throw Error('missing reader'); console.log('native_helper_import_ok')`,
    ],
    {
      cwd: root,
      env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root, LANG: 'C' },
      encoding: 'utf8',
      timeout: 5000,
    },
  )
  if (result.status !== 0 || result.signal !== null || result.error) {
    throw new Error(`Jitless staging failed; retained fixture ${root}: ${result.stderr}`)
  }
  expect(result.stdout.trim()).toBe('native_helper_import_ok')
  rmSync(root, { recursive: true, force: true })
})

test('non-Darwin callers cannot activate the process ABI by requesting a census', () => {
  vi.stubGlobal('process', { ...process, platform: 'linux' })
  expect(() => getDarwinCensusCalls()).toThrow('Native macOS process inventory is unavailable')
})
