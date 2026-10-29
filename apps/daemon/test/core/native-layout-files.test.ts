import {
  chmodSync,
  fstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { ContextDirectory } from '../../src/lib/repository-context/files.ts'

async function fixture(visit: (root: string, directory: ContextDirectory) => Promise<void>) {
  const base = mkdtempSync(join(tmpdir(), 'bazilion-native-layout-files-'))
  const root = join(base, 'workspace')
  mkdirSync(root)
  const directory = new ContextDirectory(root)
  try {
    await visit(root, directory)
    directory.close()
    rmSync(base, { recursive: true })
  } catch (cause) {
    directory.close()
    throw new Error(`Metadata capture failed; retained fixture ${base}`, { cause })
  }
}

test('metadata capture records bigint file identity and missing entries without content reads', async () => {
  await fixture(async (root, directory) => {
    writeFileSync(join(root, 'file'), 'private fixture bytes', { mode: 0o600 })
    const metadata = directory.metadata('file')
    expect(metadata?.isFile()).toBe(true)
    expect(typeof metadata?.ino).toBe('bigint')
    expect(metadata?.nlink).toBe(1n)
    expect(directory.metadata('absent')).toBeNull()
    directory.validate()
    writeFileSync(join(root, 'absent'), 'new entry')
    expect(() => directory.validate()).toThrow('source_changed')
  })
})

test('new shared-inode links invalidate a recorded metadata observation', async () => {
  await fixture(async (root, directory) => {
    writeFileSync(join(root, 'file'), 'fixture')
    directory.metadata('file')
    linkSync(join(root, 'file'), join(root, 'alias'))
    expect(() => directory.validate()).toThrow('source_changed')
  })
})

test('mode changes invalidate the observation even when content stays unchanged', async () => {
  await fixture(async (root, directory) => {
    writeFileSync(join(root, 'file'), 'fixture', { mode: 0o600 })
    directory.metadata('file')
    chmodSync(join(root, 'file'), 0o640)
    expect(() => directory.validate()).toThrow('source_changed')
  })
})

test('symlink metadata never follows its target', async () => {
  await fixture(async (root, directory) => {
    symlinkSync('not-present', join(root, 'link'))
    expect(directory.metadata('link')?.isSymbolicLink()).toBe(true)
    directory.validate()
  })
})

test('native literal POSIX names do not relax repository-context target parsing', async () => {
  await fixture(async (root, directory) => {
    const name = String.raw`system-systemd\x2dcryptsetup.slice`
    writeFileSync(join(root, name), 'systemd-style literal filename')
    expect(directory.metadata(name)?.isFile()).toBe(true)
    expect(() => directory.entry(name)).toThrow('unsafe_target')
    const child = String.raw`literal\directory`
    mkdirSync(join(root, child))
    await directory.visitDirectory(child, async (cursor) => {
      expect(cursor.list()).toEqual([])
    })
    expect(() => directory.directory(child)).toThrow('unsafe_target')
    directory.validate()
  })
})

test('ephemeral child traversal validates and closes each descriptor on success', async () => {
  await fixture(async (root, directory) => {
    mkdirSync(join(root, 'child'))
    writeFileSync(join(root, 'child', 'file'), 'fixture')
    let descriptor = -1
    await directory.visitDirectory('child', async (child) => {
      descriptor = child.fd
      expect(child.metadata('file')?.isFile()).toBe(true)
      if (process.platform === 'linux') expect(child.path).toBe(`/proc/self/fd/${descriptor}`)
    })
    expect(() => fstatSync(descriptor)).toThrow()
    directory.validate()
  })
})

test('ephemeral child traversal closes its descriptor if the visitor fails', async () => {
  await fixture(async (root, directory) => {
    mkdirSync(join(root, 'child'))
    let descriptor = -1
    await expect(
      directory.visitDirectory('child', async (child) => {
        descriptor = child.fd
        throw new Error('visitor failed')
      }),
    ).rejects.toThrow('visitor failed')
    expect(() => fstatSync(descriptor)).toThrow()
    directory.validate()
  })
})

test('ephemeral child validation catches namespace changes before returning acceptance', async () => {
  await fixture(async (root, directory) => {
    mkdirSync(join(root, 'child'))
    let descriptor = -1
    await expect(
      directory.visitDirectory('child', async (child) => {
        descriptor = child.fd
        expect(child.list()).toEqual([])
        writeFileSync(join(root, 'child', 'new'), 'fixture')
      }),
    ).rejects.toThrow('source_changed')
    expect(() => fstatSync(descriptor)).toThrow()
  })
})

test('a replaced registered root cannot be accepted through an old retained descriptor', async () => {
  await fixture(async (root, directory) => {
    writeFileSync(join(root, 'file'), 'original')
    directory.metadata('file')
    renameSync(root, `${root}-original`)
    mkdirSync(root)
    writeFileSync(join(root, 'file'), 'substitution')
    expect(() => {
      directory.metadata('file')
      directory.validate()
    }).toThrow('root_changed')
  })
})
