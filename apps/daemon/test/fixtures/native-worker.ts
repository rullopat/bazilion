import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatFrame } from '@bazilion/api-types'
import { startLmStudioMock } from '../../../cli/test/fixtures/mock-lmstudio.ts'
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
import { getCodingCommandLog } from '../../src/core/repos/coding-command-logs.ts'
import { getCodingCommand } from '../../src/core/repos/coding-commands.ts'
import { putCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import { ownsActiveAgent, registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { type BashApprovalAudit, CommandApprovalRegistry } from '../../src/lib/bash-approval.ts'
import { createCodingHost } from '../../src/lib/coding-environment/agent-host.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import {
  assertPreparedAgentNativeInputs,
  prepareAgentNativeInputs,
} from '../../src/lib/native-execution/prepare.ts'
import {
  assertPreparedProtectedNativeExecution,
  consumePreparedProtectedNativeExecution,
  prepareProtectedNativeExecution,
} from '../../src/lib/native-execution/protected.ts'
import {
  assertNativeTurn,
  type NativeTurnExecution,
  nativeTurnFailureObservation,
} from '../../src/lib/native-execution/turn.ts'
import { resolveRepositoryContext } from '../../src/lib/repository-context/index.ts'
import type {
  ConfiguredOperatorHttpWorkerSpec,
  ProtectedWorkerSpec,
} from '../../src/runtime/worker/runtime.ts'
import { spawnWorkerTurn } from '../../src/runtime/worker/spawn.ts'
import { seedConversationTarget } from './conversation.ts'

/** Same actual preparation/worker/native/retention assertions on Linux and Mac; provider transport is synthetic. */
export async function runNativeWorkerFixture(
  kind: 'configured' | 'protected',
  controls: {
    onCodingStart?: () => void
    onNativeStart?: () => void
    interactive?: { tool: 'bash' | 'coding_command'; decision: 'allow' | 'deny' | 'cancel' }
  } = {},
) {
  const interactive = controls.interactive ? { ...controls.interactive } : undefined
  if (interactive) assert.equal(kind, 'configured')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-worker-'))),
    paths = resolvePaths(root)
  for (const directory of [
    paths.profilesDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.logsDir,
    join(root, 'worker-home'),
    join(root, 'worker-tmp'),
    join(paths.teamDir('one'), 'memory'),
    join(paths.teamDir('one'), 'application'),
  ])
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  const db = openDb(paths.db)
  runMigrations(db)
  db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', ['one', 'one', 1])
  createProfile(db, paths, {
    id: 'native-worker',
    defaultModel: 'lmstudio:native-worker-fixture',
  })
  const agent = resolveAgent(
    db,
    paths,
    spawnAgent(db, paths, { profileId: 'native-worker', teamId: 'one' }).id,
  )
  const workspace = agent.team.path,
    turnId = randomUUID()
  writeFileSync(join(workspace, 'memory', 'canary'), 'readonly-native-worker', { flag: 'wx' })
  const secret = 'controlled-daemon-native-output-secret'
  writeFileSync(join(workspace, 'planted-data.txt'), secret, { flag: 'wx', mode: 0o600 })
  const approvalCanary = join(workspace, 'approval-canary')
  if (interactive) mkdirSync(approvalCanary, { mode: 0o700 })
  const provider = await startLmStudioMock()
  const stop = new AbortController(),
    timer = setTimeout(() => stop.abort(), 25_000)
  timer.unref()
  const lifecycle = workspaceLifecycle(db),
    lease = lifecycle.coordinator.claim('one', workspace, 'agent')
  const approvalAudits: BashApprovalAudit[] = []
  const approvals = new CommandApprovalRegistry({ audit: (entry) => approvalAudits.push(entry) })
  let completed = false,
    native: NativeTurnExecution | undefined
  let restoreNativeLifecycle: (() => void) | undefined
  try {
    const authToken = 'controlled-native-fixture-bootstrap'
    openSecrets(db, authToken).set('SYNTHETIC_NATIVE_DATA_SECRET', secret)
    openSecrets(db, authToken).set('LMSTUDIO_API_KEY', 'synthetic-local-provider-key')
    putCodingEnvironment(db, 'one', 0, { backend: 'native', cwd: 'application', env: {} })
    registerAgent(agent.agent.id, stop)
    providerStateRepo.setEnabled(db, 'lmstudio', true)
    openConfig(db).set('LMSTUDIO_URL', provider.url)
    const preparationOptions = { lease, controller: stop, turnId, includeUploads: true }
    const protectedPreparation =
      kind === 'protected'
        ? await prepareProtectedNativeExecution({ db, paths, authToken }, agent, preparationOptions)
        : undefined
    const prepared =
      protectedPreparation ??
      (await prepareAgentNativeInputs({ db, paths, authToken }, agent, preparationOptions))
    if (protectedPreparation) {
      assertPreparedProtectedNativeExecution(protectedPreparation, agent, turnId)
      assert.throws(
        () => assertPreparedProtectedNativeExecution({ ...protectedPreparation }, agent, turnId),
        /not prepared/,
      )
      consumePreparedProtectedNativeExecution(protectedPreparation, agent, turnId)
      assert.throws(
        () => consumePreparedProtectedNativeExecution(protectedPreparation, agent, turnId),
        /not prepared/,
      )
      assert(Object.isFrozen(protectedPreparation.runtime))
    } else assertPreparedAgentNativeInputs(prepared, agent, turnId)
    const turn = prepared.host
    if (controls.onNativeStart) {
      const original = lifecycle.native
      restoreNativeLifecycle = () => {
        lifecycle.native = original
      }
      lifecycle.native = (...args) => {
        controls.onNativeStart?.()
        return original.apply(lifecycle, args)
      }
    }
    native = turn
    const quoted = (path: string) => `'${path.replaceAll("'", "'\\''")}'`
    const approvalCommand = `rm -rf ${quoted(approvalCanary)}; printf effect >> approval-count`
    provider.push([
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'native-worker-environment',
                  type: 'function',
                  function: {
                    name: 'coding_environment',
                    arguments: JSON.stringify({ target: '.' }),
                  },
                },
                {
                  id: 'native-worker-bash',
                  type: 'function',
                  function: {
                    name: 'bash',
                    arguments: JSON.stringify({
                      command: `test -z "$BAZILION_NATIVE_CONTROL_CANARY" || exit 92; printf native-worker-bash > bash-marker; cat ${quoted(join(workspace, 'planted-data.txt'))}; if printf forbidden > ${quoted(join(workspace, 'memory', 'canary'))} 2>/dev/null; then exit 91; fi`,
                      timeout: 5,
                    }),
                  },
                },
                {
                  id: 'native-worker-coding',
                  type: 'function',
                  function: {
                    name: 'coding_command',
                    arguments: JSON.stringify({
                      command: 'printf native-worker-coding > coding-marker; cat planted-data.txt',
                      cwd: '.',
                      purpose: 'test',
                      timeoutSeconds: 5,
                    }),
                  },
                },
                {
                  id: 'native-worker-credential-denied',
                  type: 'function',
                  function: {
                    name: 'bash',
                    arguments: JSON.stringify({
                      command: 'printf "$LMSTUDIO_API_KEY" > credential-forbidden',
                      timeout: 5,
                    }),
                  },
                },
                ...(interactive
                  ? [
                      {
                        id: 'native-worker-approval',
                        type: 'function',
                        function: {
                          name: interactive.tool,
                          arguments: JSON.stringify(
                            interactive.tool === 'bash'
                              ? { command: approvalCommand, timeout: 5 }
                              : {
                                  command: approvalCommand,
                                  cwd: '.',
                                  purpose: 'test',
                                  timeoutSeconds: 5,
                                },
                          ),
                        },
                      },
                    ]
                  : []),
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'native worker transport finished' },
          },
        ],
      },
    ])
    const repositoryContext = await resolveRepositoryContext({ teamId: 'one', root: workspace })
    const conversation = seedConversationTarget(join(agent.agent.dir, 'sessions'), workspace)
    const base = {
      agent,
      message: 'Execute the controlled native worker fixture tools.',
      turnId,
      repositoryContext,
      conversation,
      bashApprovalMode: interactive ? ('interactive' as const) : ('auto_deny' as const),
      nativeExecution: { cwd: turn.cwd, facts: turn.facts },
    }
    const canonicalCodingHost = createCodingHost({
      db,
      paths,
      agentId: agent.agent.id,
      teamId: 'one',
      turnId,
      root: workspace,
      posture: 'native',
      imageId: null,
      native: turn,
      values: {},
      context: (target) => resolveRepositoryContext({ teamId: 'one', root: workspace, target }),
      assertActive() {
        lifecycle.coordinator.assertActiveLease(lease, 'one', workspace)
      },
      secrets: () => [secret, 'synthetic-local-provider-key'],
    })
    const codingHost = {
      invoke(request: import('../../src/runtime/pi/coding-contract.ts').CodingRequest) {
        if (request.action === 'start') controls.onCodingStart?.()
        return canonicalCodingHost.invoke(request)
      },
    }
    const worker = lifecycle.nativeWorker(lease),
      hostCommands: boolean[] = []
    const resourceLifecycle = {
      ...worker,
      beforeInput(
        pid: number,
        host: boolean | undefined,
        child?: import('node:child_process').ChildProcess,
      ) {
        hostCommands.push(host === true)
        worker.beforeInput(pid, host, child)
      },
    }
    const opts = {
      signal: stop.signal,
      nativeExecutionHost: turn,
      nativeExecutionSecrets: () => [secret],
      resourceLifecycle,
      codingHost,
      repositoryContextHost: (target: string) =>
        resolveRepositoryContext({ teamId: 'one', root: workspace, target }),
      messagingHost: {
        agentExists: () => false,
        sendMessage: () => ({ messageId: 'unused' }),
        listInbox: () => [],
        markRead() {},
        findReplies: () => [],
        approvalStatus: () => null,
      },
      userMdHost: {
        get: () => ({ content: '', etag: 'unused' }),
        write: () => ({ etag: 'unused', totalBytes: 0 }),
      },
      bashApprovalHost: approvals,
    }
    const frames: ChatFrame[] = []
    const observeFrame = (frame: ChatFrame) => {
      frames.push(frame)
      if (frame.kind === 'event' && frame.event.type === 'command_approval') {
        const approval = frame.event.approval
        assert.equal(approval.agentId, agent.agent.id)
        assert.equal(approval.teamId, 'one')
        assert.equal(approval.turnId, turnId)
        if (approval.status === 'pending') {
          assert(interactive)
          const target = approval.toolCallId === 'native-worker-approval'
          if (target) {
            assert.equal(approval.command, approvalCommand)
            assert.equal(existsSync(approvalCanary), true)
            assert.equal(
              existsSync(
                join(
                  workspace,
                  interactive.tool === 'bash' ? 'application/approval-count' : 'approval-count',
                ),
              ),
              false,
            )
          }
          const decision = target ? interactive.decision : 'deny'
          if (decision === 'cancel') {
            assert.equal(turn.cancel(approval.toolCallId), true)
            assert.equal(approvals.respond(approval.id, 'allow').kind, 'conflict')
          } else {
            assert.equal(approvals.respond(approval.id, decision).kind, 'accepted')
            assert.equal(approvals.respond(approval.id, decision).kind, 'already_applied')
            assert.equal(
              approvals.respond(approval.id, decision === 'allow' ? 'deny' : 'allow').kind,
              'conflict',
            )
          }
        }
      }
    }
    if (kind === 'configured') {
      const spec: ConfiguredOperatorHttpWorkerSpec = {
        ...base,
        kind: 'configured_operator_http',
        enabledProviders: ['lmstudio'],
      }
      for await (const frame of spawnWorkerTurn(spec, {
        ...opts,
        env: {
          BAZILION_HOME: root,
          HOME: join(root, 'worker-home'),
          TMPDIR: join(root, 'worker-tmp'),
          TMP: join(root, 'worker-tmp'),
          TEMP: join(root, 'worker-tmp'),
          PATH: '/usr/bin:/bin',
          LANG: 'C',
          LC_ALL: 'C',
          LMSTUDIO_URL: provider.url,
          LMSTUDIO_API_KEY: 'synthetic-local-provider-key',
          BAZILION_NATIVE_CONTROL_CANARY: 'must-not-reach-command',
        },
      }))
        observeFrame(frame)
    } else {
      assert(protectedPreparation)
      const spec: ProtectedWorkerSpec = {
        ...base,
        kind: 'protected',
        bashApprovalMode: 'auto_deny',
        webFetchEnabled: true,
        runtime: protectedPreparation.runtime,
        paths: prepared.paths,
      }
      for await (const frame of spawnWorkerTurn(spec, {
        ...opts,
        apiKeyRefreshHost: { refresh: protectedPreparation.refreshApiKey },
      }))
        observeFrame(frame)
    }
    const serialized = JSON.stringify(frames)
    assert.deepEqual(
      frames.filter((frame) => frame.kind === 'fatal'),
      [],
      serialized,
    )
    assert.equal(frames.filter((frame) => frame.kind === 'done').length, 1, serialized)
    assert.equal(provider.callCount(), 2, serialized)
    assert.equal(
      readFileSync(join(workspace, 'application', 'bash-marker'), 'utf8'),
      'native-worker-bash',
    )
    assert.equal(readFileSync(join(workspace, 'coding-marker'), 'utf8'), 'native-worker-coding')
    assert.equal(
      readFileSync(join(workspace, 'memory', 'canary'), 'utf8'),
      'readonly-native-worker',
    )
    assert.deepEqual(hostCommands, [false])
    assert.equal(approvalAudits.length, interactive ? 2 : 1)
    assert.deepEqual(
      {
        agentId: approvalAudits[0]?.agentId,
        teamId: approvalAudits[0]?.teamId,
        turnId: approvalAudits[0]?.turnId,
        toolCallId: approvalAudits[0]?.toolCallId,
        status: approvalAudits[0]?.status,
      },
      {
        agentId: agent.agent.id,
        teamId: 'one',
        turnId,
        toolCallId: 'native-worker-credential-denied',
        status: interactive ? 'denied' : 'auto_denied',
      },
    )
    assert.equal(existsSync(join(workspace, 'credential-forbidden')), false)
    assert.equal(serialized.includes(secret), false)
    assert(serialized.includes('[REDACTED]'))
    const transcript = readFileSync(
      join(agent.agent.dir, 'sessions', conversation.filename),
      'utf8',
    )
    assert.equal(transcript.includes(secret), false)
    assert(transcript.includes('[REDACTED]'))
    const results = transcript
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => row.type === 'message' && row.message?.role === 'toolResult')
      .map((row) => row.message)
    assert.equal(results.length, interactive ? 5 : 4)
    const reported = JSON.parse(
      results.find((row) => row.toolCallId === 'native-worker-environment')?.content?.[0]?.text ??
        'null',
    )
    assert.equal(reported?.posture, 'native')
    assert.equal(reported?.imageId, null)
    assert.equal(reported?.native?.fingerprint, turn.facts.fingerprint)
    assert.equal(results.find((row) => row.toolCallId === 'native-worker-bash')?.isError, false)
    assert.equal(results.find((row) => row.toolCallId === 'native-worker-coding')?.isError, false)
    assert.equal(
      results.find((row) => row.toolCallId === 'native-worker-credential-denied')?.isError,
      true,
    )
    assert.deepEqual(
      results.find((row) => row.toolCallId === 'native-worker-credential-denied')?.content,
      [{ type: 'text', text: 'Dangerous native command denied' }],
    )
    assert.throws(() => assertNativeTurn(turn), /refused/)
    assert.equal(await turn.close(), true)
    assert.deepEqual(
      db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
      [],
    )
    const expectedResources = interactive?.decision === 'allow' ? 5 : 4
    assert.equal(db.raw.query('SELECT id FROM workspace_resources').all().length, expectedResources)
    if (interactive) {
      const approvalResult = results.find((row) => row.toolCallId === 'native-worker-approval')
      assert(approvalResult)
      if (interactive.tool === 'bash')
        assert.equal(approvalResult.isError, interactive.decision !== 'allow')
      assert.equal(existsSync(approvalCanary), interactive.decision !== 'allow')
      const marker = join(
        workspace,
        interactive.tool === 'bash' ? 'application/approval-count' : 'approval-count',
      )
      assert.equal(existsSync(marker), interactive.decision === 'allow')
      if (interactive.decision === 'allow') assert.equal(readFileSync(marker, 'utf8'), 'effect')
      assert.equal(
        approvalAudits[1]?.status,
        interactive.decision === 'allow'
          ? 'allowed'
          : interactive.decision === 'cancel'
            ? 'cancelled'
            : 'denied',
      )
      assert.equal(approvalAudits[1]?.toolCallId, 'native-worker-approval')
    }
    const rows = db.raw.query<{ id: string }, []>('SELECT id FROM coding_commands').all()
    assert.equal(rows.length, interactive?.tool === 'coding_command' ? 2 : 1)
    const receipts = rows.map((row) => getCodingCommand(db, row.id))
    if (interactive?.tool === 'coding_command') {
      const approved = receipts.find((value) => value?.toolCallId === 'native-worker-approval')
      assert.equal(
        approved?.state,
        interactive.decision === 'allow'
          ? 'succeeded'
          : interactive.decision === 'cancel'
            ? 'cancelled'
            : 'blocked',
      )
      assert.equal(approved?.input.command, approvalCommand)
    }
    const receipt = receipts.find((value) => value?.toolCallId === 'native-worker-coding')
    assert(receipt)
    assert.equal(receipt.environment.posture, 'native')
    assert.equal(receipt.environment.imageId, null)
    assert.equal(receipt.environment.native?.fingerprint, turn.facts.fingerprint)
    assert.equal(receipt.state, 'succeeded')
    assert.equal(receipt.diagnostic, '[REDACTED]')
    const log = getCodingCommandLog(db, receipt.id)
    assert.equal(log.releasedAt, null)
    assert.equal(log.availability, 'available')
    assert.equal(log.observedBytes, Buffer.byteLength(secret))
    assert.equal(log.redacted, true)
    assert.equal(log.byteLength, Buffer.byteLength('[REDACTED]'))
    await lifecycle.release(lease)
    assert.deepEqual(db.raw.query('SELECT id FROM workspace_writers').all(), [])
    assert.equal(stop.signal.aborted, false)
    db.close()
    completed = true
    return {
      kind,
      runtime: turn.facts,
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      providerTransport: 'synthetic-loopback',
      receiptLifecycle: 'actual-native-private-retention',
      nativeExecution: 'actual',
      readonlyMemoryUnchanged: true,
      controlEnvironmentAbsent: true,
      unattendedCredentialAccessDenied: true,
      redactedBeforeWorkerTranscript: true,
      workerHostCommands: false,
      interactiveApproval: interactive,
      closedResources: expectedResources,
      writerReleased: true,
      productionBackendQualified: false,
    }
  } catch (cause) {
    console.error(
      JSON.stringify({
        phase: 'native-worker-failure',
        retained: root,
        observation: native ? nativeTurnFailureObservation(native) : undefined,
        originalRunFailed: true,
      }),
    )
    // This is canonical teardown with the same live owners, not a command retry or a pass. Keep
    // the failed home even if a later independent proof can positively settle its resources.
    let cleanupConfirmed = false
    try {
      await lifecycle.release(lease)
      cleanupConfirmed = db.raw.query('SELECT id FROM workspace_writers').all().length === 0
    } catch {
      /* Unknown ownership remains retained. */
    }
    const templateRetired =
      cleanupConfirmed && native ? await native.close().catch(() => false) : false
    console.error(
      JSON.stringify({
        phase: 'native-worker-failure-teardown',
        templateRetired,
        canonicalResourcesConfirmed: cleanupConfirmed,
        originalRunFailed: true,
        effectsReplayed: false,
      }),
    )
    throw new Error(`Native worker integration failed; retained ${root}`, { cause })
  } finally {
    clearTimeout(timer)
    restoreNativeLifecycle?.()
    approvals.cancelAll()
    if (ownsActiveAgent(agent.agent.id, stop)) unregisterAgent(agent.agent.id)
    await provider.stop()
    if (completed) rmSync(root, { recursive: true })
  }
}
