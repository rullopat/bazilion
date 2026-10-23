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
import { getDarwinProcessInspector } from '../process/darwin.ts'
import { type DarwinWorkerIdentity, OwnedDarwinWorker } from '../process/worker.ts'
import type { WorkspaceLease, WorkspaceWriter } from './workspace.ts'

type Resource =
  | { kind: 'worker'; identity: WorkerProcessIdentity | DarwinWorkerIdentity }
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

interface ManagementCleanup {
  confirmedWorkersOnly: true
  record?: Pick<Row, 'id' | 'writer_id' | 'kind' | 'identity_json' | 'creation_acknowledged'>
}

export class WorkspaceResources {
  private readonly nativeWorkers = new Map<string, OwnedDarwinWorker>()
  constructor(private readonly db: BazilionDb) {}

  assertWorkerReady(): void {
    if (process.platform === 'darwin') {
      if (this.nativeWorkers.size >= 256) throw new Error('Live worker ownership unavailable')
      getDarwinProcessInspector().assertReady()
    }
  }

  beforeWorkerSignal(id: string): void {
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
  ): string {
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

  async cleanupResource(
    id: string,
    observedNormalExit = false,
    management?: ManagementCleanup,
  ): Promise<boolean> {
    const row = this.db.raw
      .query<Row, [string]>(`SELECT r.*, w.recovery_mode FROM workspace_resources r
        JOIN workspace_writers w ON w.id = r.writer_id WHERE r.id = ?`)
      .get(id)
    if (!row) return false
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
    if (row.kind === 'worker') {
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
           WHERE w.id = workspace_resources.writer_id AND w.recovery_mode = 'owned')`,
      [row.id, row.writer_id, row.kind, row.identity_json, row.creation_acknowledged],
    )
    if (!result.changes) return false
    this.nativeWorkers.delete(id)
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
