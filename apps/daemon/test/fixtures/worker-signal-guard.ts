import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChatFrame } from '@bazilion/api-types'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { createProfile, resolveAgent, spawnAgent } from '../../src/core/index.ts'
import { resolvePaths } from '../../src/core/paths.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { resolveRepositoryContext } from '../../src/lib/repository-context/index.ts'
import { spawnWorkerTurn } from '../../src/runtime/worker/spawn.ts'
import { seedConversationTarget } from './conversation.ts'

export type WorkerSignalGuardMode = 'deny_term' | 'deny_kill' | 'cancel_before_input'
/** A real trusted transport child and canonical owner; not a sandbox or provider simulation. */
export async function runWorkerSignalGuardFixture(
  root: string,
  mode: WorkerSignalGuardMode,
  entryPath = fileURLToPath(new URL('./worker-signal-guard-entry.mjs', import.meta.url)),
) {
  const paths = resolvePaths(join(root, 'h'))
  for (const directory of [
    paths.profilesDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.logsDir,
    paths.teamsDir,
  ])
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  const db = openDb(paths.db)
  runMigrations(db)
  const team = registerTeam(db, { id: 'signal-guard', name: 'Signal guard' }, paths)
  createProfile(db, paths, {
    id: 'signal-guard',
    defaultModel: 'lmstudio:unused-transport-fixture',
  })
  const agent = resolveAgent(
    db,
    paths,
    spawnAgent(db, paths, { profileId: 'signal-guard', teamId: team.id }).id,
  )
  const lifecycle = workspaceLifecycle(db),
    lease = lifecycle.coordinator.claim(team.id, team.path, 'agent'),
    worker = lifecycle.worker(lease),
    controller = new AbortController()
  let signalsChecked = 0,
    normalExit = false,
    completed = false,
    caught: unknown
  const frames: ChatFrame[] = []
  try {
    assert.throws(() => worker.beforeSignal?.(), /ownership is not registered/)
    const context = await resolveRepositoryContext({ teamId: team.id, root: team.path })
    const conversation = seedConversationTarget(join(agent.agent.dir, 'sessions'), team.path)
    try {
      for await (const frame of spawnWorkerTurn(
        {
          kind: 'configured_operator_http',
          agent,
          message: mode === 'deny_kill' ? 'ignore-term' : 'controlled-transport',
          turnId: 'signal-guard-turn',
          conversation,
          repositoryContext: context,
          enabledProviders: [],
          bashApprovalMode: 'auto_deny',
        },
        {
          env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root },
          signal: controller.signal,
          workerEntryPath: entryPath,
          resourceLifecycle: {
            ...worker,
            beforeInput(pid, hostCommands, child) {
              worker.beforeInput(pid, hostCommands, child)
              if (mode === 'cancel_before_input') controller.abort()
            },
            beforeSignal() {
              signalsChecked++
              if (mode !== 'deny_kill' || signalsChecked > 1)
                throw new Error('controlled signal guard refusal')
              worker.beforeSignal?.()
            },
            async afterExit(normal) {
              normalExit = normal === true
              return worker.afterExit(normal)
            },
          },
        },
      )) {
        frames.push(frame)
        if (
          frame.kind === 'event' &&
          frame.event.type === 'assistant_delta' &&
          frame.event.delta === 'signal-guard-ready'
        )
          controller.abort()
      }
    } catch (error) {
      caught = error
    }
    if (mode === 'cancel_before_input') {
      assert(caught instanceof Error)
      assert.match(caught.message, /abort/i)
      assert.equal(existsSync(join(team.path, 'input-released')), false)
    } else {
      assert.equal(caught, undefined)
      assert.deepEqual(
        frames.filter((frame) => frame.kind === 'fatal'),
        [],
      )
      assert.equal(frames.filter((frame) => frame.kind === 'done').length, 1)
      assert.equal(existsSync(join(team.path, 'input-released')), true)
    }
    assert(signalsChecked >= (mode === 'deny_kill' ? 2 : 1))
    assert.equal(normalExit, true)
    assert.deepEqual(
      db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
      [],
    )
    await lifecycle.release(lease)
    assert.deepEqual(db.raw.query('SELECT id FROM workspace_writers').all(), [])
    completed = true
    return {
      node: process.version,
      platform: process.platform,
      mode,
      guardRefusalRespected: true,
      trustedChildNaturalExit: true,
      executableInputWithheld: mode === 'cancel_before_input',
      canonicalResourcesSettled: true,
      providerTransport: 'none',
    }
  } finally {
    if (completed) db.close()
    else console.error(`Signal guard fixture retained: ${root}`)
  }
}
