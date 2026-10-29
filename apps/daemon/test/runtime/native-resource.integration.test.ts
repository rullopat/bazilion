import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { WorkspaceResources } from '../../src/lib/coding-environment/resources.ts'
import type { WorkspaceLease } from '../../src/lib/coding-environment/workspace.ts'
import { nativeLinuxDomainFixture } from '../fixtures/native-linux-domain.ts'

const enabled = process.platform === 'linux' && process.env.BAZILION_TEST_NATIVE === '1'
async function setup() {
  const fixture = await nativeLinuxDomainFixture()
  const db = openDb(join(fixture.root, 'state.sqlite'))
  runMigrations(db)
  db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', ['one', 'one', 1])
  const lifecycle = workspaceLifecycle(db)
  let binding: ReturnType<typeof lifecycle.native> | undefined
  let lease: WorkspaceLease | undefined
  const run = await fixture.start(undefined, {
    beforeSpawn(workspace) {
      lease = lifecycle.coordinator.claim('one', workspace, 'agent')
      binding = lifecycle.native(lease, 'linux-bwrap', 'f'.repeat(64))
      const row = db.raw
        .query<{ creation_acknowledged: number; cleanup_confirmed: number }, []>(
          'SELECT * FROM workspace_resources',
        )
        .get()
      expect(row).toMatchObject({ creation_acknowledged: 0, cleanup_confirmed: 0 })
      binding.beforeSpawn()
    },
    bind(owner) {
      if (!binding) throw new Error('persisted intent missing')
      binding.bind(owner)
    },
  })
  if (!binding || !lease) throw new Error(`Native fixture lease missing; retained ${fixture.root}`)
  await binding.afterCreation()
  const id = db.raw.query<{ id: string }, []>('SELECT id FROM workspace_resources').get()?.id
  if (!id) throw new Error('native record missing')
  expect(
    db.raw
      .query<{ creation_acknowledged: number }, []>(
        'SELECT creation_acknowledged FROM workspace_resources',
      )
      .get()?.creation_acknowledged,
  ).toBe(1)
  return { fixture, db, lifecycle, run, binding, lease, id }
}
async function started(run: Awaited<ReturnType<typeof setup>>['run']) {
  const deadline = performance.now() + 1500
  while (!run.stdout.includes('native-started') && performance.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10))
  expect(run.stdout).toContain('native-started')
}
async function finish(input: Awaited<ReturnType<typeof setup>>) {
  expect(await input.binding.afterExit()).toBe(true)
  expect(
    input.db.raw
      .query<{ cleanup_confirmed: number }, []>('SELECT cleanup_confirmed FROM workspace_resources')
      .get()?.cleanup_confirmed,
  ).toBe(1)
  await input.lifecycle.release(input.lease)
  input.lifecycle.coordinator.claim('one', input.run.workspace, 'agent').finish(true)
  expect(input.run.finish()).toBe(true)
  input.db.close()
  input.fixture.cleanup()
}

test.skipIf(!enabled)(
  'native intent and live creation acknowledgement precede command input; normal cleanup frees the canonical writer',
  async () => {
    const input = await setup()
    try {
      await input.run.release('printf native-started\nexit 0\n')
      expect(await input.run.waitSettled()).toBe(true)
      await finish(input)
    } catch (cause) {
      throw new Error(`Native canonical normal cleanup failed; retained ${input.fixture.root}`, {
        cause,
      })
    }
  },
  15_000,
)

test.skipIf(!enabled)(
  'inactive canonical writer cannot release command input after creation acknowledgement',
  async () => {
    const input = await setup()
    try {
      input.lease.finish(false)
      await expect(input.run.release('printf forbidden > forbidden\n')).rejects.toThrow(
        'ownership unavailable',
      )
      expect(existsSync(join(input.run.workspace, 'forbidden'))).toBe(false)
      await finish(input)
    } catch (cause) {
      throw new Error(`Native fresh input admission failed; retained ${input.fixture.root}`, {
        cause,
      })
    }
  },
  15_000,
)

test.skipIf(!enabled)(
  'canonical native cleanup cancels the actual owned domain before releasing the writer',
  async () => {
    const input = await setup()
    try {
      await input.run.release('trap "" TERM\nprintf native-started\nwhile :; do sleep .02; done\n')
      await started(input.run)
      await finish(input)
    } catch (cause) {
      throw new Error(`Native canonical cancellation failed; retained ${input.fixture.root}`, {
        cause,
      })
    }
  },
  15_000,
)

test.skipIf(!enabled)(
  'a new resource registry cannot recover a running namespace from its durable receipt',
  async () => {
    const input = await setup()
    try {
      const replacement = new WorkspaceResources(input.db)
      expect(await replacement.cleanupResource(input.id)).toBe(false)
      expect(input.run.owner.observation().root).toBe('live')
      await input.run.release('exit 0\n')
      expect(await input.run.waitSettled()).toBe(true)
      expect(await replacement.cleanupResource(input.id)).toBe(false)
      await finish(input)
    } catch (cause) {
      throw new Error(
        `Native receipt-only recovery refusal failed; retained ${input.fixture.root}`,
        { cause },
      )
    }
  },
  15_000,
)

test.skipIf(!enabled)(
  'restored writer state revokes canonical signal admission and never frees the retained writer',
  async () => {
    const input = await setup()
    try {
      await input.run.release('printf native-started\nsleep .5\nexit 0\n')
      await started(input.run)
      input.db.raw.run("UPDATE workspace_writers SET recovery_mode = 'restored' WHERE id = ?", [
        input.lease.writer.id,
      ])
      expect(await input.run.owner.terminate()).toBe(false)
      expect(input.run.owner.observation().refusal).toBe('record')
      expect(await input.binding.afterExit()).toBe(false)
      expect(await input.run.waitSettled()).toBe(true)
      expect(input.run.child.exitCode).toBe(0)
      expect(input.run.child.signalCode).toBe(null)
      expect(await input.binding.afterExit()).toBe(false)
      input.lease.finish(false)
      expect(() => input.lifecycle.coordinator.claim('one', input.run.workspace, 'agent')).toThrow(
        'workspace_recovery_required',
      )
      input.db.close()
      // Deliberately retain the restored row, input pins and owner handles. No force acknowledgement.
    } catch (cause) {
      throw new Error(`Native restored-row refusal failed; retained ${input.fixture.root}`, {
        cause,
      })
    }
  },
  15_000,
)
