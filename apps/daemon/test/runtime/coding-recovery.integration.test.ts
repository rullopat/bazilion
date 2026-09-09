import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type BazilionDb, openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import {
  createPreparedDockerBashOperations,
  preflightProtectedDockerEngine,
  preflightProtectedDockerRuntime,
} from '../../src/runtime/shell/docker.ts'

const exec = promisify(execFile)
const image = process.env.BAZILION_TEST_DOCKER_IMAGE ?? 'debian:bookworm-slim'
let home: string
let root: string
let db: BazilionDb
const cleanup: Array<() => Promise<unknown>> = []
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'baz040-recovery-'))
  root = join(home, 'workspace')
  mkdirSync(root)
  mkdirSync(join(root, 'app'))
  db = openDb(join(home, 'state.db'))
  runMigrations(db)
  db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('team', 'Team', 1)")
})
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn().catch(() => {})
  db.close()
  rmSync(home, { recursive: true, force: true })
})

describe.skipIf(process.env.BAZILION_TEST_DOCKER !== '1')(
  'coding Docker lifecycle recovery',
  () => {
    test('acknowledges create before start and preserves the real command exit code', async () => {
      const lifecycle = workspaceLifecycle(db)
      const lease = await lifecycle.claim('team', root, 'agent')
      const containers = lifecycle.containers(lease)
      const runtime = await preflightProtectedDockerRuntime({
        image,
        workspaceDir: root,
        coding: { revision: 1, cwd: 'app', env: { CI: 'true', NO_COLOR: '1', TZ: 'UTC' } },
        lifecycle: containers,
      })
      let output = ''
      const result = await createPreparedDockerBashOperations(runtime, containers).exec(
        'printf "%s|%s|%s|%s" "$PWD" "$CI" "$NO_COLOR" "$TZ"; exit 7',
        root,
        {
          timeout: 10,
          onData: (bytes) => {
            output += bytes.toString('utf8')
          },
        },
      )
      expect(result.exitCode).toBe(7)
      expect(output).toBe('/workspace/app|true|1|UTC')
      const rows = db.raw
        .query<{ creation_acknowledged: number; cleanup_confirmed: number }, []>(
          'SELECT creation_acknowledged, cleanup_confirmed FROM workspace_resources',
        )
        .all()
      expect(rows).toHaveLength(2)
      expect(
        rows.every((row) => row.creation_acknowledged === 1 && row.cleanup_confirmed === 1),
      ).toBe(true)
      await lifecycle.release(lease)
      expect(
        db.raw.query<{ count: number }, []>('SELECT count(*) AS count FROM workspace_writers').get()
          ?.count,
      ).toBe(0)
    }, 20000)

    test('restart keeps a missing unacknowledged create blocked until late materialization is actually removed', async () => {
      const lifecycle = workspaceLifecycle(db)
      const lease = await lifecycle.claim('team', root, 'agent')
      const engine = await preflightProtectedDockerEngine({ image })
      const containers = lifecycle.containers(lease, engine)
      const name = containers.name('bash')
      const env = { DOCKER_HOST: engine.endpoint }
      cleanup.push(() => exec(engine.dockerPath, ['container', 'rm', '--force', name], { env }))
      await containers.beforeCreate({
        dockerPath: engine.dockerPath,
        executableIdentity: engine.executableIdentity,
        endpoint: engine.endpoint,
        containerName: name,
      })
      // Simulate daemon loss after persisted registration but before a create acknowledgement.
      db.close()
      db = openDb(join(home, 'state.db'))
      const restarted = workspaceLifecycle(db)
      await expect(restarted.claim('team', root, 'agent')).rejects.toThrow(
        'workspace_recovery_required',
      )
      expect(
        db.raw
          .query<{ cleanup_confirmed: number }, []>(
            'SELECT cleanup_confirmed FROM workspace_resources',
          )
          .get()?.cleanup_confirmed,
      ).toBe(0)
      // The Docker-side creation appears only after recovery's exact-name misses.
      await exec(
        engine.dockerPath,
        [
          'container',
          'create',
          '--name',
          name,
          '--network',
          'none',
          '--entrypoint',
          '/bin/sh',
          engine.imageId,
          '-c',
          'exit 0',
        ],
        { env },
      )
      const admitted = await restarted.claim('team', root, 'agent')
      const existing = await exec(
        engine.dockerPath,
        ['container', 'ls', '--all', '--format', '{{.Names}}', '--filter', `name=^${name}$`],
        { env },
      )
      expect(existing.stdout.trim()).toBe('')
      await restarted.release(admitted)
    }, 20000)
  },
)
