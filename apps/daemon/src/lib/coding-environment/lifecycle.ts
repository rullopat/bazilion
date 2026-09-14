import { randomUUID } from 'node:crypto'
import type { BazilionDb } from '../../core/db/client.ts'
import type {
  DockerContainerIdentity,
  DockerResourceLifecycle,
} from '../../runtime/shell/docker.ts'
import type { WorkerResourceLifecycle } from '../../runtime/worker/spawn.ts'
import { WorkspaceResources } from './resources.ts'
import { WorkspaceCoordinator, type WorkspaceLease } from './workspace.ts'

const KEY = Symbol.for('bazilion.workspace-lifecycle')
export function workspaceLifecycle(db: BazilionDb): WorkspaceLifecycle {
  const global = globalThis as unknown as Record<
    symbol,
    WeakMap<BazilionDb, WorkspaceLifecycle> | undefined
  >
  global[KEY] ??= new WeakMap()
  const services = global[KEY]
  let service = services.get(db)
  if (!service) {
    service = new WorkspaceLifecycle(db)
    services.set(db, service)
  }
  return service
}

class WorkspaceLifecycle {
  readonly coordinator: WorkspaceCoordinator
  readonly resources: WorkspaceResources
  private readonly recoveries = new Map<string, Promise<boolean>>()
  constructor(db: BazilionDb) {
    this.coordinator = new WorkspaceCoordinator(db)
    this.resources = new WorkspaceResources(db)
  }

  async claim(teamId: string, root: string, kind: 'agent' | 'mutation'): Promise<WorkspaceLease> {
    // Reconciliation does not replay work. Unknown cleanup remains a durable admission blocker.
    for (const writer of this.coordinator.recoveryRequired()) await this.recover(writer.id)
    return this.coordinator.claim(teamId, root, kind)
  }

  worker(lease: WorkspaceLease): WorkerResourceLifecycle {
    let id: string | undefined
    return {
      beforeInput: (pid, hostCommands) => {
        if (id) throw new Error('Worker resource already registered')
        id = this.resources.registerWorker(lease, pid, hostCommands)
      },
      afterExit: async (observedNormalExit) =>
        id === undefined || this.resources.cleanupResource(id, observedNormalExit),
    }
  }

  containers(
    lease: WorkspaceLease,
    expected?: Omit<DockerContainerIdentity, 'containerName'>,
  ): DockerResourceLifecycle {
    const prefix = `bazilion-${lease.writer.id}-`
    const records = new Map<string, string>()
    return {
      name: (kind) => `${prefix}${kind}-${randomUUID()}`,
      beforeCreate: async (identity) => {
        if (
          !identity.containerName.startsWith(prefix) ||
          !/^bazilion-[a-z0-9-]{1,160}$/.test(identity.containerName) ||
          records.has(identity.containerName)
        )
          throw new Error('Invalid turn container identity')
        if (
          expected &&
          (identity.dockerPath !== expected.dockerPath ||
            identity.endpoint !== expected.endpoint ||
            JSON.stringify(identity.executableIdentity) !==
              JSON.stringify(expected.executableIdentity))
        )
          throw new Error('Container engine does not match admitted runtime')
        records.set(identity.containerName, this.resources.registerContainer(lease, identity))
      },
      afterCreate: async (name) => {
        const id = records.get(name)
        if (!id) throw new Error('Container creation record is unavailable')
        this.resources.acknowledgeContainerCreation(id)
      },
      afterRemove: async (name) => {
        const id = records.get(name)
        if (!id || !(await this.resources.cleanupResource(id)))
          throw new Error('Container cleanup unconfirmed; workspace recovery required')
      },
    }
  }

  async release(lease: WorkspaceLease): Promise<void> {
    lease.finish(false)
    await this.recover(lease.writer.id)
  }

  private recover(id: string): Promise<boolean> {
    let pending = this.recoveries.get(id)
    if (!pending) {
      pending = this.coordinator
        .recover(id, (writer) => this.resources.teardown(writer))
        .finally(() => this.recoveries.delete(id))
      this.recoveries.set(id, pending)
    }
    return pending
  }
}
