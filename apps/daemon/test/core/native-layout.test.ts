import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  assertNativeLayoutCapture,
  captureNativeLayout,
  type NativeLayoutCapture,
  NativeLayoutError,
  type NativeLayoutOptions,
} from '../../src/lib/native-execution/layout.ts'

async function fixture(
  visit: (
    base: string,
    root: string,
    options: NativeLayoutOptions,
    owned: NativeLayoutCapture[],
  ) => Promise<void>,
) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-native-layout-')))
  const root = join(base, 'workspace')
  mkdirSync(join(root, 'memory'), { recursive: true })
  const options: NativeLayoutOptions = {
    registeredPath: root,
    writable: true,
    readableRoots: [],
    readOnlyPaths: [{ path: join(root, 'memory'), kind: 'directory' }],
  }
  const owned: NativeLayoutCapture[] = []
  try {
    await visit(base, root, options, owned)
    for (const capture of owned) capture.close()
    rmSync(base, { recursive: true })
  } catch (cause) {
    for (const capture of owned) capture.close()
    throw new Error(`Native layout test failed; retained ${base}`, { cause })
  }
}

test('full metadata capture admits a normal workspace without reading file content', async () => {
  await fixture(async (_base, root, options, owned) => {
    writeFileSync(join(root, 'file'), 'not a retained source-content snapshot')
    chmodSync(join(root, 'file'), 0)
    const capture = await captureNativeLayout(options)
    owned.push(capture)
    expect(capture.entries).toBe(2)
    expect(capture.directories).toBe(2)
    expect(capture.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    assertNativeLayoutCapture(capture)
    await capture.revalidate()
  })
})

test('writable hardlinks whose entire link set is internal can be admitted', async () => {
  await fixture(async (_base, root, options, owned) => {
    writeFileSync(join(root, 'file'), 'fixture')
    linkSync(join(root, 'file'), join(root, 'alias'))
    const capture = await captureNativeLayout(options)
    owned.push(capture)
    await capture.revalidate()
  })
})

test('a writable inode also named outside the workspace refuses', async () => {
  await fixture(async (base, root, options) => {
    writeFileSync(join(base, 'external'), 'outside synthetic marker')
    linkSync(join(base, 'external'), join(root, 'alias'))
    await expect(captureNativeLayout(options)).rejects.toMatchObject({ reason: 'shared_inode' })
  })
})

test('an inode spanning a readonly carveout and writable path refuses', async () => {
  await fixture(async (_base, root, options) => {
    writeFileSync(join(root, 'memory', 'note'), 'shared memory')
    linkSync(join(root, 'memory', 'note'), join(root, 'alias'))
    await expect(captureNativeLayout(options)).rejects.toMatchObject({ reason: 'shared_inode' })
  })
})

test('internal symlinks are observed without recursively following directory aliases', async () => {
  await fixture(async (_base, root, options, owned) => {
    writeFileSync(join(root, 'file'), 'fixture')
    symlinkSync('file', join(root, 'alias'))
    symlinkSync('.', join(root, 'directory-alias'))
    const capture = await captureNativeLayout(options)
    owned.push(capture)
    expect(capture.entries).toBe(4)
    expect(capture.directories).toBe(2)
  })
})

test('outside and dangling symlink targets refuse rather than being omitted', async () => {
  await fixture(async (base, root, options) => {
    writeFileSync(join(base, 'external'), 'fixture')
    symlinkSync('../external', join(root, 'outside'))
    await expect(captureNativeLayout(options)).rejects.toMatchObject({ reason: 'symlink_escape' })
    rmSync(join(root, 'outside'))
    symlinkSync('missing', join(root, 'dangling'))
    await expect(captureNativeLayout(options)).rejects.toMatchObject({ reason: 'symlink_escape' })
  })
})

test('immutable input aliases stay recorded but add no outside readable root', async () => {
  await fixture(async (base, root, options, owned) => {
    writeFileSync(join(base, 'outside'), 'unavailable synthetic marker')
    symlinkSync('../outside', join(root, 'external'))
    symlinkSync('missing', join(root, 'dangling'))
    const selection = { ...options, writable: false }
    const capture = await captureNativeLayout(selection)
    owned.push(capture)
    expect(capture.writable).toBe(false)
    expect(capture.unavailableSymlinks).toBe(2)
    expect(capture.readableRoots).toEqual([root])
    selection.writable = true
    await capture.revalidate()
    expect(capture.writable).toBe(false)
    expect(Object.isFrozen(capture.readableRoots)).toBe(true)
  })
})

test('readonly and writable captures have different safety fingerprints', async () => {
  await fixture(async (_base, _root, options, owned) => {
    const writable = await captureNativeLayout(options)
    owned.push(writable)
    const readonly = await captureNativeLayout({ ...options, writable: false })
    owned.push(readonly)
    expect(readonly.fingerprint).not.toBe(writable.fingerprint)
  })
})

test('an explicitly admitted canonical readonly root can be a symlink target', async () => {
  await fixture(async (base, root, options, owned) => {
    const runtime = join(base, 'runtime')
    mkdirSync(runtime)
    writeFileSync(join(runtime, 'file'), 'trusted input')
    symlinkSync(join(runtime, 'file'), join(root, 'runtime-link'))
    const capture = await captureNativeLayout({ ...options, readableRoots: [runtime] })
    owned.push(capture)
  })
})

test('host service socket nodes are refused without connecting to them', async () => {
  await fixture(async (_base, root, options) => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(join(root, 'host-service.sock'), resolve)
    })
    try {
      await expect(captureNativeLayout(options)).rejects.toMatchObject({ reason: 'special_file' })
      await expect(captureNativeLayout({ ...options, writable: false })).rejects.toMatchObject({
        reason: 'special_file',
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})

test('revalidation catches new files and changed contents before executable input release', async () => {
  await fixture(async (_base, root, options, owned) => {
    writeFileSync(join(root, 'file'), 'before')
    const capture = await captureNativeLayout(options)
    owned.push(capture)
    writeFileSync(join(root, 'file'), 'after')
    await expect(capture.revalidate()).rejects.toMatchObject({ reason: 'changed' })
  })
})

test('a replaced registration and copied/closed capability cannot be adopted', async () => {
  await fixture(async (_base, root, options, owned) => {
    const capture = await captureNativeLayout(options)
    owned.push(capture)
    expect(() => assertNativeLayoutCapture({ ...capture })).toThrow(NativeLayoutError)
    renameSync(root, `${root}-original`)
    mkdirSync(root)
    await expect(capture.revalidate()).rejects.toMatchObject({ reason: 'changed' })
    capture.close()
    capture.close()
    expect(() => assertNativeLayoutCapture(capture)).toThrow(NativeLayoutError)
  })
})

test('abort and fixed depth limits refuse with owned descriptors unwound', async () => {
  await fixture(async (_base, root, options) => {
    const controller = new AbortController()
    controller.abort()
    await expect(captureNativeLayout({ ...options, signal: controller.signal })).rejects.toThrow()
    let path = root
    for (let index = 0; index < 65; index++) {
      path = join(path, 'deep')
      mkdirSync(path)
    }
    await expect(captureNativeLayout(options)).rejects.toMatchObject({ reason: 'limit' })
  })
})
