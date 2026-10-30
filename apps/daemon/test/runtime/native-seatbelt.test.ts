import { expect, test } from 'vitest'
import {
  compileDarwinSeatbeltPolicy,
  type SeatbeltPaths,
} from '../../src/runtime/shell/native/seatbelt.ts'

function paths(): SeatbeltPaths {
  return {
    workspace: '/team',
    scratch: '/run/job/tmp',
    ipcDirectory: '/run/job/tmp/ipc',
    readOnlyInputs: [
      { path: '/runtime/node', kind: 'file', executable: true },
      { path: '/runtime/code', kind: 'directory', executable: true },
      { path: '/uploads/input.txt', kind: 'file', executable: false },
    ],
    metadataDirectories: ['/runtime/links'],
    unavailableInputs: [
      { path: '/state/auth.json', kind: 'file' },
      { path: '/state/agents', kind: 'directory' },
    ],
  }
}

test('closed native policy explicitly denies outside process information and non-private networking', () => {
  const policy = compileDarwinSeatbeltPolicy(paths())
  expect(policy).toContain('(deny default)')
  expect(policy).toContain('(deny process-info*)\n(allow process-info* (target same-sandbox))')
  expect(policy).not.toContain('(allow process-info-listpids)')
  expect(policy).toContain('(deny network*)')
  expect(policy).toContain('(allow system-socket (socket-domain AF_UNIX))')
  expect(policy).not.toContain('AF_INET')
  expect(policy).not.toContain('localhost')
  expect(policy).not.toContain('mach-lookup')
  expect(policy).not.toContain('(allow file-link')
  expect(policy).toContain('(subpath "/run/job/tmp/ipc")')
  expect(policy).toContain('(mac-syscall-number 67)')
  expect(policy).not.toContain('(allow system-mac-syscall)')
})

test('writable root anchors prevent relocation from relabelling the readonly memory carveout', () => {
  const policy = compileDarwinSeatbeltPolicy(paths())
  expect(policy).toContain('(subpath "/team/memory")')
  expect(policy).toContain('(deny file-write-unlink (literal "/run/job/tmp") (literal "/team"))')
  expect(policy.indexOf('(deny file-write-unlink')).toBeGreaterThan(
    policy.indexOf('(allow file-write*'),
  )
})

test('intermediate ancestors of nested readonly inputs are also anchored', () => {
  const original = paths()
  const policy = compileDarwinSeatbeltPolicy({
    ...original,
    readOnlyInputs: [
      ...original.readOnlyInputs,
      { path: '/team/nested/parent/protected', kind: 'directory', executable: false },
      { path: '/run/job/tmp/deep/input.txt', kind: 'file', executable: false },
    ],
  })
  const anchor = policy.split('\n').find((line) => line.startsWith('(deny file-write-unlink'))
  for (const parent of [
    '/team',
    '/team/nested',
    '/team/nested/parent',
    '/run/job/tmp',
    '/run/job/tmp/deep',
  ]) {
    expect(anchor).toContain(`(literal "${parent}")`)
  }
  expect(policy).toContain('(literal "/run/job/tmp/deep/input.txt")')
})

test('explicit input kinds separate exact files, directory subtrees and metadata-only package links', () => {
  const policy = compileDarwinSeatbeltPolicy(paths())
  expect(policy).toContain('(literal "/runtime/node")')
  expect(policy).toContain('(subpath "/runtime/code")')
  expect(policy).toContain('(allow file-read-metadata (subpath "/runtime/links"))')
  const readable = policy
    .split('\n')
    .filter((line) => line.startsWith('(allow file-read* '))
    .join('\n')
  expect(readable).toContain('/runtime/code')
  expect(readable).not.toContain('/runtime/links')
  expect(policy).toContain(
    '(deny file-read* file-write* file-map-executable (literal "/state/auth.json") (subpath "/state/agents"))',
  )
})

test('profile generation is deterministic independent of input ordering and duplicates', () => {
  const original = paths()
  const changed = {
    ...original,
    readOnlyInputs: [...original.readOnlyInputs].reverse(),
    metadataDirectories: [...original.metadataDirectories, ...original.metadataDirectories],
    unavailableInputs: [...original.unavailableInputs].reverse(),
  }
  expect(compileDarwinSeatbeltPolicy(changed)).toBe(compileDarwinSeatbeltPolicy(original))
})

test('quotes and backslashes remain inside Scheme string literals, never policy text', () => {
  const workspace = '/team/quote"slash\\end'
  const policy = compileDarwinSeatbeltPolicy({ ...paths(), workspace })
  expect(policy).toContain('(subpath "/team/quote\\"slash\\\\end")')
  expect(policy).toContain('(literal "/team/quote\\"slash\\\\end")')
})

test.each([
  '/',
  'relative',
  '/team/../other',
  '/team/',
  '/team\n(allow default)',
  '/team\0x',
  '/team\ud800',
])('unsupported path %j refuses instead of emitting ambiguous policy', (workspace) => {
  expect(() => compileDarwinSeatbeltPolicy({ ...paths(), workspace })).toThrow('unavailable')
})

test.each([
  { workspace: '/team', scratch: '/team/tmp' },
  { workspace: '/run', scratch: '/run/job/tmp' },
  { workspace: '/team', scratch: '/team' },
])('overlapping writable roots refuse: %j', (values) => {
  expect(() => compileDarwinSeatbeltPolicy({ ...paths(), ...values })).toThrow('unavailable')
})

test('IPC directory must be a strict descendant of the private scratch root', () => {
  for (const ipcDirectory of ['/team/ipc', '/run/job/tmp', '/run/job/tmp-other/ipc']) {
    expect(() => compileDarwinSeatbeltPolicy({ ...paths(), ipcDirectory })).toThrow('unavailable')
  }
})

test('readonly ancestors cannot silently make the admitted workspace inaccessible or expose private state', () => {
  for (const root of ['/team', '/run/job', '/state']) {
    expect(() =>
      compileDarwinSeatbeltPolicy({
        ...paths(),
        readOnlyInputs: [{ path: root, kind: 'directory', executable: false }],
      }),
    ).toThrow('unavailable')
  }
})

test('writable overlap with a private unavailable root refuses', () => {
  expect(() =>
    compileDarwinSeatbeltPolicy({
      ...paths(),
      unavailableInputs: [{ path: '/team/private/auth.json', kind: 'file' }],
    }),
  ).toThrow('unavailable')
})

test('unbounded or malformed input sets refuse without profile overrides', () => {
  const original = paths()
  expect(() =>
    compileDarwinSeatbeltPolicy({
      ...original,
      readOnlyInputs: Array.from({ length: 257 }, () => ({
        path: '/runtime/input',
        kind: 'file' as const,
        executable: false,
      })),
    }),
  ).toThrow('unavailable')
  expect(() =>
    compileDarwinSeatbeltPolicy({
      ...original,
      readOnlyInputs: [
        { path: '/runtime', kind: 'directory', executable: 'yes' },
      ] as unknown as SeatbeltPaths['readOnlyInputs'],
    }),
  ).toThrow('unavailable')
})
