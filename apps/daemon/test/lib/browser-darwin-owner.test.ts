import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

const native = vi.hoisted(() => ({ ready: true, inspected: 0 }))
vi.mock('../../src/lib/process/darwin.ts', () => ({
  getDarwinProcessInspector: () => ({
    assertReady() {
      if (!native.ready) throw new Error('inspection unavailable')
    },
    member() {
      native.inspected++
      throw new Error('must not inspect a receipt-only PID')
    },
    group() {
      native.inspected++
      throw new Error('inspection unavailable')
    },
  }),
}))

import { OwnedGroupAuthority } from '../../src/lib/browser/group-authority.ts'
import { startOwnedBrowser } from '../../src/lib/browser/process.ts'
import { probeProcessGroupPresence } from '../../src/lib/browser/profile.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  native.ready = true
  native.inspected = 0
})

test('Darwin browser group authority cannot be reconstructed from a stored PID', () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  const signal = vi.spyOn(process, 'kill')
  const authority = new OwnedGroupAuthority(321)
  authority.signal('SIGKILL')
  expect(authority.ownsLeader()).toBe(false)
  expect(authority.refresh()).toBe(false)
  expect(signal).not.toHaveBeenCalled()
  expect(native.inspected).toBe(0)
})

test('Darwin browser native readiness refuses before profile preparation or spawn', async () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  native.ready = false
  const root = mkdtempSync(join(tmpdir(), 'browser-native-readiness-'))
  const onSpawn = vi.fn()
  try {
    await expect(
      startOwnedBrowser(
        {
          executablePath: process.execPath,
          profileDir: join(root, 'profile'),
          home: join(root, 'home'),
          headless: true,
        },
        onSpawn,
      ),
    ).rejects.toMatchObject({ reasonCode: 'browser_security_unavailable' })
    expect(onSpawn).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'profile'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('unknown Darwin browser-group inspection is not an absent-group recovery proof', () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  const signal = vi.spyOn(process, 'kill')
  expect(probeProcessGroupPresence(321)).toBe('unknown')
  expect(signal).not.toHaveBeenCalled()
})
