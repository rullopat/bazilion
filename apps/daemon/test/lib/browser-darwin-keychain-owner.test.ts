import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  admit: true,
  settle: true,
  code: 0,
  stdout: '{"ok":true}\n',
  stderr: '',
  hang: false,
  noPid: false,
  payload: '',
  spawn: vi.fn(),
  settled: vi.fn(),
  externalEffects: false,
}))
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => state.spawn(...args) }))
vi.mock('../../src/lib/process/worker.ts', () => ({
  OwnedDarwinWorker: class {
    constructor(_pid: number, _child: unknown, externalEffects: boolean) {
      state.externalEffects = externalEffects
      if (!state.admit) throw new Error('unknown native birth')
    }
    settled() {
      state.settled()
      return Promise.resolve(state.settle)
    }
  },
}))

import { ensureDarwinBrowserKeychain } from '../../src/lib/browser/darwin-keychain.ts'

const directories: string[] = []
function fixture() {
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  const home = mkdtempSync(join(tmpdir(), 'baz-browser-keychain-owner-'))
  directories.push(home)
  const child = Object.assign(new EventEmitter(), {
    pid: state.noPid ? undefined : 12345,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  })
  child.stdin.on('data', (data) => {
    state.payload += data.toString('utf8')
  })
  child.stdin.on('finish', () => {
    if (state.hang) return
    queueMicrotask(() => {
      child.stdout.end(state.stdout)
      child.stderr.end(state.stderr)
      child.emit('close', state.code)
    })
  })
  state.spawn.mockReturnValue(child)
  if (state.noPid) queueMicrotask(() => child.emit('close', null))
  return { home, child }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  state.admit = true
  state.settle = true
  state.code = 0
  state.stdout = '{"ok":true}\n'
  state.stderr = ''
  state.hang = false
  state.noPid = false
  state.payload = ''
  state.externalEffects = false
  state.spawn.mockReset()
  state.settled.mockReset()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test('private keychain helper admits live ownership before secret input and copies no ambient credential', async () => {
  vi.stubEnv('AMBIENT_PROVIDER_SECRET', 'never-inherit')
  const { home, child } = fixture()
  await ensureDarwinBrowserKeychain(home, 1000)
  const [, args, options] = state.spawn.mock.calls[0] ?? []
  expect(args).toHaveLength(1)
  expect(options).toMatchObject({
    detached: true,
    env: { PATH: '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8' },
  })
  expect(Object.keys(options.env).sort()).toEqual(['HOME', 'LANG', 'PATH'])
  expect(JSON.stringify(args)).not.toContain('never-inherit')
  const input = JSON.parse(state.payload)
  expect(Object.keys(input).sort()).toEqual(['home', 'password'])
  expect(input.home).toBe(home)
  expect(input.password).toMatch(/^[a-f0-9]{64}$/)
  expect(state.settled).toHaveBeenCalledOnce()
  expect(state.externalEffects).toBe(true)
  expect(child.kill).not.toHaveBeenCalled()
})

test('private keychain helper sends no executable input and retains recovery on unknown native birth', async () => {
  state.admit = false
  const { home, child } = fixture()
  await expect(ensureDarwinBrowserKeychain(home, 1000)).rejects.toMatchObject({
    cleanupUnknown: true,
  })
  expect(state.payload).toBe('')
  expect(child.kill).not.toHaveBeenCalled()
})

test('private keychain helper success cannot override unknown descendant/EOF settlement', async () => {
  state.settle = false
  const { home, child } = fixture()
  await expect(ensureDarwinBrowserKeychain(home, 1000)).rejects.toMatchObject({
    cleanupUnknown: true,
  })
  expect(child.kill).not.toHaveBeenCalled()
})

test('private keychain helper coded failure remains failure even after complete cleanup', async () => {
  state.code = 1
  state.stdout = ''
  state.stderr = '{"phase":"unlock","status":-25293}\n'
  const { home } = fixture()
  await expect(ensureDarwinBrowserKeychain(home, 1000)).rejects.toMatchObject({
    cleanupUnknown: false,
    message: expect.stringContaining('phase=unlock'),
  })
})

test('private keychain helper timeout remains failure after owned retirement, never a browser fallback', async () => {
  state.hang = true
  const { home } = fixture()
  await expect(ensureDarwinBrowserKeychain(home, 1)).rejects.toMatchObject({
    cleanupUnknown: false,
  })
  expect(state.settled).toHaveBeenCalledOnce()
})

test('private keychain timeout with unacknowledged external effects retains recovery ownership', async () => {
  state.hang = true
  state.settle = false
  const { home } = fixture()
  await expect(ensureDarwinBrowserKeychain(home, 1)).rejects.toMatchObject({ cleanupUnknown: true })
  expect(state.externalEffects).toBe(true)
})

test('private keychain failed spawn creates no signalling authority', async () => {
  state.noPid = true
  const { home, child } = fixture()
  await expect(ensureDarwinBrowserKeychain(home, 1000)).rejects.toMatchObject({
    cleanupUnknown: false,
  })
  expect(state.payload).toBe('')
  expect(state.settled).not.toHaveBeenCalled()
  expect(child.kill).not.toHaveBeenCalled()
})
