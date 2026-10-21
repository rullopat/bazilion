import type {
  WorkspaceRecoveryBlocker,
  WorkspaceRecoveryOutcome,
  WorkspaceRecoveryReport,
} from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { type WorkspaceCoordinator, type WorkspaceWriter, workspaceIdentity } from './workspace.ts'

export type { WorkspaceRecoveryOutcome } from '@bazilion/api-types'

interface Selection {
  id: string
  team_id: string
  root_path: string
  root_identity: string
  state: string
  recovery_mode: string
  resources_json: string
  daemon_identity: string
}

/** Owner-management service only: no Agent tool, PID/engine/root substitution or force acknowledgement.
 * Caller resolves the Team's CURRENT canonical registered root, never an HTTP-supplied path.
 */
export class WorkspaceRecovery {
  private readonly attempts = new Map<string, Promise<WorkspaceRecoveryOutcome>>()
  constructor(
    private readonly db: BazilionDb,
    private readonly coordinator: WorkspaceCoordinator,
    private readonly teardown: (writer: WorkspaceWriter) => Promise<boolean>,
  ) {}

  report(teamId: string, registeredRoot: string): WorkspaceRecoveryReport {
    let root: ReturnType<typeof workspaceIdentity> | undefined
    try {
      root = workspaceIdentity(registeredRoot)
    } catch {
      /* report a refusal, no raw paths */
    }
    const rows = this.db.raw
      .query<Selection, [string]>(
        'SELECT id, team_id, root_path, root_identity, state, recovery_mode, resources_json, daemon_identity FROM workspace_writers WHERE team_id = ? ORDER BY created_at, id LIMIT 65',
      )
      .all(teamId)
    return {
      teamId,
      truncated: rows.length > 64,
      writers: rows.slice(0, 64).map((row) => {
        const posture =
          row.recovery_mode === 'restored'
            ? 'restored'
            : !root || root.root !== row.root_path || root.rootIdentity !== row.root_identity
              ? 'root_changed'
              : row.state === 'active' && row.daemon_identity === this.coordinator.identity
                ? 'active'
                : 'recovery_required'
        const blocker = posture === 'recovery_required' ? this.blocker(row) : undefined
        return { writerId: row.id, posture, ...(blocker ? { blocker } : {}) }
      }),
    }
  }

  attempt(
    teamId: string,
    registeredRoot: string,
    writerId: string,
    currentRegistration: () => string | undefined = () => registeredRoot,
  ): Promise<WorkspaceRecoveryOutcome> {
    const existing = this.attempts.get(writerId)
    // Do not share a result with a caller selecting a different Team/root.
    if (existing) {
      const selected = this.select(writerId)
      return Promise.resolve(selected?.team_id === teamId ? 'active' : 'not_found')
    }
    // Install serialization before any teardown callback can synchronously re-enter.
    const pending = Promise.resolve().then(() =>
      this.perform(teamId, registeredRoot, writerId, currentRegistration),
    )
    this.attempts.set(writerId, pending)
    void pending.finally(() => this.attempts.delete(writerId)).catch(() => {})
    return pending
  }
  private select(id: string): Selection | null {
    return this.db.raw
      .query<Selection, [string]>(
        'SELECT id, team_id, root_path, root_identity, state, recovery_mode, resources_json, daemon_identity FROM workspace_writers WHERE id = ?',
      )
      .get(id)
  }
  /** Management adds no worker-signalling authority. Existing lifecycle cleanup owns that work. */
  private blocker(row: Selection): WorkspaceRecoveryBlocker | undefined {
    try {
      const references: WorkspaceWriter['resources'] = JSON.parse(row.resources_json)
      const resources = this.db.raw
        .query<
          { id: string; kind: string; identity_json: string; cleanup_confirmed: number },
          [string]
        >(
          'SELECT id, kind, identity_json, cleanup_confirmed FROM workspace_resources WHERE writer_id = ?',
        )
        .all(row.id)
      if (
        !Array.isArray(references) ||
        references.length === 0 ||
        references.length !== resources.length ||
        new Set(references.map((reference) => reference.id)).size !== references.length ||
        references.some(
          (reference) =>
            !resources.some(
              (resource) => resource.id === reference.id && resource.kind === reference.kind,
            ),
        )
      )
        return 'resource_records_unavailable'
      for (const resource of resources) {
        const identity = JSON.parse(resource.identity_json)
        if (!identity || typeof identity !== 'object' || Array.isArray(identity))
          return 'resource_records_unavailable'
        if (resource.kind === 'worker') {
          if (typeof identity.hostCommands !== 'boolean') return 'resource_records_unavailable'
          if (resource.cleanup_confirmed !== 1)
            return identity.hostCommands ? 'host_commands' : 'worker_cleanup_unconfirmed'
        } else if (identity.hostCommands === true) return 'host_commands'
      }
      return undefined
    } catch {
      return 'resource_records_unavailable'
    }
  }
  private async perform(
    teamId: string,
    registeredRoot: string,
    id: string,
    currentRegistration: () => string | undefined,
  ): Promise<WorkspaceRecoveryOutcome> {
    const row = this.select(id)
    if (!row || row.team_id !== teamId) return 'not_found'
    if (row.recovery_mode === 'restored') return 'restored'
    if (row.state === 'active' && row.daemon_identity === this.coordinator.identity) return 'active'
    const matchesRoot = () => {
      try {
        const currentRoot = currentRegistration()
        if (currentRoot !== registeredRoot) return false
        const root = workspaceIdentity(currentRoot)
        return root.root === row.root_path && root.rootIdentity === row.root_identity
      } catch {
        return false
      }
    }
    if (!matchesRoot()) return 'root_changed'
    try {
      let changed = false
      let canRelease = () => false
      const recovered = await this.coordinator.recover(
        id,
        async (writer) => {
          const current = this.select(id)
          if (
            !current ||
            current.team_id !== teamId ||
            current.root_path !== row.root_path ||
            current.root_identity !== row.root_identity ||
            current.resources_json !== row.resources_json ||
            current.recovery_mode !== 'owned' ||
            !matchesRoot()
          ) {
            changed = true
            return false
          }
          // Unknown host-command cleanup stays blocked. A worker needs an existing cleanup
          // confirmation; caller-supplied/obsolete phase markers cannot authorize signalling.
          if (this.blocker(current)) return false
          const inventory = () =>
            JSON.stringify(
              this.db.raw
                .query<
                  {
                    id: string
                    kind: string
                    identity_json: string
                    creation_acknowledged: number
                  },
                  [string]
                >(
                  'SELECT id, kind, identity_json, creation_acknowledged FROM workspace_resources WHERE writer_id = ? ORDER BY id',
                )
                .all(id),
            )
          const confirmed = () =>
            this.db.raw
              .query<{ cleanup_confirmed: number }, [string]>(
                'SELECT cleanup_confirmed FROM workspace_resources WHERE writer_id = ?',
              )
              .all(id)
              .filter((resource) => resource.cleanup_confirmed === 1).length
          const changes = () =>
            this.db.raw.query<{ count: number }, []>('SELECT total_changes() AS count').get()?.count
          const version = () =>
            this.db.raw.query<{ data_version: number }, []>('PRAGMA data_version').get()
              ?.data_version
          const capturedInventory = inventory()
          const expectedConfirmations = JSON.parse(capturedInventory).length
          const versionBefore = version()
          const confirmedBefore = confirmed()
          const changesBefore = changes()
          if (!(await this.teardown(writer))) return false
          canRelease = () => {
            const changesAfter = changes()
            // No schema/epoch backfill: reject ANY concurrent DB mutation except our recorded
            // 0->1 cleanup confirmations. This detects delete/recreate even at an identical timestamp.
            if (
              !Number.isSafeInteger(versionBefore) ||
              version() !== versionBefore ||
              !Number.isSafeInteger(changesBefore) ||
              !Number.isSafeInteger(changesAfter) ||
              (changesAfter as number) - (changesBefore as number) !== confirmed() - confirmedBefore
            ) {
              changed = true
              return false
            }
            if (inventory() !== capturedInventory) {
              changed = true
              return false
            }
            const after = this.select(id)
            if (
              !after ||
              after.team_id !== teamId ||
              after.root_path !== row.root_path ||
              after.root_identity !== row.root_identity ||
              after.resources_json !== row.resources_json ||
              after.recovery_mode !== 'owned' ||
              !matchesRoot()
            ) {
              changed = true
              return false
            }
            return confirmed() === expectedConfirmations
          }
          return true
        },
        () => canRelease(),
      )
      return changed ? 'selection_changed' : recovered ? 'recovered' : 'blocked'
    } catch {
      return 'blocked'
    }
  }
}
