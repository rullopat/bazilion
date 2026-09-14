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
import type { WorkspaceLease, WorkspaceWriter } from './workspace.ts'

type Resource =
  | { kind: 'worker'; identity: WorkerProcessIdentity }
  | { kind: 'container'; identity: DockerContainerIdentity }
interface Row {
  id: string
  kind: Resource['kind']
  identity_json: string
  cleanup_confirmed: number
  creation_acknowledged: number
  recovery_mode?: 'owned' | 'restored'
}

export class WorkspaceResources {
  constructor(private readonly db: BazilionDb) {}

  registerWorker(lease: WorkspaceLease, pid: number, hostCommands = false): string {
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

  async cleanupResource(id: string, observedNormalExit = false): Promise<boolean> {
    const row = this.db.raw
      .query<Row, [string]>(`SELECT r.*, w.recovery_mode FROM workspace_resources r
        JOIN workspace_writers w ON w.id = r.writer_id WHERE r.id = ?`)
      .get(id)
    if (!row) return false
    if (row.recovery_mode === 'restored') return false
    if (row.cleanup_confirmed) return true
    const identity = JSON.parse(row.identity_json)
    const confirmed =
      row.kind === 'worker'
        ? await terminateWorkerProcess(identity, observedNormalExit)
        : await terminateRecordedContainer(identity, row.creation_acknowledged === 1)
    if (confirmed)
      this.db.raw.run('UPDATE workspace_resources SET cleanup_confirmed = 1 WHERE id = ?', [id])
    return confirmed
  }

  /** Workers first: stop new container requests before removing recorded containers. */
  async teardown(writer: WorkspaceWriter): Promise<boolean> {
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
      if (!(await this.cleanupResource(row.id))) return false
    }
    return true
  }
}
