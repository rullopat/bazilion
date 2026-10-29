import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  darwinMountIdentity,
  linuxMountIdentity,
  nativeMountIdentity,
} from '../../src/lib/native-execution/mounts.ts'
import { ContextDirectory } from '../../src/lib/repository-context/files.ts'

function darwin() {
  const buffer = Buffer.alloc(2168)
  buffer.writeUInt32LE(4096, 0)
  buffer.writeUInt32LE(17, 48)
  buffer.writeUInt32LE(26, 52)
  buffer.writeUInt32LE(26, 60)
  buffer.writeUInt32LE(0x1000, 64)
  buffer.write('apfs', 72)
  buffer.write('/System/Volumes/Data', 88)
  return buffer
}

test('Linux mount IDs are exact, bounded and scoped to known local filesystem types', () => {
  const key = linuxMountIdentity(
    Buffer.from('pos:\t0\nmnt_id:\t114\nino:\t1\n'),
    0x9123683en,
    4096n,
  )
  expect(key).toMatch(/^[0-9a-f]{64}$/)
  expect(linuxMountIdentity(Buffer.from('mnt_id:\t115\n'), 0x9123683en, 4096n)).not.toBe(key)
  expect(() => linuxMountIdentity(Buffer.from('mnt_id:\t114\n'), 0x6969n, 4096n)).toThrow(
    'unavailable',
  )
  for (const text of [
    '',
    'mnt_id:\t0\n',
    'mnt_id:\t1\nmnt_id:\t2\n',
    'mnt_id:\n123\n',
    'mnt_id:\t18446744073709551616\n',
  ]) {
    expect(() => linuxMountIdentity(Buffer.from(text), 0xef53n, 4096n)).toThrow('unavailable')
  }
})

test('public Darwin mount identity ignores volatile counters but not mountpoint or fsid', () => {
  const buffer = darwin()
  const key = darwinMountIdentity(buffer, 4096n)
  buffer.writeBigUInt64LE(999n, 16)
  expect(darwinMountIdentity(buffer, 4096n)).toBe(key)
  buffer.writeUInt32LE(18, 48)
  expect(darwinMountIdentity(buffer, 4096n)).not.toBe(key)
  buffer.writeUInt32LE(17, 48)
  buffer.fill(0, 88, 1112)
  buffer.write('/System/Volumes/Data/other-mount', 88)
  expect(darwinMountIdentity(buffer, 4096n)).not.toBe(key)
})

test('Darwin layout, remote/FUSE filesystem and incomplete fields fail closed', () => {
  expect(() => darwinMountIdentity(Buffer.alloc(2167), 4096n)).toThrow('unavailable')
  expect(() => darwinMountIdentity(darwin(), 8192n)).toThrow('unavailable')
  const mutations = [
    (buffer: Buffer) => buffer.writeUInt32LE(0, 64),
    (buffer: Buffer) => buffer.fill(0, 48, 56),
    (buffer: Buffer) => buffer.fill(65, 88, 1112),
    (buffer: Buffer) => {
      buffer.fill(0, 72, 88)
      buffer.write('osxfuse', 72)
    },
  ]
  for (const mutate of mutations) {
    const buffer = darwin()
    mutate(buffer)
    expect(() => darwinMountIdentity(buffer, 4096n)).toThrow('unavailable')
  }
})

test('HFS directory-hardlink surface is not admitted for writable native scopes', () => {
  const buffer = darwin()
  buffer.fill(0, 72, 88)
  buffer.write('hfs', 72)
  expect(darwinMountIdentity(buffer, 4096n, false)).toMatch(/^[a-f0-9]{64}$/)
  expect(() => darwinMountIdentity(buffer, 4096n, true)).toThrow('unavailable')
})

test('actual retained directory mount facts survive legal content changes, not root substitution', () => {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-native-mount-'))
  mkdirSync(join(root, 'child'))
  const directory = new ContextDirectory(root)
  try {
    const before = nativeMountIdentity(directory, true)
    directory.list()
    writeFileSync(join(root, 'file'), 'mutable workspace')
    expect(nativeMountIdentity(directory, true)).toBe(before)
    directory.close()
    expect(() => nativeMountIdentity(directory, true)).toThrow()
    rmSync(root, { recursive: true })
  } catch (cause) {
    directory.close()
    throw new Error(`Mount capture failed; retained ${root}`, { cause })
  }
})
