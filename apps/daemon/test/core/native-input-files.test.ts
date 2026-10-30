import {
  chmodSync,
  chownSync,
  fstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { captureLinuxElfClosure, readLinuxElfMetadata } from '../../src/lib/native-execution/elf.ts'
import {
  assertNativeFileCapture,
  captureNativeFile,
  type NativeFileCapture,
} from '../../src/lib/native-execution/files.ts'

function fixture(visit: (root: string, owned: NativeFileCapture[]) => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-native-input-files-')))
  const owned: NativeFileCapture[] = []
  try {
    visit(root, owned)
    for (const file of owned) file.close()
    rmSync(root, { recursive: true })
  } catch (cause) {
    for (const file of owned) file.close()
    throw new Error(`Native input capture failed; retained ${root}`, { cause })
  }
}

test('explicit file capture pins readonly identity without granting its parent directory', () => {
  fixture((root, owned) => {
    const path = join(root, 'file')
    writeFileSync(path, 'explicit readonly input', { mode: 0o600 })
    const file = captureNativeFile({ path, executable: false })
    owned.push(file)
    expect(file.canonicalPath).toBe(path)
    expect(fstatSync(file.fd).isFile()).toBe(true)
    file.revalidate()
    expect(() => assertNativeFileCapture({ ...file })).toThrow()
    file.close()
    expect(() => assertNativeFileCapture(file)).toThrow()
    expect(() => fstatSync(file.fd)).toThrow()
  })
})

test('changed file metadata and redirected executable registration refuse', () => {
  fixture((root, owned) => {
    const first = join(root, 'first'),
      second = join(root, 'second'),
      alias = join(root, 'selected')
    writeFileSync(first, 'first', { mode: 0o700 })
    writeFileSync(second, 'second', { mode: 0o700 })
    symlinkSync('first', alias)
    const file = captureNativeFile({ path: alias, executable: true })
    owned.push(file)
    unlinkSync(alias)
    symlinkSync('second', alias)
    expect(() => file.revalidate()).toThrow('refused')
  })
})

test('group/world-writable and setid trusted executables are not admitted', () => {
  fixture((root) => {
    const path = join(root, 'executable')
    writeFileSync(path, 'not executed')
    // macOS inherits the directory GID, which need not be one of this user's groups.
    // An unprivileged chmod can then silently strip SGID. Calibrate an owned fixture,
    // not system permissions, and prove each unsafe bit actually exists before refusal.
    const uid = process.getuid?.(),
      gid = process.getgid?.()
    if (uid === undefined || gid === undefined)
      throw new Error('POSIX fixture identity unavailable')
    chownSync(path, uid, gid)
    for (const mode of [0o777, 0o4755, 0o2755, 0o600]) {
      chmodSync(path, mode)
      expect(statSync(path).mode & 0o7777).toBe(mode)
      expect(() => captureNativeFile({ path, executable: true })).toThrow('refused')
    }
  })
})

test.skipIf(process.platform !== 'linux')(
  'bounded ELF reader refuses non-ELF and out-of-file program tables',
  () => {
    fixture((root, owned) => {
      const path = join(root, 'bad')
      const bytes = Buffer.alloc(256)
      writeFileSync(path, bytes)
      const bad = captureNativeFile({ path, executable: false })
      owned.push(bad)
      expect(() => readLinuxElfMetadata(bad)).toThrow('refused')
      bad.close()
      bytes.set([127, 69, 76, 70, 2, 1, 1])
      bytes.writeUInt16LE(2, 16)
      bytes.writeUInt16LE(process.arch === 'x64' ? 62 : 183, 18)
      bytes.writeUInt16LE(64, 52)
      bytes.writeUInt16LE(56, 54)
      bytes.writeUInt16LE(1, 56)
      bytes.writeBigUInt64LE(0xffffffffffffffffn, 32)
      writeFileSync(path, bytes)
      const malformed = captureNativeFile({ path, executable: false })
      owned.push(malformed)
      expect(() => readLinuxElfMetadata(malformed)).toThrow('refused')
    })
  },
)

test.skipIf(process.platform !== 'linux')(
  'actual Bash/Node/true resolve only a closed readonly ELF file set',
  () => {
    const roots =
      process.arch === 'arm64'
        ? ['/usr/lib', '/usr/lib/aarch64-linux-gnu']
        : ['/usr/lib', '/usr/lib/x86_64-linux-gnu']
    const available = roots.filter((root) => {
      try {
        realpathSync(root)
        return true
      } catch {
        return false
      }
    })
    const closure = captureLinuxElfClosure(
      ['/usr/bin/bash', process.execPath, '/usr/bin/true'],
      available,
    )
    try {
      closure.revalidate()
      expect(closure.files.length).toBeGreaterThan(3)
      expect(closure.files.length).toBeLessThanOrEqual(256)
      expect(
        closure.bindings.every((binding) => binding.file.fd >= 0 && binding.path.startsWith('/')),
      ).toBe(true)
      for (const file of closure.files)
        expect(readLinuxElfMetadata(file).needed).toBeInstanceOf(Array)
    } finally {
      closure.close()
    }
  },
)
