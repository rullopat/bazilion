import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { resolvePaths } from '../../src/core/paths.ts'
import { getCodingCommandLog } from '../../src/core/repos/coding-command-logs.ts'
import { getCodingCommand } from '../../src/core/repos/coding-commands.ts'
import {
  claimVerificationAttempt,
  createVerificationRequest,
  finishVerificationAttempt,
  listVerificationCheckOutcomes,
} from '../../src/core/repos/verification-requests.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { ownsActiveAgent, registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import type { WorkspaceLease } from '../../src/lib/coding-environment/workspace.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { type NativeTurnExecution, prepareNativeTurn } from '../../src/lib/native-execution/turn.ts'
import {
  NativeVerificationPreparationError,
  type PreparedNativeVerificationExecutor,
  prepareNativeVerificationExecutor,
} from '../../src/lib/verification/native-executor.ts'
import {
  createVerificationHost,
  settleVerificationAttempt,
} from '../../src/lib/verification/runner.ts'
import { classifyBashCommand } from '../../src/runtime/shell/security.ts'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
/** Actual kernel execution and durable receipts; no provider/worker/public-dispatch qualification. */
export async function runNativeVerificationExecutorFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-verification-')))
  const paths = resolvePaths(root)
  for (const path of [
    paths.profilesDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.logsDir,
    paths.teamsDir,
  ])
    mkdirSync(path, { recursive: true })
  const db = openDb(paths.db)
  runMigrations(db)
  const team = registerTeam(db, { id: 'native-verification', name: 'Native verification' }, paths)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  timer.unref()
  const lifecycle = workspaceLifecycle(db)
  let lease: WorkspaceLease | undefined,
    proof: NativeTurnExecution | undefined,
    prepared: PreparedNativeVerificationExecutor | undefined,
    completed = false
  try {
    db.raw.run(
      `INSERT INTO profiles(id,name,dir,default_model,created_at,updated_at)VALUES('native-profile','Native','p','lmstudio:fixture',1,1)`,
    )
    for (const id of ['native-coder', 'native-specialist'])
      db.raw.run(
        `INSERT INTO agents(id,profile_id,name,status,dir,team_id,created_at)VALUES(?,'native-profile',?,'idle',?,?,1)`,
        [id, id, paths.agentDir(id), team.id],
      )
    registerAgent('native-specialist', controller)
    mkdirSync(join(team.path, 'memory'), { recursive: true })
    writeFileSync(join(team.path, 'memory', 'readonly'), 'private-team-memory')
    writeFileSync(join(team.path, 'base.txt'), 'base\n')
    writeFileSync(join(team.path, 'danger-sentinel'), 'preserve\n')
    const git = (...args: string[]) =>
      execFileSync('/usr/bin/git', ['-C', team.path, ...args], {
        encoding: 'utf8',
        env: {
          PATH: '/usr/bin:/bin',
          HOME: root,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_AUTHOR_NAME: 'Fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
      }).trim()
    git('init', '-q', '-b', 'main')
    git('add', 'base.txt', 'danger-sentinel')
    git('commit', '-qm', 'base')
    lease = await lifecycle.claim(team.id, team.path, 'agent')
    const ownedLease = lease
    const proofRoot = realpathSync(mkdtempSync(join(tmpdir(), 'native-verification-capture-')))
    proof = await prepareNativeTurn({
      root: proofRoot,
      lifecycle,
      lease,
      cwd: '.',
      env: {},
      readOnlyDirectories: [],
      readOnlyFiles: [],
      unavailable: [],
      signal: controller.signal,
      assertActive() {
        assert(ownsActiveAgent('native-specialist', controller))
        lifecycle.coordinator.assertActiveLease(ownedLease, team.id, team.path)
      },
    })
    const capturedFacts = proof.facts
    assert.equal(await proof.close(), true)
    const snapshot = await captureTeamSnapshot(db, paths, team.id, {
      capturedBy: 'operator',
      base: 'HEAD',
    })
    const secret = 'native-verification-late-secret-value'
    const marker = join(team.path, 'native-check-started')
    const safe = `${quote(realpathSync(process.execPath))} --input-type=module - <<'NATIVE_CHECK'
import fs from 'node:fs'
fs.writeFileSync('native-check-started','started')
process.stdout.write('native-check:')
process.stdout.write(Buffer.from('${Buffer.from(secret).toString('hex')}','hex'))
NATIVE_CHECK
`
    // Same synthetic credential-access tripwire as the existing native worker approval fixture.
    const risky = 'printf "$LMSTUDIO_API_KEY" > approval-must-not-run'
    assert(classifyBashCommand(risky).length > 0)
    const commands = [
      safe,
      'printf forbidden > memory/unwritable',
      risky,
      'printf entered > timeout-started; sleep 30',
      `printf ${secret} > must-not-execute`,
    ]
    const captured: Parameters<typeof createVerificationRequest>[1] = {
      teamId: team.id,
      requesterKind: 'agent',
      requesterAgentId: 'native-coder',
      recipientAgentId: 'native-specialist',
      snapshotId: snapshot.reference.id,
      snapshotComplete: snapshot.reference.complete,
      head: snapshot.snapshot.head,
      baseOid: snapshot.snapshot.base.resolvedOid,
      environment: {
        sandbox: 'native',
        image: null,
        native: capturedFacts,
        inputScope: 'team-memory',
        cwd: '.',
        env: {},
        writablePaths: ['native-check-started', 'timeout-started'],
      },
      checks: commands.map((command, ordinal) => ({
        command,
        cwd: '.',
        purpose: 'native executor fixture',
        timeoutMs: ordinal === 3 ? 2000 : 5000,
      })),
    }
    const request = createVerificationRequest(db, captured)
    for (const kind of ['runtime', 'source'] as const) {
      const bad = createVerificationRequest(db, {
        ...captured,
        environment: {
          sandbox: 'native',
          image: null,
          inputScope: 'team-memory',
          cwd: '.',
          env: {},
          native:
            kind === 'runtime' ? { ...capturedFacts, fingerprint: '0'.repeat(64) } : capturedFacts,
        },
      })
      const badClaim = claimVerificationAttempt(db, {
        requestId: bad.id,
        leaseOwner: 'native-fixture',
        leaseMs: 60_000,
      })
      assert(badClaim)
      if (kind === 'source') writeFileSync(join(team.path, 'base.txt'), 'controlled source drift\n')
      await assert.rejects(
        prepareNativeVerificationExecutor({
          db,
          paths,
          requestId: bad.id,
          attemptId: badClaim.attempt.id,
          leaseOwner: 'native-fixture',
          lease,
          controller,
          secrets: () => [],
        }),
        (error: unknown) => {
          assert(error instanceof NativeVerificationPreparationError)
          if (error.observation)
            console.error(
              `Native verification preparation facts: ${JSON.stringify(error.observation)}`,
            )
          assert.equal(error.cleanupConfirmed, true)
          assert.equal(error.reason, kind === 'runtime' ? 'runtime_changed' : 'source_changed')
          return true
        },
      )
      if (kind === 'source') writeFileSync(join(team.path, 'base.txt'), 'base\n')
      assert.equal(existsSync(marker), false)
      assert.deepEqual(db.raw.query('SELECT id FROM coding_commands').all(), [])
      assert.deepEqual(
        db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
        [],
      )
      assert.equal(
        finishVerificationAttempt(db, {
          attemptId: badClaim.attempt.id,
          leaseOwner: 'native-fixture',
          state: 'failed',
          error: 'controlled frozen contract mismatch',
        }),
        true,
      )
    }
    const claim = claimVerificationAttempt(db, {
      requestId: request.id,
      leaseOwner: 'native-fixture',
      leaseMs: 60_000,
    })
    assert(claim)
    prepared = await prepareNativeVerificationExecutor({
      db,
      paths,
      requestId: request.id,
      attemptId: claim.attempt.id,
      leaseOwner: 'native-fixture',
      lease,
      controller,
      secrets: () => (existsSync(marker) ? [secret] : []),
    })
    assert.deepEqual(prepared.facts, capturedFacts)
    assert.equal(
      (
        await prepared.executor.run({
          ordinal: 0,
          command: 'touch unexpected',
          cwd: '.',
          timeoutMs: 5000,
          purpose: 'verification',
          writablePaths: request.environment.writablePaths ?? [],
        })
      ).state,
      'blocked',
    )
    assert.equal(existsSync(join(team.path, 'unexpected')), false)
    const host = createVerificationHost({
      db,
      request,
      attemptId: claim.attempt.id,
      executor: prepared.executor,
      applicability: 'identical',
    })
    const first = await host.invoke(0)
    assert.equal(first.state, 'succeeded')
    assert(first.commandId)
    assert(!first.output.includes(secret))
    assert(first.output.includes('[REDACTED]'))
    const receipt = getCodingCommand(db, first.commandId)
    assert.equal(receipt?.environment.posture, 'native')
    assert.equal(receipt?.environment.imageId, null)
    assert.deepEqual(receipt?.sourceBefore, snapshot.reference)
    assert.equal(receipt?.turnId, claim.attempt.id)
    const retained = getCodingCommandLog(db, first.commandId)
    assert(retained?.redacted)
    assert.equal(retained.releasedAt, null)
    const privateLog = db.raw
      .query<{ text: string }, [string]>('SELECT text FROM coding_command_logs WHERE command_id=?')
      .get(first.commandId)
    assert(privateLog && !privateLog.text.includes(secret))
    assert((retained.observedBytes ?? 0) >= Buffer.byteLength(secret))
    assert.equal((await host.invoke(1)).state, 'failed')
    assert.equal(existsSync(join(team.path, 'memory', 'unwritable')), false)
    assert.equal((await host.invoke(2)).state, 'blocked')
    assert.equal(existsSync(join(team.path, 'approval-must-not-run')), false)
    assert.equal(existsSync(join(team.path, 'danger-sentinel')), true)
    assert.equal((await host.invoke(3)).state, 'timed_out')
    assert.equal(existsSync(join(team.path, 'timeout-started')), true)
    const resources = db.raw.query('SELECT id FROM workspace_resources').all().length
    assert.equal((await host.invoke(4)).state, 'blocked')
    assert.equal(existsSync(join(team.path, 'must-not-execute')), false)
    assert.equal(db.raw.query('SELECT id FROM workspace_resources').all().length, resources)
    await assert.rejects(host.invoke(0), /already reported/)
    assert.equal(
      settleVerificationAttempt(db, {
        requestId: request.id,
        attemptId: claim.attempt.id,
        leaseOwner: 'native-fixture',
      }),
      'completed',
    )
    assert.deepEqual(
      listVerificationCheckOutcomes(db, claim.attempt.id).map((row) => row.state),
      ['succeeded', 'failed', 'blocked', 'timed_out', 'blocked'],
    )
    assert.equal(await prepared.close(), true)
    await lifecycle.release(lease)
    assert.deepEqual(db.raw.query('SELECT id FROM workspace_writers').all(), [])
    assert.deepEqual(
      db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
      [],
    )
    completed = true
    return {
      backend: capturedFacts.backend,
      nodeVersion: process.version,
      actualNativeExecution: true,
      frozenRuntimeMismatchRefused: true,
      capturedSourceDriftRefused: true,
      durableVerificationReceipts: true,
      liveRedaction: true,
      readonlyMemory: true,
      capturedTimeout: true,
      unattendedApprovalDenied: true,
      resourcesSettled: true,
      providerTransport: 'none',
      publicDispatchQualified: false,
    }
  } finally {
    clearTimeout(timer)
    if (!completed) {
      const observation = prepared?.failureObservation()
      if (observation)
        console.error(`Native verification failure facts: ${JSON.stringify(observation)}`)
      await prepared?.close().catch(() => false)
      await proof?.close().catch(() => false)
      if (lease) await lifecycle.release(lease).catch(() => {})
      console.error(`Native verification executor fixture retained: ${root}`)
    }
    if (ownsActiveAgent('native-specialist', controller)) unregisterAgent('native-specialist')
    if (completed) {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}
