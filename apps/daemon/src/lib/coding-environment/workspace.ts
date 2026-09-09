import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { type BazilionDb, inTx } from '../../core/db/client.ts'
import { ContextDirectory } from '../repository-context/files.ts'

export class WorkspaceBusyError extends Error {
  readonly status = 409
  constructor(readonly recoveryRequired = false) {
    super(recoveryRequired ? 'workspace_recovery_required' : 'workspace_busy')
  }
}

/** Host-only ownership evidence. Never accepted from HTTP configuration or exposed in status. */
export interface WorkspaceResource {
  kind: 'worker' | 'container'
  /** Opaque reference to a daemon-owned process/container recovery record. */
  id: string
}
interface WriterRow {
  id: string
  team_id: string
  root_path: string
  root_identity: string
  daemon_identity: string
  kind: 'agent' | 'mutation'
  exclusive: number
  state: 'active' | 'recovery'
  recovery_mode: 'owned' | 'restored'
  resources_json: string
  created_at: number
}
export interface WorkspaceWriter {
  restored?: true
  id: string
  teamId: string
  root: string
  rootIdentity: string
  kind: 'agent' | 'mutation'
  resources: WorkspaceResource[]
}

export function overlappingWorkspaceRoots(a: string, b: string): boolean {
  const contains = (parent: string, child: string) => {
    const path = relative(parent, child)
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('../'))
  }
  return contains(a, b) || contains(b, a)
}

/** Pin the registered root (including its deliberate symlink) during identity capture. */
export function workspaceIdentity(registeredRoot: string): { root: string; rootIdentity: string } {
  const directory = new ContextDirectory(registeredRoot)
  try {
    const root = realpathSync(registeredRoot)
    directory.validate()
    return { root, rootIdentity: directory.identity }
  } finally {
    directory.close()
  }
}

function view(row: WriterRow): WorkspaceWriter {
  return {
    id: row.id,
    teamId: row.team_id,
    root: row.root_path,
    rootIdentity: row.root_identity,
    kind: row.kind,
    resources: JSON.parse(row.resources_json),
    ...(row.recovery_mode === 'restored' ? { restored: true as const } : {}),
  }
}

/** One process-lifetime instance per daemon DB. Old identities require explicit recovery. */
export class WorkspaceCoordinator {
  readonly identity = randomUUID()
  private readonly leases = new Set<string>()
  private readonly issued = new WeakSet<WorkspaceLease>()
  constructor(private readonly db: BazilionDb) {}

  claim(teamId: string, registeredRoot: string, kind: WorkspaceWriter['kind']): WorkspaceLease {
    const root = workspaceIdentity(registeredRoot)
    return inTx(this.db, () => {
      const exclusive = true
      const rows = this.db.raw.query<WriterRow, []>('SELECT * FROM workspace_writers').all()
      for (const row of rows) {
        if (
          !(row.recovery_mode === 'restored' && row.team_id === teamId) &&
          !overlappingWorkspaceRoots(row.root_path, root.root) &&
          row.root_identity !== root.rootIdentity
        )
          continue
        const recovery = row.daemon_identity !== this.identity || row.state === 'recovery'
        if (recovery || exclusive || row.exclusive === 1) throw new WorkspaceBusyError(recovery)
      }
      const id = randomUUID()
      this.db.raw.run(
        `INSERT INTO workspace_writers
        (id, team_id, root_path, root_identity, daemon_identity, kind, exclusive, state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          id,
          teamId,
          root.root,
          root.rootIdentity,
          this.identity,
          kind,
          exclusive ? 1 : 0,
          Date.now(),
        ],
      )
      this.leases.add(id)
      const lease = new WorkspaceLease(this, { id, teamId, ...root, kind, resources: [] })
      this.issued.add(lease)
      return lease
    })
  }

  assertLease(lease: WorkspaceLease, teamId: string, registeredRoot: string): void {
    const root = workspaceIdentity(registeredRoot)
    if (
      !this.issued.has(lease) ||
      !this.leases.has(lease.writer.id) ||
      lease.writer.teamId !== teamId ||
      lease.writer.root !== root.root ||
      lease.writer.rootIdentity !== root.rootIdentity
    )
      throw new Error('Workspace lease does not match this turn')
  }

  /** Return only abandoned/unconfirmed writers; absence of a process is not inferred from age. */
  recoveryRequired(): WorkspaceWriter[] {
    return this.db.raw
      .query<WriterRow, [string]>(
        "SELECT * FROM workspace_writers WHERE daemon_identity != ? OR state = 'recovery'",
      )
      .all(this.identity)
      .map(view)
  }

  /** The recovery host must terminate/reap each recorded resource before acknowledging it. */
  async recover(
    writerId: string,
    teardown: (writer: WorkspaceWriter) => Promise<boolean>,
  ): Promise<boolean> {
    const row = this.db.raw
      .query<WriterRow, [string]>('SELECT * FROM workspace_writers WHERE id = ?')
      .get(writerId)
    if (!row) return true
    // Backup data is not live process/container termination authority.
    if (row.recovery_mode === 'restored') return false
    if (
      this.leases.has(writerId) ||
      (row.daemon_identity === this.identity && row.state === 'active')
    )
      throw new WorkspaceBusyError()
    this.db.raw.run("UPDATE workspace_writers SET state = 'recovery' WHERE id = ?", [writerId])
    if (!(await teardown(view(row)))) return false
    // The row remains blocking during asynchronous cleanup; no execution is ever replayed.
    this.db.raw.run("DELETE FROM workspace_writers WHERE id = ? AND state = 'recovery'", [writerId])
    return true
  }

  attach(id: string, resource: WorkspaceResource): void {
    if (!this.leases.has(id)) throw new Error('Workspace lease is no longer active')
    const row = this.db.raw
      .query<WriterRow, [string]>('SELECT * FROM workspace_writers WHERE id = ?')
      .get(id)
    if (row?.state !== 'active') throw new Error('Workspace lease requires recovery')
    const resources = JSON.parse(row.resources_json) as WorkspaceResource[]
    if (resources.some((item) => item.kind === resource.kind && item.id === resource.id)) return
    resources.push(resource)
    this.db.raw.run('UPDATE workspace_writers SET resources_json = ? WHERE id = ?', [
      JSON.stringify(resources),
      id,
    ])
  }

  finish(id: string, cleanupConfirmed: boolean): void {
    if (!this.leases.delete(id)) return
    if (cleanupConfirmed) this.db.raw.run('DELETE FROM workspace_writers WHERE id = ?', [id])
    else this.db.raw.run("UPDATE workspace_writers SET state = 'recovery' WHERE id = ?", [id])
  }
}

export class WorkspaceLease {
  constructor(
    private readonly coordinator: WorkspaceCoordinator,
    readonly writer: WorkspaceWriter,
  ) {}
  /** Persist before allowing the resource to start. */
  attach(resource: WorkspaceResource): void {
    this.coordinator.attach(this.writer.id, resource)
  }
  /** Only the execution/teardown host can attest this; a cancel request alone is insufficient. */
  finish(cleanupConfirmed: boolean): void {
    this.coordinator.finish(this.writer.id, cleanupConfirmed)
  }
}
