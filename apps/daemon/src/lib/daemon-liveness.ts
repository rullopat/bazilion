import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  futimesSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
  writeSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Paths } from '../core/index.ts'

export const DAEMON_LIVENESS_FILENAME = 'daemon-runtime.json'
const HEARTBEAT_MS = 2_000

interface DaemonLivenessRecord {
  version: 1
  instanceId: string
  pid: number
  owner: 'daemon'
  state: 'starting' | 'listening'
  host?: string
  port?: number
  startedAt: number
}

interface ExistingOwnershipRecord {
  raw: string
  stat: Stats
  version?: 1
  instanceId?: string
  pid?: number
  owner?: 'daemon' | 'restore'
  state?:
    | 'starting'
    | 'listening'
    | 'restoring'
    | 'uninstalling'
    | 'swapping'
    | 'installed'
    | 'recovery-required'
  recoveryPath?: string
  hadPrevious?: boolean
  host?: string
  port?: number
  startedAt?: number
}

export interface DaemonLivenessHandle {
  readonly instanceId: string
  readonly path: string
  publishEndpoint(endpoint: { host: string; port: number }): void
  stop(): void
}

function canonicalHomeIdentity(home: string): string {
  const absolute = resolve(home)
  try {
    return realpathSync.native(absolute)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    const parent = dirname(absolute)
    if (parent === absolute) throw error
    return join(canonicalHomeIdentity(parent), basename(absolute))
  }
}

/** Stable sibling: replacing the home directory during restore cannot drop it. */
export function daemonLivenessPath(home: string): string {
  const canonicalHome = canonicalHomeIdentity(home)
  const identity = createHash('sha256').update(canonicalHome).digest('hex').slice(0, 24)
  return join(dirname(canonicalHome), `.bazilion-runtime-${identity}.json`)
}

let activeInstanceId: string | null = null

/** Opaque identity exposed by /api/health for local ownership probes. */
export function getDaemonInstanceId(): string | null {
  return activeInstanceId
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function readExisting(path: string): ExistingOwnershipRecord | null {
  try {
    const stat = lstatSync(path)
    const raw = stat.isFile() ? readFileSync(path, 'utf8') : ''
    let instanceId: string | undefined
    let version: 1 | undefined
    let pid: number | undefined
    let owner: 'daemon' | 'restore' | undefined
    let state: ExistingOwnershipRecord['state']
    let recoveryPath: string | undefined
    let hadPrevious: boolean | undefined
    let host: string | undefined
    let port: number | undefined
    let startedAt: number | undefined
    try {
      const parsed = JSON.parse(raw) as {
        version?: unknown
        instanceId?: unknown
        pid?: unknown
        owner?: unknown
        state?: unknown
        recoveryPath?: unknown
        hadPrevious?: unknown
        host?: unknown
        port?: unknown
        startedAt?: unknown
      }
      if (parsed.version === 1) version = 1
      if (typeof parsed.instanceId === 'string' && parsed.instanceId) {
        instanceId = parsed.instanceId
      }
      if (Number.isSafeInteger(parsed.pid) && (parsed.pid as number) > 0) {
        pid = parsed.pid as number
      }
      if (parsed.owner === 'daemon' || parsed.owner === 'restore') owner = parsed.owner
      if (
        typeof parsed.state === 'string' &&
        [
          'starting',
          'listening',
          'restoring',
          'uninstalling',
          'swapping',
          'installed',
          'recovery-required',
        ].includes(parsed.state)
      ) {
        state = parsed.state as ExistingOwnershipRecord['state']
      }
      if (typeof parsed.recoveryPath === 'string' && parsed.recoveryPath) {
        recoveryPath = parsed.recoveryPath
      }
      if (typeof parsed.hadPrevious === 'boolean') hadPrevious = parsed.hadPrevious
      if (typeof parsed.host === 'string' && parsed.host) host = parsed.host
      if (
        Number.isSafeInteger(parsed.port) &&
        (parsed.port as number) > 0 &&
        (parsed.port as number) <= 65_535
      ) {
        port = parsed.port as number
      }
      if (typeof parsed.startedAt === 'number' && Number.isFinite(parsed.startedAt)) {
        startedAt = parsed.startedAt
      }

      const validOwnerState =
        (owner === 'daemon' &&
          state !== undefined &&
          ['starting', 'listening'].includes(state) &&
          (state !== 'listening' || (host !== undefined && port !== undefined))) ||
        (owner === 'restore' &&
          state !== undefined &&
          ['restoring', 'uninstalling', 'swapping', 'installed', 'recovery-required'].includes(
            state,
          ) &&
          (!['swapping', 'recovery-required'].includes(state) ||
            (recoveryPath !== undefined && hadPrevious !== undefined)))
      if (!validOwnerState) {
        owner = undefined
        state = undefined
      }
    } catch {
      // A recent partial/invalid record is treated as an active startup below.
    }
    return {
      raw,
      stat,
      version,
      instanceId,
      pid,
      owner,
      state,
      recoveryPath,
      hadPrevious,
      host,
      port,
      startedAt,
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM proves that the process exists even though we may not signal it.
    return errorCode(error) !== 'ESRCH'
  }
}

function reclaimStaleRecord(
  path: string,
  existing: NonNullable<ReturnType<typeof readExisting>>,
): string | null {
  const identity = createHash('sha256')
    .update(existing.instanceId ?? existing.raw)
    .update(`\0${existing.stat.dev}\0${existing.stat.ino}`)
    .digest('hex')
    .slice(0, 24)
  const claim = `${path}.reclaim-${identity}`

  // The claim directory is a persistent compare-and-swap tombstone. If two
  // daemons race to reclaim the same stale record, only one can create it;
  // the loser can never rename a newly-acquired owner's record out of place.
  try {
    mkdirSync(claim, { mode: 0o700 })
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return null
    throw error
  }

  try {
    const current = readExisting(path)
    if (!current || !sameFile(current.stat, existing.stat) || current.raw !== existing.raw) {
      return null
    }
    renameSync(path, join(claim, 'stale-record.json'))
    return claim
  } catch (error) {
    if (!['ENOENT', 'EEXIST'].includes(errorCode(error) ?? '')) throw error
    return null
  }
}

function writeRecord(fd: number, record: DaemonLivenessRecord): void {
  const body = `${JSON.stringify(record, null, 2)}\n`
  ftruncateSync(fd, 0)
  writeSync(fd, body, 0, 'utf8')
  fsyncSync(fd)
}

function fsyncParentDirectory(path: string): void {
  let directoryFd: number | null = null
  try {
    directoryFd = openSync(dirname(path), 'r')
    fsyncSync(directoryFd)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  } finally {
    if (directoryFd !== null) closeSync(directoryFd)
  }
}

/**
 * Acquire this home before SQLite is opened. The `wx` record is held open for
 * the process lifetime, and heartbeat updates touch that inode rather than
 * replacing it. A resumed process whose stale record was reclaimed notices
 * the inode mismatch and exits instead of continuing as a second DB owner.
 */
export function acquireDaemonLiveness(paths: Paths): DaemonLivenessHandle {
  mkdirSync(dirname(resolve(paths.home)), { recursive: true })
  const path = daemonLivenessPath(paths.home)
  mkdirSync(dirname(path), { recursive: true })
  const instanceId = randomUUID()
  const startedAt = Date.now()
  let fd: number | null = null
  let reclaimClaim: string | null = null

  for (let attempt = 0; attempt < 8 && fd === null; attempt++) {
    try {
      fd = openSync(path, 'wx', 0o600)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const existing = readExisting(path)
      if (!existing) continue
      if (
        !existing.instanceId ||
        existing.version !== 1 ||
        existing.pid === undefined ||
        !existing.owner ||
        !existing.state ||
        existing.startedAt === undefined
      ) {
        throw new Error(
          `the daemon ownership record at ${path} is invalid; verify no daemon is running ` +
            'before removing it manually',
        )
      }
      const livePid = pidIsAlive(existing.pid)
      if (existing.owner === 'restore' && existing.state === 'uninstalling') {
        if (livePid) {
          throw new Error(
            `uninstall process ${existing.pid} is modifying this home; wait for it to finish`,
          )
        }
        throw new Error(
          'a previous Bazilion uninstall was interrupted for this home. ' +
            'Re-run the same `bazilion uninstall` command (including its `--all` choice) ' +
            'with the same BAZILION_HOME (or --home) ' +
            'to finish it before starting Bazilion again.',
        )
      }
      if (
        existing.owner === 'restore' &&
        ['swapping', 'recovery-required'].includes(existing.state)
      ) {
        if (livePid) {
          throw new Error(
            `restore process ${existing.pid} is ${existing.state} this home; wait for it to finish`,
          )
        }
        const recovery = existing.recoveryPath
          ? ` Recovery data is at ${existing.recoveryPath}.`
          : ''
        throw new Error(
          `restore recovery is required before this home can start.${recovery} ` +
            `Recover the previous home, then remove ${path} manually.`,
        )
      }
      if (livePid) {
        const owner = ` ${existing.owner} process ${existing.pid} (instance ${existing.instanceId})`
        throw new Error(
          `another Bazilion daemon owns this home${owner}; stop it before starting another`,
        )
      }
      const claim = reclaimStaleRecord(path, existing)
      if (claim) reclaimClaim = claim
    }
  }

  if (fd === null) {
    throw new Error('could not acquire daemon ownership after reclaiming a stale record')
  }

  const ownedStat = fstatSync(fd)
  const record: DaemonLivenessRecord = {
    version: 1,
    instanceId,
    pid: process.pid,
    owner: 'daemon',
    state: 'starting',
    startedAt,
  }
  try {
    writeRecord(fd, record)
    fsyncParentDirectory(path)
    if (reclaimClaim) rmSync(reclaimClaim, { recursive: true, force: true })
    try {
      chmodSync(path, 0o600)
    } catch {
      // Windows: chmod may be a no-op.
    }
  } catch (error) {
    closeSync(fd)
    fd = null
    try {
      if (sameFile(lstatSync(path), ownedStat)) rmSync(path, { force: true })
    } catch {
      // Best effort: a dead-PID/invalid record still fails closed.
    }
    throw error
  }
  activeInstanceId = instanceId
  let stopped = false

  const stillOwnsPath = (): boolean => {
    try {
      return sameFile(lstatSync(path), ownedStat)
    } catch {
      return false
    }
  }

  const heartbeat = setInterval(() => {
    if (stopped) return
    if (!stillOwnsPath()) {
      console.error('daemon ownership was lost; exiting to protect the Bazilion database')
      process.exit(1)
    }
    try {
      const now = new Date()
      futimesSync(fd as number, now, now)
    } catch (error) {
      console.error(
        'daemon ownership heartbeat failed:',
        error instanceof Error ? error.message : error,
      )
      process.exit(1)
    }
  }, HEARTBEAT_MS)
  heartbeat.unref()

  return {
    instanceId,
    path,
    publishEndpoint(endpoint) {
      if (stopped || !stillOwnsPath()) {
        throw new Error('daemon ownership was lost before the HTTP endpoint was published')
      }
      record.state = 'listening'
      record.host = endpoint.host
      record.port = endpoint.port
      writeRecord(fd as number, record)
    },
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(heartbeat)
      if (activeInstanceId === instanceId) activeInstanceId = null
      const ownsPath = stillOwnsPath()
      closeSync(fd as number)
      fd = null
      if (ownsPath) rmSync(path, { force: true })
    },
  }
}
