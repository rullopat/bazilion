import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { resolvePaths } from '../../src/core/paths.ts'
import { getCodingCommand } from '../../src/core/repos/coding-commands.ts'
import { putCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import * as teamPolicyRepo from '../../src/core/repos/teamPolicies.ts'
import { listVerificationAttempts } from '../../src/core/repos/verification-requests.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { ownsActiveAgent, registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import type { WorkspaceLease } from '../../src/lib/coding-environment/workspace.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import {
  admitVerificationRequest,
  VERIFICATION_DISPATCH_OWNER,
} from '../../src/lib/verification/admission.ts'
import {
  admittedEnvironment,
  captureNativeOperatorVerificationRequest,
  captureVerificationRequest,
  type VerificationCaptureIntent,
} from '../../src/lib/verification/capture.ts'
import { prepareNativeOperatorVerificationCapture } from '../../src/lib/verification/native-capture.ts'
import {
  type PreparedNativeVerificationExecutor,
  prepareNativeVerificationExecutor,
} from '../../src/lib/verification/native-executor.ts'
import {
  createVerificationHost,
  settleVerificationAttempt,
} from '../../src/lib/verification/runner.ts'

/** Real capture/admission/executor, without a provider, specialist worker or public selector. */
export async function runNativeVerificationCaptureFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-verification-capture-flow-')))
  const paths = resolvePaths(root),
    db = openDb(paths.db)
  runMigrations(db)
  for (const path of [
    paths.profilesDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.logsDir,
    paths.teamsDir,
  ])
    mkdirSync(path, { recursive: true })
  const team = registerTeam(db, { id: 'capture-team', name: 'Native capture' }, paths)
  const controller = new AbortController(),
    lifecycle = workspaceLifecycle(db)
  const previousPolicy = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  const timer = setTimeout(() => controller.abort(), 45_000)
  timer.unref()
  let lease: WorkspaceLease | undefined,
    prepared: PreparedNativeVerificationExecutor | undefined,
    completed = false
  try {
    process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
    db.raw.run(
      `INSERT INTO profiles(id,name,dir,default_model,created_at,updated_at)VALUES('capture-profile','Capture','p','lmstudio:fixture',1,1)`,
    )
    db.raw.run(
      `INSERT INTO agents(id,profile_id,name,status,dir,team_id,created_at)VALUES('capture-specialist','capture-profile','Specialist','idle',?,?,1)`,
      [paths.agentDir('capture-specialist'), team.id],
    )
    mkdirSync(join(team.path, 'application'), { recursive: true })
    mkdirSync(join(team.path, 'memory'), { recursive: true })
    writeFileSync(join(team.path, 'application', 'base.txt'), 'base\n')
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
    git('add', 'application/base.txt')
    git('commit', '-qm', 'base')
    const snapshot = await captureTeamSnapshot(db, paths, team.id, {
      capturedBy: 'operator',
      base: 'HEAD',
    })
    const command = 'printf captured-native; printf "$CI:$TZ"; printf "\\n"; pwd'
    const intent: VerificationCaptureIntent = {
      teamId: team.id,
      requesterKind: 'operator',
      requesterAgentId: null,
      recipientAgentId: 'capture-specialist',
      snapshotId: snapshot.reference.id,
      checks: [{ command, cwd: 'application', purpose: 'capture fixture', timeoutMs: 5000 }],
    }
    // Legacy selection is usable here, making a fake-token fallback observable rather than masked.
    assert.equal(admittedEnvironment(db, team.id, {})?.sandbox, 'off')
    assert.equal(
      captureVerificationRequest(db, paths, intent, {}, { kind: 'native-verification-capture' })
        .kind,
      'blocked',
    )
    assert.deepEqual(db.raw.query('SELECT id FROM verification_requests').all(), [])
    putCodingEnvironment(db, team.id, 0, {
      backend: 'native',
      cwd: 'application',
      env: { CI: 'true', TZ: 'UTC' },
    })
    const invalid = await captureNativeOperatorVerificationRequest(
      db,
      paths,
      { ...intent, recipientAgentId: 'missing-specialist' },
      controller.signal,
      () => [],
    )
    assert.equal(invalid.kind, 'blocked')
    assert.deepEqual(db.raw.query('SELECT id FROM workspace_resources').all(), [])
    const protectedValue = 'controlled-native-capture-protected-value'
    const protectedIntent = {
      ...intent,
      checks: [
        {
          command: `printf ${protectedValue}`,
          cwd: 'application',
          purpose: 'credential refusal',
          timeoutMs: 5000,
        },
      ],
    }
    assert.equal(
      (
        await captureNativeOperatorVerificationRequest(
          db,
          paths,
          protectedIntent,
          controller.signal,
          () => [protectedValue],
        )
      ).kind,
      'blocked',
    )
    assert.deepEqual(db.raw.query('SELECT id FROM workspace_resources').all(), [])
    let lateSecrets: readonly string[] = []
    const late = await prepareNativeOperatorVerificationCapture({
      db,
      paths,
      intent: protectedIntent,
      signal: controller.signal,
      secrets: () => lateSecrets,
    })
    assert.equal(late.kind, 'prepared')
    if (late.kind !== 'prepared') throw new Error('late-secret capture observation unavailable')
    lateSecrets = [protectedValue]
    assert.equal(
      captureVerificationRequest(db, paths, late.intent, undefined, late.capture).kind,
      'blocked',
    )
    assert.deepEqual(db.raw.query('SELECT id FROM verification_requests').all(), [])
    const firstCheck = intent.checks[0]
    assert(firstCheck)
    const mutableChecks = [{ ...firstCheck }]
    const pending = prepareNativeOperatorVerificationCapture({
      db,
      paths,
      intent: { ...intent, checks: mutableChecks },
      signal: controller.signal,
      secrets: () => [],
    })
    const mutable = mutableChecks[0]
    assert(mutable)
    mutable.command = 'printf injected > must-not-run'
    const observation = await pending
    assert.equal(observation.kind, 'prepared')
    if (observation.kind !== 'prepared') throw new Error('native capture observation unavailable')
    assert.equal(observation.intent.checks[0]?.command, command)
    assert.equal(
      captureVerificationRequest(
        db,
        paths,
        observation.intent,
        undefined,
        JSON.parse(JSON.stringify(observation.capture)),
      ).kind,
      'blocked',
    )
    assert.equal(
      captureVerificationRequest(
        db,
        paths,
        { ...observation.intent, summary: 'retagged' },
        undefined,
        observation.capture,
      ).kind,
      'blocked',
    )
    assert.deepEqual(db.raw.query('SELECT id FROM verification_requests').all(), [])
    const captured = captureVerificationRequest(
      db,
      paths,
      observation.intent,
      undefined,
      observation.capture,
    )
    assert.equal(captured.kind, 'captured')
    if (captured.kind !== 'captured') throw new Error('native capture refused')
    assert.equal(captured.request.environment.sandbox, 'native')
    assert.equal(captured.request.environment.image, null)
    assert.deepEqual(captured.request.environment.env, { CI: 'true', TZ: 'UTC' })
    assert.equal(
      captureVerificationRequest(db, paths, observation.intent, undefined, observation.capture)
        .kind,
      'blocked',
    )
    assert.deepEqual(db.raw.query('SELECT id FROM workspace_writers').all(), [])
    const policy = teamPolicyRepo.get(db, team.id)
    assert(policy)
    teamPolicyRepo.replacePolicy(db, team.id, { expectedRevision: policy.revision, edges: [] })
    const denied = await admitVerificationRequest(db, paths, captured.request.id)
    assert.equal(denied.kind, 'blocked')
    if (denied.kind === 'blocked') assert.equal(denied.blocker.reason, 'policy_denied')
    assert.deepEqual(listVerificationAttempts(db, captured.request.id), [])
    const current = teamPolicyRepo.get(db, team.id)
    assert(current)
    teamPolicyRepo.replacePolicy(db, team.id, {
      expectedRevision: current.revision,
      edges: [
        {
          sourceKind: 'user',
          sourceId: null,
          targetKind: 'agent',
          targetId: 'capture-specialist',
          posture: 'allow',
        },
      ],
    })
    const allowed = await captureNativeOperatorVerificationRequest(
      db,
      paths,
      intent,
      controller.signal,
      () => [],
    )
    assert.equal(allowed.kind, 'captured')
    if (allowed.kind !== 'captured') throw new Error('native operator capture unavailable')
    registerAgent('capture-specialist', controller)
    const admission = await admitVerificationRequest(db, paths, allowed.request.id)
    assert.equal(admission.kind, 'admitted')
    if (admission.kind !== 'admitted') throw new Error('native request not admitted')
    lease = admission.workspace
    prepared = await prepareNativeVerificationExecutor({
      db,
      paths,
      requestId: allowed.request.id,
      attemptId: admission.claim.attempt.id,
      leaseOwner: VERIFICATION_DISPATCH_OWNER,
      lease,
      controller,
      secrets: () => [],
    })
    const host = createVerificationHost({
      db,
      request: allowed.request,
      attemptId: admission.claim.attempt.id,
      executor: prepared.executor,
      applicability: 'identical',
    })
    const outcome = await host.invoke(0)
    assert.equal(outcome.state, 'succeeded')
    assert(outcome.commandId)
    assert(outcome.output.includes('captured-nativetrue:UTC'))
    assert(outcome.output.includes('application'))
    const receipt = getCodingCommand(db, outcome.commandId)
    assert.equal(receipt?.environment.posture, 'native')
    assert.deepEqual(receipt?.sourceBefore, snapshot.reference)
    assert.equal(
      settleVerificationAttempt(db, {
        requestId: allowed.request.id,
        attemptId: admission.claim.attempt.id,
        leaseOwner: VERIFICATION_DISPATCH_OWNER,
      }),
      'completed',
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
      backend: prepared.facts.backend,
      nodeVersion: process.version,
      actualNativeCapture: true,
      knownAndLateCredentialCommandsRefusedBeforeDisclosure: true,
      forgedRetaggedReplayedObservationsRefused: true,
      intentSnapshottedBeforeAwait: true,
      policyDenyThenAllow: true,
      canonicalAdmission: true,
      actualCapturedExecution: true,
      resourcesSettled: true,
      providerTransport: 'none',
      publicSelectorQualified: false,
      specialistWorkerQualified: false,
    }
  } finally {
    clearTimeout(timer)
    if (!completed) {
      await prepared?.close().catch(() => false)
      if (lease) await lifecycle.release(lease).catch(() => {})
      console.error(`Native verification capture fixture retained: ${root}`)
    }
    if (ownsActiveAgent('capture-specialist', controller)) unregisterAgent('capture-specialist')
    if (previousPolicy === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = previousPolicy
    if (completed) {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}
