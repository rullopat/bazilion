// T06 — managed launcher bookkeeping, driven without a browser through the
// injectable direct process factory: marker persistence before launch, stale-marker
// reclaim, foreign singleton-lock refusal, proven-vs-uncertain startup
// cleanup, and bounded graceful close. The real launcher is exercised by the
// gated actual-browser lane (BAZILION_TEST_BROWSER=1).

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { BrowserContext } from 'playwright'
import { afterEach, expect, test } from 'vitest'
import { type Paths, resolvePaths } from '../../src/core/paths.ts'
import { installManagedGuards, managedBrowserEnv } from '../../src/lib/browser/guards.ts'
import { launchManagedBrowser, type ManagedLaunchDeps } from '../../src/lib/browser/launch.ts'
import { BrowserProcessError, type startOwnedBrowser } from '../../src/lib/browser/process.ts'
import {
  BROWSER_PROFILE_FORMAT_VERSION,
  browserUserDataDir,
  claimBrowserProfile,
  readOwnerMarker,
  writeOwnerMarker,
} from '../../src/lib/browser/profile.ts'

const homes: string[] = []
function makePaths(): Paths {
  const home = mkdtempSync(join(tmpdir(), 'baz069-launch-'))
  homes.push(home)
  return resolvePaths(home)
}
afterEach(() => {
  while (homes.length) rmSync(homes.pop() as string, { recursive: true, force: true })
})

const ID = { agentId: 'agent-1', teamId: 'team-1' }
const DEAD_PID = 999_999_999

/** A fake page/context pair recording guards activity. */
function fakeContext(opts: { onClose?: () => void } = {}) {
  const initScripts: string[] = []
  const gotos: string[] = []
  const page = {
    goto: async (url: string) => {
      gotos.push(url)
    },
  }
  const context = {
    pages: () => [page],
    on: () => {},
    setDefaultNavigationTimeout: () => {},
    setDefaultTimeout: () => {},
    newPage: async () => page,
    addInitScript: async (script: string) => {
      initScripts.push(script)
    },
    close: async () => {
      opts.onClose?.()
    },
  } as unknown as BrowserContext
  return { context, initScripts, gotos }
}

/** Simulate Chromium creating the user-data dir and its singleton lock naming `pid`. */
function lockProfile(profileDir: string, pid: number): void {
  mkdirSync(profileDir, { recursive: true })
  symlinkSync(`testhost-${pid}`, join(profileDir, 'SingletonLock'), 'file')
}

interface LaunchBehavior {
  error?: Error
  /** The pid Chromium's singleton lock names after "launching". */
  lockPid?: number
  /** Simulate graceful exit: the lock disappears when the context closes. */
  removeLockOnClose?: boolean
}

interface FakeLaunch {
  launcher: typeof startOwnedBrowser
  calls: Array<{
    profileDir: string
    input: Parameters<typeof startOwnedBrowser>[0]
    markerAtCall: ReturnType<typeof readOwnerMarker>
  }>
  contexts: Array<{ initScripts: string[]; gotos: string[] }>
}

/** A recording launcher: captures the on-disk marker at call time. */
function fakeLauncher(behavior: (profileDir: string) => LaunchBehavior): FakeLaunch {
  const calls: FakeLaunch['calls'] = []
  const contexts: FakeLaunch['contexts'] = []
  const launcher: typeof startOwnedBrowser = async (input, onSpawn) => {
    const { profileDir } = input
    calls.push({ profileDir, input, markerAtCall: readOwnerMarker(dirname(profileDir)) })
    const plan = behavior(profileDir)
    if (plan.error) throw plan.error
    if (plan.lockPid !== undefined) {
      onSpawn(plan.lockPid)
      lockProfile(profileDir, plan.lockPid)
    }
    const { context, initScripts, gotos } = fakeContext({
      onClose: () => {
        if (plan.removeLockOnClose) rmSync(join(profileDir, 'SingletonLock'), { force: true })
      },
    })
    await installManagedGuards(context)
    contexts.push({ initScripts, gotos })
    return { context, close: () => context.close() }
  }
  return { launcher, calls, contexts }
}

function launch(paths: Paths, fake: FakeLaunch, deps: Partial<ManagedLaunchDeps> = {}) {
  return launchManagedBrowser({
    paths,
    agentId: ID.agentId,
    teamId: ID.teamId,
    executablePath: '/usr/bin/chromium',
    headless: true,
    deps: { daemonInstanceId: 'test-daemon', startBrowser: fake.launcher, ...deps },
  })
}

test('headed browser environment receives only explicit X11/Wayland display access', () => {
  const paths = makePaths()
  const env = managedBrowserEnv({
    home: paths.browserDir('agent-1'),
    display: ':0',
    xauthority: '/run/user/1000/xauthority',
    waylandDisplay: 'wayland-1',
    xdgRuntimeDir: '/run/user/1000',
  })

  expect(env).toMatchObject({
    HOME: paths.browserDir('agent-1'),
    DISPLAY: ':0',
    XAUTHORITY: '/run/user/1000/xauthority',
    WAYLAND_DISPLAY: 'wayland-1',
    XDG_RUNTIME_DIR: '/run/user/1000',
  })
  expect(env).not.toHaveProperty('OPENAI_API_KEY')
  expect(env).not.toHaveProperty('HTTP_PROXY')
})

test('headed display fields reach the direct launcher; headless env is separately scrubbed', async () => {
  const paths = makePaths()
  const fake = fakeLauncher(() => ({}))
  const handle = await launchManagedBrowser({
    paths,
    ...ID,
    executablePath: '/usr/bin/chromium',
    headless: false,
    display: ':0',
    xauthority: '/test/auth',
    waylandDisplay: 'wayland-1',
    xdgRuntimeDir: '/run/user/1000',
    deps: { daemonInstanceId: 'test-daemon', startBrowser: fake.launcher },
  })
  expect(fake.calls[0]?.input).toMatchObject({
    display: ':0',
    xauthority: '/test/auth',
    waylandDisplay: 'wayland-1',
    xdgRuntimeDir: '/run/user/1000',
  })
  await handle.close()
})

test('uncertain process cleanup retains marker even without a singleton lock', async () => {
  const paths = makePaths()
  await expect(
    launchManagedBrowser({
      paths,
      ...ID,
      executablePath: '/usr/bin/chromium',
      headless: true,
      deps: {
        daemonInstanceId: 'test-daemon',
        startBrowser: async (_input, onSpawn) => {
          onSpawn(process.pid)
          throw new BrowserProcessError('browser_recovery_required', 'unproven exit')
        },
      },
    }),
  ).rejects.toMatchObject({ reasonCode: 'browser_recovery_required' })
  expect(readOwnerMarker(paths.browserDir(ID.agentId))).toMatchObject({
    phase: 'starting',
    pid: process.pid,
    processGroupId: process.pid,
  })
})

test('marker is persisted before launch, marked running with the lock pid, guards installed', async () => {
  const paths = makePaths()
  const fake = fakeLauncher(() => ({ lockPid: 4242, removeLockOnClose: true }))
  const handle = await launch(paths, fake)

  // At launch time the marker was already on disk: phase starting, no pid.
  expect(fake.calls).toHaveLength(1)
  expect(fake.calls[0]?.markerAtCall).toMatchObject({
    phase: 'starting',
    agentId: ID.agentId,
    teamId: ID.teamId,
    daemonInstanceId: 'test-daemon',
  })
  const atCall = fake.calls[0]?.markerAtCall
  expect(atCall && !('error' in atCall) ? atCall.pid : undefined).toBeUndefined()

  // After guards: phase running with the singleton lock's pid.
  const slotDir = paths.browserDir(ID.agentId)
  expect(handle.slotDir).toBe(slotDir)
  expect(handle.profileDir).toBe(join(slotDir, 'user-data'))
  expect(readOwnerMarker(slotDir)).toMatchObject({
    phase: 'running',
    pid: 4242,
    launchNonce: handle.launchNonce,
  })

  // The pinned guards ran on the returned context: both init scripts (P2P
  // removal + observation instrumentation) and the pre-registration initial
  // page refreshed with a covered document.
  expect(fake.contexts[0]?.initScripts).toHaveLength(2)
  expect(fake.contexts[0]?.gotos).toContain('about:blank')

  // Graceful close: the lock is gone, so the marker is removed.
  await handle.close()
  expect(readOwnerMarker(slotDir)).toBeNull()
})

test('refuses a recovery_required slot without launching', async () => {
  const paths = makePaths()
  // A live orphan: a marker from another daemon instance naming a live pid.
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'test-daemon' })
  writeOwnerMarker(paths.browserDir(ID.agentId), {
    formatVersion: BROWSER_PROFILE_FORMAT_VERSION,
    ...ID,
    launchNonce: 'orphan',
    daemonInstanceId: 'other-daemon',
    phase: 'running',
    startedAt: Date.now(),
    pid: process.pid,
    processGroupId: process.pid,
  })
  const fake = fakeLauncher(() => ({}))
  await expect(launch(paths, fake)).rejects.toMatchObject({
    reasonCode: 'browser_recovery_required',
  })
  expect(fake.calls).toHaveLength(0)
})

test('refuses a foreign singleton-lock holder before persisting any marker', async () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'test-daemon' })
  const slotDir = paths.browserDir(ID.agentId)
  lockProfile(browserUserDataDir(slotDir), process.pid) // a live foreign holder
  const fake = fakeLauncher(() => ({}))
  await expect(launch(paths, fake)).rejects.toMatchObject({
    reasonCode: 'browser_recovery_required',
  })
  expect(fake.calls).toHaveLength(0)
  expect(existsSync(join(slotDir, 'owner.json'))).toBe(false)
})

test('startup failure with proven cleanup clears the marker', async () => {
  const paths = makePaths()
  const fake = fakeLauncher(() => ({ error: new Error('spawn exploded') }))
  await expect(launch(paths, fake)).rejects.toMatchObject({
    reasonCode: 'browser_start_failed',
  })
  expect(readOwnerMarker(paths.browserDir(ID.agentId))).toBeNull()
})

test('startup failure with a live child leaves the marker (recovery_required)', async () => {
  const paths = makePaths()
  // The child "spawned" (a live lock holder) but startup then failed.
  const fake = fakeLauncher((profileDir) => {
    lockProfile(profileDir, process.pid)
    return { error: new Error('guards failed') }
  })
  await expect(launch(paths, fake)).rejects.toMatchObject({
    reasonCode: 'browser_recovery_required',
  })
  expect(readOwnerMarker(paths.browserDir(ID.agentId))).toMatchObject({ phase: 'starting' })
})

test('unresolved process retirement reports its closed step without leaking its cause', async () => {
  const paths = makePaths()
  const fake = fakeLauncher(() => ({}))
  const startBrowser = async (...args: Parameters<typeof startOwnedBrowser>) => {
    const owned = await fake.launcher(...args)
    return {
      ...owned,
      close: async () => {
        throw new Error('private raw retirement diagnostic')
      },
    }
  }
  const handle = await launch(paths, fake, { startBrowser })
  await expect(handle.close()).rejects.toMatchObject({
    reasonCode: 'browser_recovery_required',
    message: 'browser retirement could not be proven (process); ownership marker retained',
  })
  expect(readOwnerMarker(paths.browserDir(ID.agentId))).toMatchObject({ phase: 'stopping' })
})

test('an unresolved close leaves the marker and reports recovery_required', async () => {
  const paths = makePaths()
  // The lock keeps naming a live pid after close: exit cannot be established.
  const fake = fakeLauncher(() => ({ lockPid: process.pid }))
  const handle = await launch(paths, fake, { retirementBoundMs: 150 })
  await expect(handle.close()).rejects.toMatchObject({
    reasonCode: 'browser_recovery_required',
    message: 'browser retirement could not be proven (profile-lock); ownership marker retained',
  })
  expect(readOwnerMarker(paths.browserDir(ID.agentId))).toMatchObject({ phase: 'stopping' })
})

test('a stale marker (proven-absent owner) is reclaimed before launch', async () => {
  const paths = makePaths()
  claimBrowserProfile(paths, ID, { daemonInstanceId: 'test-daemon' })
  const slotDir = paths.browserDir(ID.agentId)
  // A previous launch crashed: marker from another instance, pid positively absent.
  writeOwnerMarker(slotDir, {
    formatVersion: BROWSER_PROFILE_FORMAT_VERSION,
    ...ID,
    launchNonce: 'crashed',
    daemonInstanceId: 'other-daemon',
    phase: 'running',
    startedAt: Date.now(),
    pid: DEAD_PID,
  })
  const fake = fakeLauncher(() => ({ lockPid: 4242, removeLockOnClose: true }))
  const handle = await launch(paths, fake)
  // This launch's own marker was in place at launch time.
  expect(fake.calls[0]?.markerAtCall).toMatchObject({
    phase: 'starting',
    launchNonce: handle.launchNonce,
  })
  expect(readOwnerMarker(slotDir)).toMatchObject({
    phase: 'running',
    launchNonce: handle.launchNonce,
  })
  await handle.close()
})
