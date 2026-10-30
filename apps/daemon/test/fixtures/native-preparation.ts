import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { CodingCommandReceipt } from '@bazilion/api-types'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import {
  createProfile,
  openConfig,
  openSecrets,
  providerStateRepo,
  resolveAgent,
  spawnAgent,
} from '../../src/core/index.ts'
import { resolvePaths } from '../../src/core/paths.ts'
import { putCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { ownsActiveAgent, registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { createCodingHost } from '../../src/lib/coding-environment/agent-host.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import {
  assertPreparedAgentNativeInputs,
  bindPreparedNativeInputs,
  prepareAgentNativeInputs,
} from '../../src/lib/native-execution/prepare.ts'
import {
  assertPreparedProtectedNativeExecution,
  bindPreparedProtectedNativeExecution,
  consumePreparedProtectedNativeExecution,
  prepareProtectedNativeExecution,
} from '../../src/lib/native-execution/protected.ts'
import { consumeNativeTurnForWorker } from '../../src/lib/native-execution/turn.ts'
import { resolveRepositoryContext } from '../../src/lib/repository-context/index.ts'

/** Actual daemon preparation/input capture, with no provider transport or receipt simulation. */
export async function runNativePreparationFixture(
  root: string,
  mode: 'configured' | 'inbox' = 'inbox',
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
  const team = registerTeam(db, { id: 'native-preparation', name: 'Native preparation' }, paths)
  createProfile(db, paths, {
    id: 'native-preparation',
    defaultModel: 'lmstudio:native-preparation-fixture',
  })
  const agent = resolveAgent(
    db,
    paths,
    spawnAgent(db, paths, { profileId: 'native-preparation', teamId: team.id }).id,
  )
  const workspace = agent.team.path
  mkdirSync(join(workspace, 'application'), { mode: 0o700 })
  mkdirSync(join(workspace, 'memory'), { recursive: true, mode: 0o700 })
  writeFileSync(join(workspace, 'memory', 'canary'), 'readonly-preparation', { flag: 'wx' })
  putCodingEnvironment(db, team.id, 0, {
    backend: 'native',
    cwd: 'application',
    env: { CI: 'true' },
  })
  const lifecycle = workspaceLifecycle(db),
    lease = lifecycle.coordinator.claim(team.id, workspace, 'agent'),
    controller = new AbortController()
  let completed = false,
    providerRequests = 0
  const projectionServer = createServer((_request, response) => {
    providerRequests++
    response.writeHead(503)
    response.end()
  })
  try {
    if (mode === 'configured') registerAgent(agent.agent.id, controller)
    const ctx = { db, paths, authToken: 'controlled-test-bootstrap' },
      options = {
        lease,
        controller,
        includeUploads: true,
        ...(mode === 'configured' ? { turnId: 'message-derived-attempt' } : {}),
      }
    await new Promise<void>((resolve) => projectionServer.listen(0, '127.0.0.1', resolve))
    const address = projectionServer.address()
    assert(address && typeof address !== 'string')
    openConfig(db).set('LMSTUDIO_URL', `http://127.0.0.1:${address.port}/v1`)
    openSecrets(db, ctx.authToken).set('LMSTUDIO_API_KEY', 'controlled-native-preparation-key')
    providerStateRepo.setEnabled(db, 'lmstudio', true)
    const protectedPreparation =
      mode === 'inbox' ? await prepareProtectedNativeExecution(ctx, agent, options) : undefined
    const prepared = protectedPreparation ?? (await prepareAgentNativeInputs(ctx, agent, options))
    if (protectedPreparation) {
      assert.equal(protectedPreparation.runtime.apiKey, 'controlled-native-preparation-key')
      assert.equal(prepared.host.env.LMSTUDIO_API_KEY, undefined)
    }
    assert.equal(prepared.nativeExecution.cwd, 'application')
    assert.equal(prepared.host.env.CI, 'true')
    assert.equal('image' in prepared.nativeExecution, false)
    assert.equal(prepared.paths.sessionDir, join(agent.agent.dir, 'sessions'))
    assert.ok(Object.isFrozen(prepared.paths.homeDocuments))
    const command = {
      toolCallId: 'prepared',
      cwd: 'application',
      timeoutMs: 5000,
      command: 'printf premature > premature',
    }
    assert.throws(() => prepared.host.exec(command, () => {}), /refused/)
    if (protectedPreparation)
      assert.throws(
        () => bindPreparedProtectedNativeExecution(protectedPreparation, 'message-derived-attempt'),
        /unavailable/,
      )
    assert.throws(
      () => assertPreparedAgentNativeInputs({ ...prepared }, agent, 'message-derived-attempt'),
      /unavailable/,
    )
    assert.equal(existsSync(join(workspace, 'application', 'premature')), false)
    if (mode === 'inbox') {
      registerAgent(agent.agent.id, controller)
      assert(protectedPreparation)
      bindPreparedProtectedNativeExecution(protectedPreparation, 'message-derived-attempt')
    }
    if (protectedPreparation) {
      assertPreparedProtectedNativeExecution(protectedPreparation, agent, 'message-derived-attempt')
      consumePreparedProtectedNativeExecution(
        protectedPreparation,
        agent,
        'message-derived-attempt',
      )
      assert.throws(
        () =>
          consumePreparedProtectedNativeExecution(
            protectedPreparation,
            agent,
            'message-derived-attempt',
          ),
        /not prepared/,
      )
      assert.throws(
        () => bindPreparedProtectedNativeExecution(protectedPreparation, 'another-attempt'),
        /not prepared/,
      )
    } else {
      assertPreparedAgentNativeInputs(prepared, agent, 'message-derived-attempt')
      assert.throws(() => bindPreparedNativeInputs(prepared, 'another-attempt'), /unavailable/)
    }
    consumeNativeTurnForWorker(prepared.host, {
      agentId: agent.agent.id,
      turnId: 'message-derived-attempt',
      teamId: team.id,
      registeredRoot: workspace,
      admission: prepared.nativeExecution,
    })
    assert.ok(prepared.paths.uploadsDir)
    const upload = join(prepared.paths.uploadsDir, 'late-input.txt')
    writeFileSync(upload, 'actual-staged-native-input', { flag: 'wx' })
    const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const execution = {
      ...command,
      command: `test "$CI" = true || exit 90; printf prepared > prepared.txt; cat ${quoted(upload)}; if printf forbidden > ${quoted(upload)} 2>/dev/null; then exit 91; fi; if printf forbidden > ../memory/canary 2>/dev/null; then exit 92; fi`,
    }
    const output: string[] = []
    const coding =
      mode === 'configured'
        ? createCodingHost({
            db,
            paths,
            agentId: agent.agent.id,
            teamId: team.id,
            turnId: 'message-derived-attempt',
            root: workspace,
            posture: 'native',
            imageId: null,
            native: prepared.host,
            values: {},
            secrets: [],
            assertActive() {
              assert.equal(ownsActiveAgent(agent.agent.id, controller), true)
            },
            context: (target) =>
              resolveRepositoryContext({ teamId: team.id, root: workspace, target }),
          })
        : undefined
    const started = coding
      ? ((await coding.invoke({
          action: 'start',
          toolCallId: command.toolCallId,
          input: {
            command: execution.command,
            cwd: execution.cwd,
            purpose: 'test',
            timeoutSeconds: 5,
          },
        })) as CodingCommandReceipt)
      : undefined
    const result = await prepared.host.exec(execution, (stream, bytes) => {
      if (stream === 'stdout') output.push(bytes.toString())
    })
    assert.equal(result.code, 0)
    assert.equal(output.join(''), 'actual-staged-native-input')
    assert.equal(readFileSync(upload, 'utf8'), 'actual-staged-native-input')
    assert.equal(readFileSync(join(workspace, 'memory', 'canary'), 'utf8'), 'readonly-preparation')
    assert.equal(readFileSync(join(workspace, 'application', 'prepared.txt'), 'utf8'), 'prepared')
    const count = db.raw.query('SELECT id FROM workspace_resources').all().length
    assert.equal(count, 2)
    if (coding && started) {
      assert.equal(await prepared.close(), true)
      const finished = (await coding.invoke({
        action: 'finish',
        id: started.id,
        outcome: {
          state: 'succeeded',
          exitCode: result.code,
          diagnostic: output.join(''),
          truncated: false,
          reason: null,
        },
        capture: { observedBytes: Buffer.byteLength(output.join('')), redacted: false },
      })) as CodingCommandReceipt
      assert.equal(finished.state, 'succeeded')
      assert.equal(finished.environment.posture, 'native')
      await assert.rejects(
        coding.invoke({
          action: 'start',
          toolCallId: 'no-new-effects',
          input: { command: 'printf forbidden', cwd: '.', purpose: 'test', timeoutSeconds: 5 },
        }),
        /refused/,
      )
    }
    unregisterAgent(agent.agent.id)
    if (mode === 'configured')
      assert.throws(
        () => prepared.host.exec({ ...command, toolCallId: 'inactive' }, () => {}),
        /refused/,
      )
    else
      await assert.rejects(
        prepared.host.exec({ ...command, toolCallId: 'inactive' }, () => {}),
        /unavailable/,
      )
    assert.equal(db.raw.query('SELECT id FROM workspace_resources').all().length, count)
    assert.equal(await prepared.close(), true)
    assert.deepEqual(
      db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
      [],
    )
    await lifecycle.release(lease)
    assert.deepEqual(db.raw.query('SELECT id FROM workspace_writers').all(), [])
    assert.equal(providerRequests, 0)
    completed = true
    return {
      backend: prepared.nativeExecution.facts.backend,
      nodeVersion: process.version,
      actualNativeReadiness: true,
      lateClaimBinding: mode === 'inbox',
      actualReadonlyInputs: true,
      resourcesSettled: true,
      providerTransport: 'none',
      productionBackendQualified: false,
    }
  } finally {
    if (projectionServer.listening)
      await new Promise<void>((resolve, reject) =>
        projectionServer.close((error) => (error ? reject(error) : resolve())),
      )
    if (ownsActiveAgent(agent.agent.id, controller)) unregisterAgent(agent.agent.id)
    if (completed) db.close()
    else console.error(`Native preparation fixture retained: ${root}`)
  }
}
