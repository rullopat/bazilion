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

export const DAEMON_LIVENESS_FILENAME = 'daemon-runtime.json'
const STALE_AFTER_MS = 60_000
const PROBE_TIMEOUT_MS = 750

interface DaemonLivenessRecord {
  version: 1
  instanceId: string
  pid: number
  owner: 'daemon' | 'restore'
  state: 'starting' | 'listening' | 'restoring' | 'swapping' | 'installed' | 'recovery-required'
  host?: string
  port?: number
  startedAt: number
  recoveryPath?: string
  hadPrevious?: boolean
}

export interface HomeRestoreLock {
  readonly path: string
  markSwapping(recoveryPath: string, hadPrevious: boolean): void
  markInstalled(): void
  markRecoveryRequired(recoveryPath: string, hadPrevious: boolean): void
  release(): void
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

interface ExistingRecord {
  raw: string
  stat: Stats
  record: DaemonLivenessRecord | null
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function parseRecord(raw: string): DaemonLivenessRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<DaemonLivenessRecord>
    if (
      value.version !== 1 ||
      typeof value.instanceId !== 'string' ||
      !value.instanceId ||
      !Number.isSafeInteger(value.pid) ||
      (value.pid ?? 0) <= 0 ||
      !['daemon', 'restore'].includes(value.owner ?? '') ||
      ![
        'starting',
        'listening',
        'restoring',
        'swapping',
        'installed',
        'recovery-required',
      ].includes(value.state ?? '') ||
      !Number.isFinite(value.startedAt)
    ) {
      return null
    }
    if (
      (value.owner === 'daemon' && !['starting', 'listening'].includes(value.state ?? '')) ||
      (value.owner === 'restore' &&
        !['restoring', 'swapping', 'installed', 'recovery-required'].includes(value.state ?? ''))
    ) {
      return null
    }
    if (
      value.owner === 'restore' &&
      ['swapping', 'recovery-required'].includes(value.state ?? '') &&
      (typeof value.recoveryPath !== 'string' ||
        !value.recoveryPath ||
        typeof value.hadPrevious !== 'boolean')
    ) {
      return null
    }
    if (
      value.owner === 'daemon' &&
      value.state === 'listening' &&
      (typeof value.host !== 'string' ||
        !value.host ||
        !Number.isSafeInteger(value.port) ||
        (value.port ?? 0) < 1 ||
        (value.port ?? 0) > 65_535)
    ) {
      return null
    }
    return value as DaemonLivenessRecord
  } catch {
    return null
  }
}

function readRecord(path: string): ExistingRecord | null {
  try {
    const stat = lstatSync(path)
    const raw = stat.isFile() ? readFileSync(path, 'utf8') : ''
    return { raw, stat, record: stat.isFile() ? parseRecord(raw) : null }
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
    return errorCode(error) !== 'ESRCH'
  }
}

function endpointFor(record: DaemonLivenessRecord): string | null {
  if (record.state !== 'listening' || !record.host || !record.port) return null
  const normalized = record.host.toLowerCase()
  if (normalized === '0.0.0.0') return `http://127.0.0.1:${record.port}`
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') {
    return `http://[::1]:${record.port}`
  }
  if (normalized === 'localhost' || normalized === '127.0.0.1') {
    return `http://${normalized}:${record.port}`
  }
  if (normalized === '::1' || normalized === '[::1]') {
    return `http://[::1]:${record.port}`
  }
  // The record is local data, but avoid turning a restore into an arbitrary
  // network request when a daemon binds a specific LAN address. A fresh lease
  // and local PID are sufficient to block in that case.
  return null
}

async function endpointHasOwner(endpoint: string, instanceId: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(new URL('/api/health', endpoint), {
      signal: controller.signal,
    })
    return response.headers.get('x-bazilion-daemon-instance') === instanceId
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
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

function reclaimRecord(path: string, existing: ExistingRecord): string | null {
  const identity = createHash('sha256')
    .update(existing.record?.instanceId ?? existing.raw)
    .update(`\0${existing.stat.dev}\0${existing.stat.ino}`)
    .digest('hex')
    .slice(0, 24)
  const claim = `${path}.reclaim-${identity}`
  try {
    mkdirSync(claim, { mode: 0o700 })
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error
    return null
  }

  const current = readRecord(path)
  if (!current || !sameFile(current.stat, existing.stat) || current.raw !== existing.raw) {
    return null
  }
  try {
    renameSync(path, join(claim, 'stale-record.json'))
    return claim
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

/**
 * Acquire the same per-home primitive the daemon takes before opening SQLite.
 * The sibling record remains in place across a target-home rename, closing
 * the check-then-swap race for the entire validation/install/rollback window.
 */
export async function acquireHomeRestoreLock(home: string): Promise<HomeRestoreLock> {
  const targetHome = resolve(home)
  mkdirSync(dirname(targetHome), { recursive: true })
  const path = daemonLivenessPath(targetHome)
  mkdirSync(dirname(path), { recursive: true })
  const instanceId = randomUUID()
  let fd: number | null = null
  let reclaimClaim: string | null = null

  for (let attempt = 0; attempt < 8 && fd === null; attempt++) {
    try {
      fd = openSync(path, 'wx', 0o600)
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }

    const existing = readRecord(path)
    if (!existing) continue

    const endpoint = existing.record ? endpointFor(existing.record) : null
    if (
      endpoint &&
      existing.record &&
      (await endpointHasOwner(endpoint, existing.record.instanceId))
    ) {
      throw new Error(
        `bazilion daemon is running at ${endpoint} for ${targetHome} — stop it before restoring`,
      )
    }

    if (!existing.record) {
      throw new Error(
        `the daemon ownership record for ${targetHome} is invalid; verify no daemon is running ` +
          'before removing it manually',
      )
    }
    const livePid = pidIsAlive(existing.record.pid)
    if (
      existing.record.owner === 'restore' &&
      ['swapping', 'recovery-required'].includes(existing.record.state)
    ) {
      if (livePid) {
        throw new Error(
          `bazilion restore process ${existing.record.pid} is ${existing.record.state} ` +
            `${targetHome} — wait for it to finish`,
        )
      }
      const phase = existing.record.state.replace('-', ' ')
      throw new Error(
        `Bazilion restore ${phase} for ${targetHome}; recovery data is at ` +
          `${existing.record.recoveryPath}. Recover the previous home, then remove ${path} manually.`,
      )
    }
    if (livePid) {
      const ageMs = Math.max(0, Date.now() - existing.stat.mtimeMs)
      const staleDetail = ageMs > STALE_AFTER_MS ? ' (its heartbeat is stale)' : ''
      const owner = existing.record.owner === 'daemon' ? 'daemon' : 'restore'
      throw new Error(
        `bazilion ${owner} process ${existing.record.pid} owns ${targetHome}${staleDetail} — ` +
          `stop it before restoring`,
      )
    }

    const claim = reclaimRecord(path, existing)
    if (claim) {
      reclaimClaim = claim
      console.warn(`removed stale Bazilion daemon ownership record for ${targetHome}`)
    }
  }

  if (fd === null) {
    throw new Error(
      `could not safely acquire exclusive restore ownership for ${targetHome}; try again`,
    )
  }

  const ownedStat = fstatSync(fd)
  const record: DaemonLivenessRecord = {
    version: 1,
    instanceId,
    pid: process.pid,
    owner: 'restore',
    state: 'restoring',
    startedAt: Date.now(),
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
  let released = false

  const stillOwnsPath = (): boolean => {
    try {
      return sameFile(lstatSync(path), ownedStat)
    } catch {
      return false
    }
  }
  const heartbeat = setInterval(() => {
    if (released) return
    if (!stillOwnsPath()) {
      console.error('restore ownership was lost; exiting to protect the Bazilion database')
      process.exit(1)
    }
    try {
      const now = new Date()
      futimesSync(fd as number, now, now)
    } catch (error) {
      console.error(
        'restore ownership heartbeat failed:',
        error instanceof Error ? error.message : error,
      )
      process.exit(1)
    }
  }, 2_000)
  heartbeat.unref()

  return {
    path,
    markSwapping(recoveryPath, hadPrevious) {
      if (released || !stillOwnsPath()) throw new Error('restore ownership was lost')
      record.state = 'swapping'
      record.recoveryPath = resolve(recoveryPath)
      record.hadPrevious = hadPrevious
      writeRecord(fd as number, record)
      fsyncParentDirectory(path)
    },
    markInstalled() {
      if (released || !stillOwnsPath()) throw new Error('restore ownership was lost')
      record.state = 'installed'
      delete record.recoveryPath
      delete record.hadPrevious
      writeRecord(fd as number, record)
    },
    markRecoveryRequired(recoveryPath, hadPrevious) {
      if (released || !stillOwnsPath()) throw new Error('restore ownership was lost')
      record.state = 'recovery-required'
      record.recoveryPath = resolve(recoveryPath)
      record.hadPrevious = hadPrevious
      writeRecord(fd as number, record)
    },
    release() {
      if (released) return
      released = true
      clearInterval(heartbeat)
      const ownsPath = stillOwnsPath()
      const retainForRecovery = ['swapping', 'recovery-required'].includes(record.state)
      closeSync(fd as number)
      fd = null
      if (ownsPath && !retainForRecovery) rmSync(path, { force: true })
    },
  }
}
