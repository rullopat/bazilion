// Managed local browser lifecycle (BAZ-069): claim the Agent's persistent
// profile, persist ownership before direct spawn, then attach through CDP.
// process.ts owns the live child/group; a stored PID never authorizes attach
// or kill. Uncertain startup/retirement retains the marker and refuses reuse.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { BrowserReasonCode } from '@bazilion/api-types'
import type { BrowserContext } from 'playwright'
import type { Paths } from '../../core/index.ts'
import { getDaemonInstanceId } from '../daemon-liveness.ts'
import { BrowserProcessError, type OwnedBrowserProcess, startOwnedBrowser } from './process.ts'
import {
  BROWSER_PROFILE_FORMAT_VERSION,
  type BrowserOwnerMarker,
  type BrowserProfileDeps,
  browserUserDataDir,
  claimBrowserProfile,
  clearOwnerMarker,
  probeProcessPresence,
  readSingletonLockPid,
  writeOwnerMarker,
} from './profile.ts'

export interface ManagedLaunchInput {
  paths: Paths
  agentId: string
  teamId: string
  executablePath: string
  headless: boolean
  /** Omitted only for the explicit local-development private-network mode. */
  proxyUrl?: string
  display?: string
  xauthority?: string
  waylandDisplay?: string
  xdgRuntimeDir?: string
  deps?: ManagedLaunchDeps
}

export interface ManagedLaunchDeps extends BrowserProfileDeps {
  daemonInstanceId?: string
  startBrowser?: typeof startOwnedBrowser
  /** Additional singleton-lock exit confirmation; injectable for tests. */
  retirementBoundMs?: number
}

export class ManagedLaunchError extends Error {
  constructor(
    readonly reasonCode: BrowserReasonCode,
    message: string,
  ) {
    super(message)
    this.name = 'ManagedLaunchError'
  }
}

export interface ManagedBrowserHandle {
  context: BrowserContext
  launchNonce: string
  slotDir: string
  profileDir: string
  close(): Promise<void>
}

/** Missing/dead is safe; permission errors are not evidence of absence. */
function lockMayBeHeld(profileDir: string): boolean {
  const pid = readSingletonLockPid(profileDir)
  return pid !== null && probeProcessPresence(pid) !== 'absent'
}

export async function launchManagedBrowser(
  input: ManagedLaunchInput,
): Promise<ManagedBrowserHandle> {
  const deps = input.deps ?? {}
  const daemonInstanceId = deps.daemonInstanceId ?? getDaemonInstanceId()
  if (!daemonInstanceId) {
    throw new ManagedLaunchError('browser_start_failed', 'daemon instance identity is unavailable')
  }
  const claim = claimBrowserProfile(
    input.paths,
    { agentId: input.agentId, teamId: input.teamId },
    deps,
  )
  if (claim.state !== 'ready') {
    throw new ManagedLaunchError(
      'browser_recovery_required',
      'browser profile ownership is not proven clean',
    )
  }
  if (claim.staleOwner) clearOwnerMarker(claim.dir)
  const slotDir = claim.dir
  const profileDir = browserUserDataDir(slotDir)
  if (lockMayBeHeld(profileDir)) {
    throw new ManagedLaunchError(
      'browser_recovery_required',
      'another browser may hold this profile lock',
    )
  }
  const launchNonce = randomUUID()
  const marker: BrowserOwnerMarker = {
    formatVersion: BROWSER_PROFILE_FORMAT_VERSION,
    agentId: input.agentId,
    teamId: input.teamId,
    launchNonce,
    daemonInstanceId,
    phase: 'starting',
    startedAt: Date.now(),
  }
  writeOwnerMarker(slotDir, marker)
  let owned: OwnedBrowserProcess
  try {
    owned = await (deps.startBrowser ?? startOwnedBrowser)(
      {
        executablePath: input.executablePath,
        profileDir,
        home: join(slotDir, 'home'),
        headless: input.headless,
        proxyUrl: input.proxyUrl,
        display: input.display,
        xauthority: input.xauthority,
        waylandDisplay: input.waylandDisplay,
        xdgRuntimeDir: input.xdgRuntimeDir,
      },
      (pid) => {
        marker.pid = pid
        marker.processGroupId = pid
        writeOwnerMarker(slotDir, marker)
      },
    )
  } catch (error) {
    if (
      (error instanceof BrowserProcessError && error.reasonCode === 'browser_recovery_required') ||
      lockMayBeHeld(profileDir)
    ) {
      throw new ManagedLaunchError(
        'browser_recovery_required',
        'browser cleanup is uncertain; ownership marker retained',
      )
    }
    clearOwnerMarker(slotDir)
    throw new ManagedLaunchError(
      error instanceof BrowserProcessError ? error.reasonCode : 'browser_start_failed',
      'local browser startup failed',
    )
  }
  try {
    marker.phase = 'running'
    writeOwnerMarker(slotDir, marker)
  } catch {
    try {
      await owned.close()
      clearOwnerMarker(slotDir)
    } catch {
      throw new ManagedLaunchError(
        'browser_recovery_required',
        'browser ownership publication failed and cleanup is uncertain',
      )
    }
    throw new ManagedLaunchError('browser_start_failed', 'browser ownership publication failed')
  }
  let closing: Promise<void> | undefined
  return {
    context: owned.context,
    launchNonce,
    slotDir,
    profileDir,
    close() {
      closing ??= (async () => {
        marker.phase = 'stopping'
        // Even a metadata write failure must not strand the owned process.
        let markerError: unknown
        try {
          writeOwnerMarker(slotDir, marker)
        } catch (error) {
          markerError = error
        }
        let retirementStep: 'process' | 'profile-lock' | 'marker' = 'process'
        try {
          await owned.close()
          retirementStep = 'profile-lock'
          const deadline = Date.now() + (deps.retirementBoundMs ?? 500)
          while (lockMayBeHeld(profileDir) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          if (lockMayBeHeld(profileDir)) throw new Error('profile retirement is uncertain')
          retirementStep = 'marker'
          if (markerError) throw new Error('owner marker publication is uncertain')
          clearOwnerMarker(slotDir)
        } catch {
          throw new ManagedLaunchError(
            'browser_recovery_required',
            `browser retirement could not be proven (${retirementStep}); ownership marker retained`,
          )
        }
      })()
      return closing
    },
  }
}
