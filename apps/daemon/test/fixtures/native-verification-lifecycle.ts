import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLmStudioMock } from '../../../cli/test/fixtures/mock-lmstudio.ts'
import {
  createProfile,
  openConfig,
  openSecrets,
  providerStateRepo,
  spawnAgent,
  teamPolicyRepo,
} from '../../src/core/index.ts'
import { getCodingCommand } from '../../src/core/repos/coding-commands.ts'
import { putCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import {
  getVerificationRequestById,
  listVerificationAttempts,
  listVerificationCheckOutcomes,
} from '../../src/core/repos/verification-requests.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { isActiveAgent } from '../../src/lib/agent-cancel.ts'
import { closeCtxForShutdown, getCtx } from '../../src/lib/ctx.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { captureNativeOperatorVerificationRequest } from '../../src/lib/verification/capture.ts'
import {
  cancelVerificationDispatch,
  dispatchVerificationRequest,
} from '../../src/lib/verification/dispatch.ts'

function observeMarker(marker: string) {
  let stop = () => {}
  const observed = new Promise<void>((resolve, reject) => {
    let done = false
    const finish = (error?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      watcher.close()
      if (error) reject(error)
      else resolve()
    }
    const watcher = watch(dirname(marker), { persistent: false }, () => {
      if (existsSync(marker)) finish()
    })
    const timer = setTimeout(() => finish(new Error('controlled native check did not start')), 8000)
    stop = () => finish(new Error('controlled observation cancelled'))
    if (existsSync(marker)) finish()
  })
  void observed.catch(() => {})
  return { observed, stop: () => stop() }
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
/** Real native effects/owner cleanup with a controlled transport child; no model/provider execution. */
export async function runNativeVerificationLifecycleFixture(
  root: string,
  entryPath = fileURLToPath(new URL('./verification-disconnect-worker.mjs', import.meta.url)),
) {
  const saved = {
    home: process.env.BAZILION_HOME,
    scheduler: process.env.BAZILION_SCHEDULER,
    policy: process.env.BAZILION_TEAM_POLICY_ENFORCEMENT,
  }
  process.env.BAZILION_HOME = join(root, 'h')
  process.env.BAZILION_SCHEDULER = 'off'
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  const provider = await startLmStudioMock(),
    controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 35_000)
  timer.unref()
  let completed = false
  try {
    const ctx = getCtx()
    createProfile(ctx.db, ctx.paths, {
      id: 'native-verification-lifecycle',
      defaultModel: 'lmstudio:unused-lifecycle-fixture',
    })
    providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
    openConfig(ctx.db).set('LMSTUDIO_URL', provider.url)
    openConfig(ctx.db).set('BAZILION_BASH_SANDBOX', 'native')
    openSecrets(ctx.db, ctx.authToken).set('LMSTUDIO_API_KEY', 'controlled-unused-lifecycle-key')
    for (const mode of ['disconnect', 'cancel'] as const) {
      const team = registerTeam(
        ctx.db,
        { id: `native-verification-${mode}`, name: mode },
        ctx.paths,
      )
      const specialist = spawnAgent(ctx.db, ctx.paths, {
        profileId: 'native-verification-lifecycle',
        teamId: team.id,
      })
      const policy = teamPolicyRepo.get(ctx.db, team.id)
      assert(policy)
      teamPolicyRepo.replacePolicy(ctx.db, team.id, {
        expectedRevision: policy.revision,
        edges: [
          {
            sourceKind: 'user',
            sourceId: null,
            targetKind: 'agent',
            targetId: specialist.id,
            posture: 'allow',
          },
          {
            sourceKind: 'agent',
            sourceId: specialist.id,
            targetKind: 'user',
            targetId: null,
            posture: 'allow',
          },
        ],
      })
      writeFileSync(join(team.path, 'base.txt'), 'base\n')
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
      git('add', 'base.txt')
      git('commit', '-qm', 'base')
      putCodingEnvironment(ctx.db, team.id, 0, { backend: 'native', cwd: '.', env: {} })
      const snapshot = await captureTeamSnapshot(ctx.db, ctx.paths, team.id, {
        capturedBy: 'operator',
        base: 'HEAD',
      })
      const marker = join(team.path, 'entered'),
        late = join(team.path, 'must-not-run-after-loss'),
        workerTermMarker = join(team.path, 'worker-term')
      const captured = await captureNativeOperatorVerificationRequest(
        ctx.db,
        ctx.paths,
        {
          teamId: team.id,
          requesterKind: 'operator',
          requesterAgentId: null,
          recipientAgentId: specialist.id,
          snapshotId: snapshot.reference.id,
          summary: JSON.stringify({
            fixture: 'native-verification-lifecycle',
            marker,
            workerTermMarker,
            mode,
          }),
          checks: [
            {
              command: `printf entered > ${quote(marker)}; sleep 30; printf forbidden > ${quote(late)}`,
              cwd: '.',
              purpose: 'owned lifecycle',
              timeoutMs: 15000,
            },
          ],
          writablePaths: ['entered', 'must-not-run-after-loss', 'worker-term'],
        },
        controller.signal,
        () => [ctx.authToken, 'controlled-unused-lifecycle-key'],
      )
      assert.equal(captured.kind, 'captured')
      if (captured.kind !== 'captured') throw new Error('native lifecycle capture unavailable')
      const observation = observeMarker(marker)
      const dispatched = dispatchVerificationRequest(captured.request.id, {
        signal: controller.signal,
        workerEntryPath: entryPath,
      })
      try {
        await observation.observed
        if (mode === 'cancel') assert.equal(cancelVerificationDispatch(captured.request.id), true)
        await dispatched
      } finally {
        observation.stop()
        await dispatched
      }
      assert.equal(existsSync(marker), true)
      assert.equal(existsSync(late), false)
      assert.equal(isActiveAgent(specialist.id), false)
      const attempts = listVerificationAttempts(ctx.db, captured.request.id)
      assert.equal(attempts.length, 1)
      const attempt = attempts[0]
      assert(attempt)
      assert.equal(attempt.state, mode === 'cancel' ? 'cancelled' : 'failed')
      assert.equal(getVerificationRequestById(ctx.db, captured.request.id)?.state, attempt.state)
      const outcome = listVerificationCheckOutcomes(ctx.db, attempt.id)[0]
      assert.equal(outcome?.state, 'cancelled')
      assert(outcome.commandId)
      const receipt = getCodingCommand(ctx.db, outcome.commandId)
      assert.equal(receipt?.state, 'cancelled')
      assert.equal(receipt?.environment.posture, 'native')
      assert.deepEqual(receipt?.sourceBefore, snapshot.reference)
      // Ordering observation only, never process-signalling or cleanup authority.
      assert(receipt?.finishedAt)
      const workerTermAt = Number(readFileSync(workerTermMarker, 'utf8'))
      assert(Number.isSafeInteger(workerTermAt))
      assert(
        workerTermAt >= receipt.finishedAt,
        'worker retirement must follow native check settlement',
      )
      assert.deepEqual(ctx.db.raw.query('SELECT id FROM workspace_writers').all(), [])
      assert.deepEqual(
        ctx.db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
        [],
      )
      assert.equal(await dispatchVerificationRequest(captured.request.id), 'not_dispatchable')
      assert.equal(listVerificationAttempts(ctx.db, captured.request.id).length, 1)
    }
    assert.equal(provider.callCount(), 0)
    completed = true
    return {
      nodeVersion: process.version,
      actualNativeCommands: true,
      ownedRestrictedTransport: true,
      disconnectCancelsPendingCheck: true,
      operatorCancellation: true,
      receiptsFinalizedBeforeSettlement: true,
      nativeCheckSettledBeforeWorkerSignal: true,
      noAutomaticReplay: true,
      resourcesSettled: true,
      providerTransport: 'none',
      piSpecialistQualification: 'separate-real-SDK-fixture',
      productionNativeSelectionEnabled: false,
    }
  } finally {
    clearTimeout(timer)
    await provider.stop()
    if (completed) closeCtxForShutdown()
    else console.error(`Native verification lifecycle fixture retained: ${root}`)
    if (saved.home === undefined) delete process.env.BAZILION_HOME
    else process.env.BAZILION_HOME = saved.home
    if (saved.scheduler === undefined) delete process.env.BAZILION_SCHEDULER
    else process.env.BAZILION_SCHEDULER = saved.scheduler
    if (saved.policy === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = saved.policy
  }
}
