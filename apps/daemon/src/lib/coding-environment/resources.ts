import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { type BazilionDb, inTx } from '../../core/db/client.ts'
import {
  type DockerContainerIdentity,
  terminateRecordedContainer,
} from '../../runtime/shell/docker.ts'
import {
  captureWorkerProcess,
  terminateWorkerProcess,
  type WorkerProcessIdentity,
} from '../../runtime/worker/process-identity.ts'
import { assertNativeDarwinView, type NativeDarwinView } from '../native-execution/darwin-view.ts'
import { assertNativeLinuxView, type NativeLinuxView } from '../native-execution/linux-view.ts'
import { getDarwinProcessInspector } from '../process/darwin.ts'
import { isOwnedDarwinJob, type OwnedDarwinJob } from '../process/darwin-domain.ts'
import { getLinuxPidfdCalls } from '../process/linux.ts'
import { isOwnedLinuxNamespace, type OwnedLinuxNamespace } from '../process/linux-domain.ts'
import { type LinuxNativeWorkerIdentity, OwnedLinuxNativeWorker } from '../process/linux-worker.ts'
import { type DarwinWorkerIdentity, OwnedDarwinWorker } from '../process/worker.ts'
import type { WorkspaceLease, WorkspaceWriter } from './workspace.ts'

export interface NativeCommandIdentity {
  readonly kind: 'native-command'
  readonly token: string
  readonly backend: 'linux-bwrap' | 'darwin-seatbelt'
  readonly definition: string
  readonly hostCommands: false
}
/** Daemon-private registration; serialized lookalikes cannot start or acknowledge a launch. */
export interface NativeResourceRegistration {
  readonly id: string
  readonly writerId: string
  readonly identity: NativeCommandIdentity
}
export type NativeCommandOwner = OwnedLinuxNamespace | OwnedDarwinJob
export type NativeCommandView = NativeLinuxView | NativeDarwinView
function assertNativeView(view: NativeCommandView): void {
  if (view.backend === 'linux-bwrap') assertNativeLinuxView(view)
  else assertNativeDarwinView(view)
}
const isNativeOwner = (value: unknown): value is NativeCommandOwner =>
  isOwnedLinuxNamespace(value) || isOwnedDarwinJob(value)
interface NativeSlot {
  registration: NativeResourceRegistration
  identityJson: string
  writerBinding: string
  phase: 'prepared' | 'spawning' | 'bound' | 'acknowledged'
  inputReleased: boolean
  view?: NativeCommandView
  owner?: NativeCommandOwner
  ownerReceipt?: NativeCommandOwner['receipt']
  acknowledgement?: Promise<void>
}
function isNativeIdentity(value: unknown): value is NativeCommandIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).length === 5 &&
    record.kind === 'native-command' &&
    record.hostCommands === false &&
    typeof record.token === 'string' &&
    /^[0-9a-f-]{36}$/.test(record.token) &&
    ['linux-bwrap', 'darwin-seatbelt'].includes(String(record.backend)) &&
    typeof record.definition === 'string' &&
    /^[a-f0-9]{64}$/.test(record.definition)
  )
}

interface LinuxWorkerSlot {
  readonly owner: OwnedLinuxNativeWorker
  readonly writerId: string
  readonly identityJson: string
  readonly writerBinding: string
  revoked: boolean
}
type Resource =
  | {
      kind: 'worker'
      identity:
        | WorkerProcessIdentity
        | DarwinWorkerIdentity
        | LinuxNativeWorkerIdentity
        | NativeCommandIdentity
    }
  | { kind: 'container'; identity: DockerContainerIdentity }
interface Row {
  id: string
  writer_id: string
  kind: Resource['kind']
  identity_json: string
  cleanup_confirmed: number
  creation_acknowledged: number
  recovery_mode?: 'owned' | 'restored'
}

interface NativeRow extends Row {
  writer_binding: string
  writer_state: 'active' | 'recovery'
  resources_json: string
}

interface ManagementCleanup {
  confirmedWorkersOnly: true
  record?: Pick<Row, 'id' | 'writer_id' | 'kind' | 'identity_json' | 'creation_acknowledged'>
}

export class WorkspaceResources {
  private readonly nativeWorkers = new Map<string, OwnedDarwinWorker>()
  private readonly linuxNativeWorkers = new Map<string, LinuxWorkerSlot>()
  private readonly linuxWorkerRetirements = new Map<string, Promise<boolean>>()
  private readonly nativeSlots = new Map<string, NativeSlot>()
  private readonly nativeRegistrations = new WeakSet<object>()
  private readonly boundNativeOwners = new WeakSet<object>()
  private readonly boundNativeViews = new WeakSet<object>()
  constructor(private readonly db: BazilionDb) {}

  assertWorkerReady(): void {
    if (process.platform === 'darwin') {
      if (this.nativeWorkers.size >= 256) throw new Error('Live worker ownership unavailable')
      getDarwinProcessInspector().assertReady()
    }
  }

  assertNativeWorkerReady(): void {
    this.assertWorkerReady()
    if (process.platform === 'linux') {
      if (this.linuxNativeWorkers.size >= 256) throw new Error('Live worker ownership unavailable')
      getLinuxPidfdCalls()
    }
  }

  private linuxWorker(id: string): LinuxWorkerSlot {
    const slot = this.linuxNativeWorkers.get(id)
    if (!slot || slot.revoked) throw new Error('Live native Linux worker ownership unavailable')
    const row = this.nativeRecord(id)
    let refs: unknown
    try {
      refs = JSON.parse(row?.resources_json ?? 'null')
    } catch {}
    if (
      row?.kind !== 'worker' ||
      row.writer_id !== slot.writerId ||
      row.identity_json !== slot.identityJson ||
      row.writer_binding !== slot.writerBinding ||
      row.recovery_mode !== 'owned' ||
      row.cleanup_confirmed !== 0 ||
      row.creation_acknowledged !== 0 ||
      !Array.isArray(refs) ||
      refs.filter((ref) => ref?.id === id).length !== 1 ||
      !refs.some((ref) => ref?.id === id && ref.kind === 'worker')
    ) {
      slot.revoked = true
      slot.owner.revoke()
      throw new Error('Live native Linux worker registration changed')
    }
    return slot
  }

  signalNativeWorker(id: string, signal: 'SIGTERM' | 'SIGKILL'): void {
    this.linuxWorker(id).owner.signal(signal)
  }

  beforeWorkerSignal(id: string): void {
    if (this.linuxNativeWorkers.has(id)) {
      this.linuxWorker(id).owner.beforeSignal()
      return
    }
    if (process.platform !== 'darwin') return
    const row = this.db.raw
      .query<Row, [string]>(`SELECT r.*, w.recovery_mode FROM workspace_resources r
        JOIN workspace_writers w ON w.id = r.writer_id WHERE r.id = ?`)
      .get(id)
    const owner = this.nativeWorkers.get(id)
    if (row?.kind !== 'worker' || row.recovery_mode !== 'owned' || !owner) return
    try {
      if (owner.matches(JSON.parse(row.identity_json))) owner.beforeSignal()
    } catch {
      // Invalid receipts do not grant descendant signalling authority.
    }
  }

  registerWorker(
    lease: WorkspaceLease,
    pid: number,
    hostCommands = false,
    child?: ChildProcess,
    nativeExecution = false,
  ): string {
    if (nativeExecution && process.platform === 'linux') {
      if (!child || hostCommands !== false || this.linuxNativeWorkers.size >= 256)
        throw new Error('Live native Linux worker ownership unavailable')
      const owner = new OwnedLinuxNativeWorker(pid, child, false)
      let id: string | undefined
      try {
        id = this.register(lease, { kind: 'worker', identity: owner.identity })
        const row = this.nativeRecord(id)
        if (!row) throw new Error('Live native Linux worker registration unavailable')
        this.linuxNativeWorkers.set(id, {
          owner,
          writerId: lease.writer.id,
          identityJson: row.identity_json,
          writerBinding: row.writer_binding,
          revoked: false,
        })
        return id
      } catch (error) {
        if (id === undefined) owner.discardBeforeInput()
        else {
          owner.revoke()
          this.linuxNativeWorkers.set(id, {
            owner,
            writerId: lease.writer.id,
            identityJson: JSON.stringify(owner.identity),
            writerBinding: 'unavailable',
            revoked: true,
          })
        }
        throw error
      }
    }
    if (process.platform === 'darwin') {
      if (!child || this.nativeWorkers.size >= 256)
        throw new Error('Live worker ownership unavailable')
      const owner = new OwnedDarwinWorker(pid, child, hostCommands)
      const id = this.register(lease, { kind: 'worker', identity: owner.identity })
      this.nativeWorkers.set(id, owner)
      return id
    }
    return this.register(lease, {
      kind: 'worker',
      identity: { ...captureWorkerProcess(pid), hostCommands },
    })
  }

  /** Persist the no-PID intent before invoking the native launcher. No schema/receipt recovery path. */
  registerNativeIntent(
    lease: WorkspaceLease,
    backend: NativeCommandIdentity['backend'],
    definition: string,
    view?: NativeCommandView,
  ): NativeResourceRegistration {
    if (
      this.nativeSlots.size >= 256 ||
      !['linux-bwrap', 'darwin-seatbelt'].includes(backend) ||
      !/^[a-f0-9]{64}$/.test(definition)
    )
      throw new Error('Native resource admission unavailable')
    if (view !== undefined) {
      assertNativeView(view)
      const writer = this.db.raw
        .query<{ root_path: string; root_identity: string }, [string]>(
          'SELECT root_path, root_identity FROM workspace_writers WHERE id = ?',
        )
        .get(lease.writer.id)
      if (
        !writer ||
        writer.root_path !== view.workspace ||
        writer.root_identity !== view.workspaceIdentity ||
        lease.writer.root !== view.workspace ||
        lease.writer.rootIdentity !== view.workspaceIdentity ||
        this.boundNativeViews.has(view) ||
        view.definition !== definition ||
        view.backend !== backend
      )
        throw new Error('Native view does not match resource definition')
    }
    const identity: NativeCommandIdentity = Object.freeze({
      kind: 'native-command',
      token: randomUUID(),
      backend,
      definition,
      hostCommands: false,
    })
    const id = this.register(lease, { kind: 'worker', identity })
    const registration = Object.freeze({ id, writerId: lease.writer.id, identity })
    const row = this.nativeRecord(id)
    if (!row) throw new Error('Native resource registration unavailable')
    this.nativeRegistrations.add(registration)
    if (view) this.boundNativeViews.add(view)
    this.nativeSlots.set(id, {
      registration,
      identityJson: JSON.stringify(identity),
      writerBinding: row.writer_binding,
      phase: 'prepared',
      inputReleased: false,
      ...(view ? { view } : {}),
    })
    return registration
  }

  private nativeRecord(id: string): NativeRow | null {
    return this.db.raw
      .query<
        NativeRow,
        [string]
      >(`SELECT r.*, w.recovery_mode, w.resources_json, w.state AS writer_state,
      json_array(w.id, w.team_id, w.root_path, w.root_identity, w.daemon_identity, w.kind, w.created_at) AS writer_binding
      FROM workspace_resources r JOIN workspace_writers w ON w.id = r.writer_id WHERE r.id = ?`)
      .get(id)
  }

  private nativeSlot(registration: NativeResourceRegistration): NativeSlot {
    const slot = this.nativeSlots.get(registration?.id)
    if (
      !registration ||
      !this.nativeRegistrations.has(registration) ||
      !slot ||
      slot.registration !== registration
    )
      throw new Error('Native resource registration unavailable')
    const row = this.nativeRecord(registration.id)
    if (
      row?.kind !== 'worker' ||
      row.writer_id !== registration.writerId ||
      row.identity_json !== slot.identityJson ||
      row.writer_binding !== slot.writerBinding ||
      row.cleanup_confirmed !== 0 ||
      row.recovery_mode !== 'owned' ||
      row.creation_acknowledged !== (slot.phase === 'acknowledged' ? 1 : 0)
    )
      throw new Error('Native resource registration changed')
    let references: unknown
    try {
      references = JSON.parse(row.resources_json)
    } catch {
      throw new Error('Native resource attachment changed')
    }
    if (
      !Array.isArray(references) ||
      references.filter((reference) => reference?.id === registration.id).length !== 1 ||
      !references.some(
        (reference) => reference?.id === registration.id && reference.kind === 'worker',
      )
    )
      throw new Error('Native resource attachment changed')
    if (slot.view) assertNativeView(slot.view)
    return slot
  }

  beginNativeSpawn(registration: NativeResourceRegistration): void {
    const slot = this.nativeSlot(registration)
    const writer = this.db.raw
      .query<{ state: string }, [string]>('SELECT state FROM workspace_writers WHERE id = ?')
      .get(registration.writerId)
    if (slot.phase !== 'prepared' || writer?.state !== 'active')
      throw new Error('Native launch already consumed or cancelled')
    slot.phase = 'spawning'
  }

  /** Only before the spawn fence: no executable creation was attempted, not guessed absence. */
  cancelNativeBeforeSpawn(registration: NativeResourceRegistration): void {
    const slot = this.nativeSlot(registration)
    if (slot.phase !== 'prepared') throw new Error('Native launch creation is uncertain')
    const result = this.db.raw.run(
      `UPDATE workspace_resources SET cleanup_confirmed = 1
      WHERE id = ? AND writer_id = ? AND kind = 'worker' AND identity_json = ?
        AND cleanup_confirmed = 0 AND creation_acknowledged = 0
        AND EXISTS (SELECT 1 FROM workspace_writers w WHERE w.id = workspace_resources.writer_id
          AND w.recovery_mode = 'owned'
          AND json_array(w.id, w.team_id, w.root_path, w.root_identity, w.daemon_identity, w.kind, w.created_at) = ?)`,
      [registration.id, registration.writerId, slot.identityJson, slot.writerBinding],
    )
    if (!result.changes) throw new Error('Native resource registration changed')
    slot.view?.close()
    this.nativeSlots.delete(registration.id)
  }

  bindNativeOwner(registration: NativeResourceRegistration, owner: NativeCommandOwner): void {
    const slot = this.nativeSlot(registration)
    if (
      slot.phase !== 'spawning' ||
      !(slot.registration.identity.backend === 'linux-bwrap'
        ? isOwnedLinuxNamespace(owner)
        : isOwnedDarwinJob(owner)) ||
      this.boundNativeOwners.has(owner)
    )
      throw new Error('Live native resource ownership unavailable')
    owner.bindSignalGuard((action) => {
      try {
        if (
          this.nativeSlot(registration) !== slot ||
          slot.phase !== 'acknowledged' ||
          slot.owner !== owner ||
          !owner.matches(slot.ownerReceipt)
        )
          return false
        if (action === 'input') {
          if (slot.inputReleased || this.nativeRecord(registration.id)?.writer_state !== 'active')
            return false
          slot.inputReleased = true
        }
        return true
      } catch {
        return false
      }
    })
    slot.owner = owner
    slot.ownerReceipt = Object.freeze({ ...owner.receipt })
    slot.phase = 'bound'
    this.boundNativeOwners.add(owner)
  }

  acknowledgeNativeCreation(registration: NativeResourceRegistration): Promise<void> {
    const slot = this.nativeSlot(registration)
    if (!slot.owner?.matches(slot.ownerReceipt) || !['bound', 'acknowledged'].includes(slot.phase))
      throw new Error('Native creation ownership unavailable')
    slot.acknowledgement ??= (async () => {
      await slot.owner?.ready
      const current = this.nativeSlot(registration)
      if (current !== slot || slot.phase !== 'bound' || !slot.owner?.matches(slot.ownerReceipt))
        throw new Error('Native creation ownership changed')
      const result = this.db.raw.run(
        `UPDATE workspace_resources SET creation_acknowledged = 1
        WHERE id = ? AND writer_id = ? AND kind = 'worker' AND identity_json = ?
          AND cleanup_confirmed = 0 AND creation_acknowledged = 0
          AND EXISTS (SELECT 1 FROM workspace_writers w WHERE w.id = workspace_resources.writer_id
            AND w.recovery_mode = 'owned'
            AND json_array(w.id, w.team_id, w.root_path, w.root_identity, w.daemon_identity, w.kind, w.created_at) = ?)`,
        [registration.id, registration.writerId, slot.identityJson, slot.writerBinding],
      )
      if (!result.changes) throw new Error('Native creation record changed')
      slot.phase = 'acknowledged'
    })()
    return slot.acknowledgement
  }

  registerContainer(lease: WorkspaceLease, identity: DockerContainerIdentity): string {
    return this.register(lease, { kind: 'container', identity })
  }

  acknowledgeContainerCreation(id: string): void {
    const result = this.db.raw.run(
      "UPDATE workspace_resources SET creation_acknowledged = 1 WHERE id = ? AND kind = 'container' AND cleanup_confirmed = 0",
      [id],
    )
    if (!result.changes) throw new Error('Container creation record is unavailable')
  }

  private register(lease: WorkspaceLease, resource: Resource): string {
    return inTx(this.db, () => {
      const id = randomUUID()
      lease.attach({ id, kind: resource.kind })
      this.db.raw.run(
        'INSERT INTO workspace_resources (id, writer_id, kind, identity_json) VALUES (?, ?, ?, ?)',
        [id, lease.writer.id, resource.kind, JSON.stringify(resource.identity)],
      )
      return id
    })
  }

  cleanupResource(
    id: string,
    observedNormalExit = false,
    management?: ManagementCleanup,
  ): Promise<boolean> {
    if (!this.linuxNativeWorkers.has(id) || management)
      return this.cleanupKnownResource(id, observedNormalExit, management)
    const pending = this.linuxWorkerRetirements.get(id)
    if (pending) return pending
    const operation = this.cleanupKnownResource(id, observedNormalExit)
    this.linuxWorkerRetirements.set(id, operation)
    void operation
      .finally(() => {
        if (this.linuxWorkerRetirements.get(id) === operation)
          this.linuxWorkerRetirements.delete(id)
      })
      .catch(() => {})
    return operation
  }

  private async cleanupKnownResource(
    id: string,
    observedNormalExit = false,
    management?: ManagementCleanup,
  ): Promise<boolean> {
    const liveLinuxWorker = this.linuxNativeWorkers.get(id)
    if (liveLinuxWorker) {
      try {
        this.linuxWorker(id)
      } catch {
        return false
      }
    }
    const row = this.db.raw
      .query<Row, [string]>(`SELECT r.*, w.recovery_mode FROM workspace_resources r
        JOIN workspace_writers w ON w.id = r.writer_id WHERE r.id = ?`)
      .get(id)
    if (!row) return false
    // A substituted live-native row must never fall through to another worker/container
    // recovery implementation or change the captured target of a pending cleanup.
    const liveNative = this.nativeSlots.get(id)
    if (
      liveNative &&
      (row.kind !== 'worker' ||
        row.writer_id !== liveNative.registration.writerId ||
        row.identity_json !== liveNative.identityJson ||
        row.creation_acknowledged !== (liveNative.phase === 'acknowledged' ? 1 : 0))
    )
      return false
    if (liveNative) {
      try {
        if (this.nativeSlot(liveNative.registration) !== liveNative) return false
      } catch {
        return false
      }
    }
    const selected = management?.record
    if (
      selected &&
      (row.id !== selected.id ||
        row.writer_id !== selected.writer_id ||
        row.kind !== selected.kind ||
        row.identity_json !== selected.identity_json ||
        row.creation_acknowledged !== selected.creation_acknowledged)
    )
      return false
    if (row.recovery_mode === 'restored') return false
    if (row.cleanup_confirmed) return true
    // Enforce the management restriction at the effect boundary too, after re-reading the
    // record. A concurrent change must not turn container cleanup into worker signalling.
    if (management?.confirmedWorkersOnly && row.kind === 'worker') return false
    let identity: unknown
    try {
      identity = JSON.parse(row.identity_json)
    } catch {
      return false
    }
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return false
    let confirmed: boolean
    if (row.kind === 'worker' && isNativeIdentity(identity)) {
      const slot = this.nativeSlots.get(id)
      const owner = slot?.owner
      if (
        row.creation_acknowledged !== 1 ||
        slot?.phase !== 'acknowledged' ||
        slot.identityJson !== row.identity_json ||
        slot.registration.writerId !== row.writer_id ||
        !owner ||
        !isNativeOwner(owner) ||
        !owner.matches(slot.ownerReceipt)
      )
        return false
      confirmed = owner.isSettled() || (await owner.terminate())
      if (
        !confirmed ||
        this.nativeSlots.get(id) !== slot ||
        !owner.matches(slot.ownerReceipt) ||
        !owner.isSettled()
      )
        return false
      try {
        if (this.nativeSlot(slot.registration) !== slot) return false
      } catch {
        return false
      }
    } else if (
      row.kind === 'worker' &&
      'kind' in identity &&
      identity.kind === 'owned-linux-native-child'
    ) {
      if (!liveLinuxWorker?.owner.matches(identity)) return false
      confirmed = await liveLinuxWorker.owner.settled()
      if (!confirmed) return false
      try {
        if (this.linuxWorker(id) !== liveLinuxWorker) return false
      } catch {
        return false
      }
    } else if (row.kind === 'worker') {
      const owner = this.nativeWorkers.get(id)
      confirmed =
        process.platform === 'darwin'
          ? !!owner && owner.matches(identity) && (await owner.settled())
          : process.platform === 'linux' && !('kind' in identity)
            ? await terminateWorkerProcess(identity as WorkerProcessIdentity, observedNormalExit)
            : false
    } else {
      confirmed = await terminateRecordedContainer(
        identity as DockerContainerIdentity,
        row.creation_acknowledged === 1,
      )
    }
    if (!confirmed) return false
    // A delayed cleanup cannot acknowledge a substituted resource or restored writer. Keep
    // the live owner until the exact captured DB record accepts its confirmation atomically.
    const result = this.db.raw.run(
      `UPDATE workspace_resources SET cleanup_confirmed = 1
       WHERE id = ? AND writer_id = ? AND kind = ? AND identity_json = ?
         AND creation_acknowledged = ?
         AND EXISTS (SELECT 1 FROM workspace_writers w
           WHERE w.id = workspace_resources.writer_id AND w.recovery_mode = 'owned'
             AND (? IS NULL OR json_array(w.id, w.team_id, w.root_path, w.root_identity, w.daemon_identity, w.kind, w.created_at) = ?))`,
      [
        row.id,
        row.writer_id,
        row.kind,
        row.identity_json,
        row.creation_acknowledged,
        liveNative?.writerBinding ?? liveLinuxWorker?.writerBinding ?? null,
        liveNative?.writerBinding ?? liveLinuxWorker?.writerBinding ?? null,
      ],
    )
    if (!result.changes) {
      if (liveLinuxWorker) {
        liveLinuxWorker.revoked = true
        liveLinuxWorker.owner.revoke()
      }
      return false
    }
    this.nativeWorkers.delete(id)
    if (liveLinuxWorker) {
      if (!liveLinuxWorker.owner.closeSettled()) return false
      this.linuxNativeWorkers.delete(id)
    }
    const native = this.nativeSlots.get(id)
    if (native) {
      if (!native.owner?.closeSettled()) return false
      native.view?.close()
      this.nativeSlots.delete(id)
    }
    return true
  }

  /** Workers first: stop new container requests before removing recorded containers. */
  async teardown(writer: WorkspaceWriter, management?: ManagementCleanup): Promise<boolean> {
    const rows = this.db.raw
      .query<Row, [string]>(
        "SELECT * FROM workspace_resources WHERE writer_id = ? ORDER BY CASE kind WHEN 'worker' THEN 0 ELSE 1 END",
      )
      .all(writer.id)
    if (
      writer.resources.some(
        (resource) => !rows.some((row) => row.id === resource.id && row.kind === resource.kind),
      )
    )
      return false
    for (const row of rows) {
      const selected = management ? { ...management, record: row } : undefined
      if (!(await this.cleanupResource(row.id, false, selected))) return false
    }
    return true
  }
}
