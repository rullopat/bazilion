// Managed browser profile ownership and restart safety (BAZ-069 D1/T03).
//
// A browser profile lives at `<home>/browsers/<agentId>` — owner-only (0700),
// outside both Agent inputs and Team workspaces. It contains live site cookies
// and session state, so it is never mounted, logged or backed up.
//
// Ownership has two layers:
//   - `profile.json` (0600): the stable identity — format version, Agent id and
//     Team id. Written once when the slot is claimed. It is the crash-safety
//     check that stops a profile from being reused in a different Team.
//   - `owner.json` (0600): a bounded active-launch marker, written before spawn
//     and removed only after owned process exit is established. It carries a
//     launch nonce, the daemon instance id, a phase and — when known — the owned
//     child/process-group id. It never contains page URLs, cookies or debugging
//     credentials.
//
// Live ownership is `resources().browsers`; this marker is restart *evidence*,
// not a second registry. After a daemon crash we never attach to or kill a
// process because a file contains a PID: an active/unknown/malformed marker
// yields `recovery_required` and refuses launch, deletion and unlock. A stale
// marker is reclaimed only when the owned process is positively absent.
//
// There is no general-purpose lock framework here. Concurrent claims are
// serialized by an exclusive `wx` create of `profile.json`.

import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import type { BrowserReasonCode } from '@bazilion/api-types'
import type { Paths } from '../../core/index.ts'
import { getDaemonInstanceId } from '../daemon-liveness.ts'
import { getDarwinProcessInspector } from '../process/darwin.ts'

export const BROWSER_PROFILE_FORMAT_VERSION = 1 as const
export const PROFILE_IDENTITY_FILENAME = 'profile.json'
export const OWNER_MARKER_FILENAME = 'owner.json'
export const BROWSER_USER_DATA_DIRNAME = 'user-data'
/** Bounded metadata: identity and owner markers are tiny and never grow. */
export const MAX_BROWSER_METADATA_BYTES = 4096

export interface BrowserProfileIdentity {
  formatVersion: typeof BROWSER_PROFILE_FORMAT_VERSION
  agentId: string
  teamId: string
}

export type BrowserOwnerPhase = 'starting' | 'running' | 'stopping'

export interface BrowserOwnerMarker {
  formatVersion: typeof BROWSER_PROFILE_FORMAT_VERSION
  agentId: string
  teamId: string
  /** Random per-launch token, so a stale marker can be distinguished. */
  launchNonce: string
  /** The daemon process that owns the slot. */
  daemonInstanceId: string
  phase: BrowserOwnerPhase
  startedAt: number
  /** Owned child pid, once spawned. */
  pid?: number
  /** Owned child process-group id, once spawned. */
  processGroupId?: number
}

export type ProcessPresence = 'alive' | 'absent' | 'unknown'

export interface BrowserProfileDeps {
  /** Daemon instance id; defaults to the process-lifetime ownership identity. */
  daemonInstanceId?: string
  /** Overridable for deterministic tests; defaults to the real probe. */
  probeProcess?: (id: number) => ProcessPresence
  probeProcessGroup?: (id: number) => ProcessPresence
}

/**
 * Probe one id without signalling it. `unknown` covers EPERM and any other
 * error that does not prove absence — PID reuse and permission errors must
 * never be read as "safe to reclaim".
 */
export function probeProcessPresence(id: number): ProcessPresence {
  if (!Number.isSafeInteger(id) || id <= 0) return 'unknown'
  try {
    process.kill(id, 0)
    return 'alive'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown'
  }
}

/** A group is not its leader PID: surviving descendants must block recovery. */
export function probeProcessGroupPresence(id: number): ProcessPresence {
  if (!Number.isSafeInteger(id) || id <= 0) return 'unknown'
  if (process.platform === 'darwin') {
    try {
      return getDarwinProcessInspector().group(id).length ? 'alive' : 'absent'
    } catch {
      return 'unknown'
    }
  }
  try {
    process.kill(-id, 0)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown'
  }
  if (process.platform !== 'linux') return 'alive'
  try {
    for (const entry of readdirSync('/proc').filter((entry) => /^\d+$/.test(entry))) {
      let stat: string
      try {
        stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
      } catch (error) {
        if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
        return 'unknown'
      }
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      // Exited zombies cannot hold a profile or network capability.
      if (Number(fields[2]) === id && fields[0] !== 'Z' && fields[0] !== 'X') return 'alive'
    }
    return 'absent'
  } catch {
    return 'unknown'
  }
}

export type BrowserProfileState = 'absent' | 'ready' | 'recovery_required'

export interface BrowserProfileAssessment {
  agentId: string
  /** Canonical slot path (never returned over the wire). */
  dir: string
  /** A directory exists at the slot. */
  present: boolean
  state: BrowserProfileState
  identity?: BrowserProfileIdentity
  /** Marker found on disk, when well-formed. */
  owner?: BrowserOwnerMarker
  /** A marker exists but its owned process is positively absent. */
  staleOwner: boolean
  reasonCode?: BrowserReasonCode
  /** Bounded internal detail — never contains secrets or raw stderr. */
  detail?: string
}

export class BrowserProfileError extends Error {
  readonly reasonCode: BrowserReasonCode
  constructor(reasonCode: BrowserReasonCode, message: string) {
    super(message)
    this.name = 'BrowserProfileError'
    this.reasonCode = reasonCode
  }
}

function recovery(detail: string): BrowserProfileError {
  return new BrowserProfileError('browser_recovery_required', detail)
}

/** Reject anything that could escape the per-Agent slot via path separators. */
function assertSafeAgentId(agentId: string): void {
  if (!agentId || agentId === '.' || agentId === '..' || /[/\\\0]/.test(agentId)) {
    throw new BrowserProfileError('browser_start_failed', 'invalid canonical Agent id')
  }
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function chmodBestEffort(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch {
    // Windows: chmod is a no-op; the caller's platform gating covers this.
  }
}

/**
 * Create/validate the canonical slot. Owner-only (0700), no followed symlinks,
 * idempotent. Refuses if the browsers root or the slot itself is a symlink or a
 * non-directory (ancestor substitution).
 */
export function ensureBrowserSlot(paths: Paths, agentId: string): string {
  assertSafeAgentId(agentId)
  const root = paths.browsersDir
  if (exists(root) && isSymlink(root)) {
    throw recovery(`browser root ${root} is a symlink`)
  }
  mkdirSync(root, { recursive: true, mode: 0o700 })
  if (!isDirectory(root)) throw recovery(`browser root ${root} is not a directory`)
  chmodBestEffort(root, 0o700)

  const dir = paths.browserDir(agentId)
  if (exists(dir)) {
    if (isSymlink(dir)) throw recovery(`browser slot ${dir} is a symlink`)
    if (!isDirectory(dir)) throw recovery(`browser slot ${dir} is not a directory`)
  } else {
    mkdirSync(dir, { mode: 0o700 })
  }
  chmodBestEffort(dir, 0o700)
  return dir
}

export function browserUserDataDir(slotDir: string): string {
  return join(slotDir, BROWSER_USER_DATA_DIRNAME)
}

/**
 * Read (never delete) Chromium's singleton lock, whose symlink target names
 * the live profile owner as `<hostname>-<pid>`. This is the launch/close and
 * crash-recovery evidence D1 names: a lock naming a live pid means a browser
 * still holds the profile; a stale lock (dead pid) is left for Chromium to
 * replace on the next launch. Returns null when no lock exists or it does not
 * name a pid.
 */
export function readSingletonLockPid(profileDir: string): number | null {
  try {
    const target = readlinkSync(join(profileDir, 'SingletonLock'))
    const match = /-(\d+)$/.exec(target)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

function readBoundedFile(path: string): string | { error: string } {
  let fd: number | null = null
  try {
    if (isSymlink(path)) return { error: `${path} is a symlink` }
    fd = openSync(path, 'r')
    const stat = fstatSync(fd)
    if (!stat.isFile()) return { error: `${path} is not a regular file` }
    if (stat.size > MAX_BROWSER_METADATA_BYTES) return { error: `${path} exceeds metadata bound` }
    const buf = Buffer.alloc(Math.max(stat.size, 1))
    const read = stat.size > 0 ? readSync(fd, buf, 0, stat.size, 0) : 0
    return buf.subarray(0, read).toString('utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { error: 'ENOENT' }
    return { error: `unreadable (${code ?? 'error'})` }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Atomic bounded write: temp file in the same directory, fsync, rename. */
function writeAtomicBounded(path: string, value: unknown, mode = 0o600): void {
  const body = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(body, 'utf8') > MAX_BROWSER_METADATA_BYTES) {
    throw new BrowserProfileError('browser_start_failed', 'browser metadata exceeds bound')
  }
  const tmp = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
  let fd: number | null = null
  try {
    fd = openSync(tmp, 'wx', mode)
    ftruncateSync(fd, 0)
    writeSync(fd, body, 0, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(tmp, path)
  } catch (error) {
    if (fd !== null) closeSync(fd)
    try {
      unlinkSync(tmp)
    } catch {
      // best effort
    }
    throw error
  }
}

function parseIdentity(raw: string): BrowserProfileIdentity | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'profile.json is not valid JSON' }
  }
  if (!parsed || typeof parsed !== 'object') return { error: 'profile.json is not an object' }
  const p = parsed as Record<string, unknown>
  if (p.formatVersion !== BROWSER_PROFILE_FORMAT_VERSION) {
    return { error: 'profile.json has an unsupported format version' }
  }
  if (typeof p.agentId !== 'string' || !p.agentId) return { error: 'profile.json lacks agentId' }
  if (typeof p.teamId !== 'string' || !p.teamId) return { error: 'profile.json lacks teamId' }
  return {
    formatVersion: BROWSER_PROFILE_FORMAT_VERSION,
    agentId: p.agentId,
    teamId: p.teamId,
  }
}

function parseOwnerMarker(raw: string): BrowserOwnerMarker | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'owner.json is not valid JSON' }
  }
  if (!parsed || typeof parsed !== 'object') return { error: 'owner.json is not an object' }
  const p = parsed as Record<string, unknown>
  if (p.formatVersion !== BROWSER_PROFILE_FORMAT_VERSION) {
    return { error: 'owner.json has an unsupported format version' }
  }
  if (typeof p.agentId !== 'string' || !p.agentId) return { error: 'owner.json lacks agentId' }
  if (typeof p.teamId !== 'string' || !p.teamId) return { error: 'owner.json lacks teamId' }
  if (typeof p.launchNonce !== 'string' || !p.launchNonce) {
    return { error: 'owner.json lacks launchNonce' }
  }
  if (typeof p.daemonInstanceId !== 'string' || !p.daemonInstanceId) {
    return { error: 'owner.json lacks daemonInstanceId' }
  }
  if (p.phase !== 'starting' && p.phase !== 'running' && p.phase !== 'stopping') {
    return { error: 'owner.json has an invalid phase' }
  }
  if (typeof p.startedAt !== 'number' || !Number.isFinite(p.startedAt)) {
    return { error: 'owner.json lacks startedAt' }
  }
  if (p.pid !== undefined && (!Number.isSafeInteger(p.pid) || (p.pid as number) <= 0)) {
    return { error: 'owner.json has an invalid pid' }
  }
  if (
    p.processGroupId !== undefined &&
    (!Number.isSafeInteger(p.processGroupId) || (p.processGroupId as number) <= 0)
  ) {
    return { error: 'owner.json has an invalid processGroupId' }
  }
  return {
    formatVersion: BROWSER_PROFILE_FORMAT_VERSION,
    agentId: p.agentId,
    teamId: p.teamId,
    launchNonce: p.launchNonce,
    daemonInstanceId: p.daemonInstanceId,
    phase: p.phase,
    startedAt: p.startedAt,
    ...(p.pid !== undefined ? { pid: p.pid as number } : {}),
    ...(p.processGroupId !== undefined ? { processGroupId: p.processGroupId as number } : {}),
  }
}

export function readProfileIdentity(
  dir: string,
): BrowserProfileIdentity | { error: string } | null {
  const raw = readBoundedFile(join(dir, PROFILE_IDENTITY_FILENAME))
  if (typeof raw !== 'string') return raw.error === 'ENOENT' ? null : { error: raw.error }
  return parseIdentity(raw)
}

export function readOwnerMarker(dir: string): BrowserOwnerMarker | { error: string } | null {
  const raw = readBoundedFile(join(dir, OWNER_MARKER_FILENAME))
  if (typeof raw !== 'string') return raw.error === 'ENOENT' ? null : { error: raw.error }
  return parseOwnerMarker(raw)
}

function slotIsEmpty(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0
  } catch {
    return false
  }
}

/**
 * Claim the canonical slot for `agentId`/`teamId`, creating the identity on
 * first use. Concurrent claims of the *same* identity both succeed; a claim
 * that conflicts with an existing identity fails. Returns the assessment so
 * callers can refuse a recovery-required slot before launching.
 */
export function claimBrowserProfile(
  paths: Paths,
  input: { agentId: string; teamId: string },
  deps: BrowserProfileDeps = {},
): BrowserProfileAssessment {
  assertSafeAgentId(input.agentId)
  const dir = ensureBrowserSlot(paths, input.agentId)
  const existing = readProfileIdentity(dir)
  if (existing && 'error' in existing) {
    throw recovery(`cannot claim browser profile: ${existing.error}`)
  }
  if (existing) {
    if (existing.agentId !== input.agentId || existing.teamId !== input.teamId) {
      throw recovery(
        `browser profile belongs to agent ${existing.agentId}/team ${existing.teamId}, ` +
          `not ${input.agentId}/${input.teamId}`,
      )
    }
    return assessBrowserProfile(paths, input, deps)
  }

  const identity: BrowserProfileIdentity = {
    formatVersion: BROWSER_PROFILE_FORMAT_VERSION,
    agentId: input.agentId,
    teamId: input.teamId,
  }
  const path = join(dir, PROFILE_IDENTITY_FILENAME)
  try {
    writeAtomicBoundedExclusive(path, identity)
  } catch (error) {
    // Lost the exclusive create race: the winner wrote an identity. Re-read and
    // compare rather than assuming ours is authoritative.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const winner = readProfileIdentity(dir)
      if (winner && 'error' in winner)
        throw recovery(`cannot claim browser profile: ${winner.error}`)
      if (!winner || winner.agentId !== input.agentId || winner.teamId !== input.teamId) {
        throw recovery('browser profile was concurrently claimed with a different identity')
      }
    } else {
      throw error
    }
  }
  return assessBrowserProfile(paths, input, deps)
}

// Exclusive create that is safe under concurrency: the temp file is fully
// written and fsynced first, then `linkSync` publishes it atomically. A
// concurrent claimant either wins the link or sees EEXIST with a complete
// file — never an empty half-created one.
function writeAtomicBoundedExclusive(path: string, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(body, 'utf8') > MAX_BROWSER_METADATA_BYTES) {
    throw new BrowserProfileError('browser_start_failed', 'browser metadata exceeds bound')
  }
  const tmp = `${path}.claim-${process.pid}-${randomUUID().slice(0, 8)}`
  let fd: number | null = null
  try {
    fd = openSync(tmp, 'wx', 0o600)
    ftruncateSync(fd, 0)
    writeSync(fd, body, 0, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    linkSync(tmp, path)
  } finally {
    if (fd !== null) closeSync(fd)
    try {
      unlinkSync(tmp)
    } catch {
      // best effort
    }
  }
}

/** Atomically replace the active-launch marker. Persist before spawn. */
export function writeOwnerMarker(dir: string, marker: BrowserOwnerMarker): void {
  writeAtomicBounded(join(dir, OWNER_MARKER_FILENAME), marker)
}

/** Remove the active marker after owned process/group exit is established. */
export function clearOwnerMarker(dir: string): void {
  try {
    unlinkSync(join(dir, OWNER_MARKER_FILENAME))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function ownedProcessPresence(
  marker: BrowserOwnerMarker,
  probe: (id: number) => ProcessPresence,
  probeGroup: (id: number) => ProcessPresence,
): ProcessPresence {
  const presences = [
    ...(marker.pid === undefined ? [] : [probe(marker.pid)]),
    ...(marker.processGroupId === undefined ? [] : [probeGroup(marker.processGroupId)]),
  ]
  if (presences.length === 0) return 'unknown'
  let sawUnknown = false
  for (const presence of presences) {
    if (presence === 'alive') return 'alive'
    if (presence === 'unknown') sawUnknown = true
  }
  return sawUnknown ? 'unknown' : 'absent'
}

/**
 * Reconcile on-disk evidence for the slot without launching or deleting
 * anything. The result is authoritative for admission and reset.
 */
export function assessBrowserProfile(
  paths: Paths,
  input: { agentId: string; teamId: string },
  deps: BrowserProfileDeps = {},
): BrowserProfileAssessment {
  const daemonInstanceId = deps.daemonInstanceId ?? getDaemonInstanceId() ?? 'unknown'
  const probe = deps.probeProcess ?? probeProcessPresence
  assertSafeAgentId(input.agentId)
  const dir = paths.browserDir(input.agentId)
  const base: BrowserProfileAssessment = {
    agentId: input.agentId,
    dir,
    present: false,
    state: 'absent',
    staleOwner: false,
  }
  if (!exists(dir)) return base
  if (isSymlink(dir) || !isDirectory(dir)) {
    return {
      ...base,
      present: true,
      state: 'recovery_required',
      reasonCode: 'browser_recovery_required',
      detail: 'browser slot is a symlink or non-directory',
    }
  }

  const identity = readProfileIdentity(dir)
  if (identity && 'error' in identity) {
    return {
      ...base,
      present: true,
      state: 'recovery_required',
      reasonCode: 'browser_recovery_required',
      detail: identity.error,
    }
  }
  if (!identity) {
    // A directory that is not empty but has no identity is an interrupted
    // claim/deletion: ownership is unknown, so refuse rather than reuse.
    if (!slotIsEmpty(dir)) {
      return {
        ...base,
        present: true,
        state: 'recovery_required',
        reasonCode: 'browser_recovery_required',
        detail: 'browser slot has contents but no profile identity',
      }
    }
    return { ...base, present: true, state: 'ready' }
  }
  if (identity.agentId !== input.agentId || identity.teamId !== input.teamId) {
    return {
      ...base,
      present: true,
      state: 'recovery_required',
      identity,
      reasonCode: 'browser_recovery_required',
      detail: `browser profile Team mismatch (owned by ${identity.teamId})`,
    }
  }

  const owner = readOwnerMarker(dir)
  if (owner && 'error' in owner) {
    return {
      ...base,
      present: true,
      state: 'recovery_required',
      identity,
      reasonCode: 'browser_recovery_required',
      detail: owner.error,
    }
  }
  if (!owner) return { ...base, present: true, state: 'ready', identity }

  // A marker from another daemon instance is only recoverable when the owned
  // process/group is positively absent. Same-instance markers mean this process
  // already believes it owns the slot — if admission is being asked, the live
  // registry no longer has it, so it is a leak.
  if (owner.daemonInstanceId === daemonInstanceId) {
    return {
      ...base,
      present: true,
      state: 'recovery_required',
      identity,
      owner,
      reasonCode: 'browser_recovery_required',
      detail: 'active owner marker belongs to this daemon instance',
    }
  }
  const presence = ownedProcessPresence(
    owner,
    probe,
    deps.probeProcessGroup ?? probeProcessGroupPresence,
  )
  if (presence === 'alive') {
    return {
      ...base,
      present: true,
      state: 'recovery_required',
      identity,
      owner,
      reasonCode: 'browser_recovery_required',
      detail: 'a process owned by a previous launch is still present',
    }
  }
  if (presence === 'unknown') {
    return {
      ...base,
      present: true,
      state: 'recovery_required',
      identity,
      owner,
      reasonCode: 'browser_recovery_required',
      detail: 'cannot prove the previous owned process is absent',
    }
  }
  // Positively absent: the marker is stale evidence and may be cleared.
  return { ...base, present: true, state: 'ready', identity, owner, staleOwner: true }
}

/**
 * Remove the canonical slot. Refuses anything but a proven-clean or
 * proven-stale slot. Symlinks *inside* the profile (Chromium writes some) are
 * unlinked, never followed to an external target.
 */
export function removeBrowserProfile(
  paths: Paths,
  input: { agentId: string; teamId: string },
  deps: BrowserProfileDeps = {},
): void {
  const assessment = assessBrowserProfile(paths, input, deps)
  if (assessment.state === 'recovery_required') {
    throw recovery(
      `refusing to remove browser profile: ${assessment.detail ?? 'ownership is unknown'}`,
    )
  }
  if (assessment.state === 'absent') return
  if (assessment.staleOwner) clearOwnerMarker(assessment.dir)
  // `rmSync` recursive unlinks symlinks rather than following them.
  rmSync(assessment.dir, { recursive: true, force: false })
}

/**
 * Reset variant: only the current daemon's clean slot, or a positively-absent
 * stale slot, may be removed. This is the operator-triggered destructive path
 * used by `DELETE /api/agents/:id/browser/profile`.
 */
export function resetBrowserProfile(
  paths: Paths,
  input: { agentId: string; teamId: string },
  deps: BrowserProfileDeps = {},
): void {
  removeBrowserProfile(paths, input, deps)
}

/** Used only by tests/tools that need to prove no stale marker without removing state. */
export function readBrowserMarkerNonce(dir: string): string | null {
  const marker = readOwnerMarker(dir)
  return marker && !('error' in marker) ? marker.launchNonce : null
}
