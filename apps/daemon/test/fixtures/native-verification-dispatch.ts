import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { sseFromCanned, startLmStudioMock } from '../../../cli/test/fixtures/mock-lmstudio.ts'
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
import { dispatchVerificationRequest } from '../../src/lib/verification/dispatch.ts'

/** Canonical daemon dispatch and real restricted Pi worker; provider transport is synthetic only. */
export async function runCanonicalNativeVerificationFixture(root: string) {
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
  let scenarioFailure: unknown
  try {
    const ctx = getCtx()
    const team = registerTeam(
      ctx.db,
      { id: 'native-verification-dispatch', name: 'Native verification dispatch' },
      ctx.paths,
    )
    createProfile(ctx.db, ctx.paths, {
      id: 'native-verification-dispatch',
      defaultModel: 'lmstudio:native-verification-dispatch',
    })
    const specialist = spawnAgent(ctx.db, ctx.paths, {
      profileId: 'native-verification-dispatch',
      teamId: team.id,
    })
    providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
    openConfig(ctx.db).set('LMSTUDIO_URL', provider.url)
    openConfig(ctx.db).set('BAZILION_BASH_SANDBOX', 'native')
    const selectedKey = 'controlled-native-verification-provider-key',
      secret = 'controlled-native-verification-output-secret'
    openSecrets(ctx.db, ctx.authToken).set('LMSTUDIO_API_KEY', selectedKey)
    openSecrets(ctx.db, ctx.authToken).set('SYNTHETIC_NATIVE_SECRET', secret)
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
    mkdirSync(join(team.path, 'application'), { mode: 0o700 })
    writeFileSync(join(team.path, 'planted.txt'), secret, { mode: 0o600 })
    writeFileSync(join(team.path, 'application', 'base.txt'), 'base\n')
    writeFileSync(join(team.path, 'memory', 'canary'), 'readonly')
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
    git('add', 'application/base.txt', 'planted.txt')
    git('commit', '-qm', 'base')
    putCodingEnvironment(ctx.db, team.id, 0, {
      backend: 'native',
      cwd: 'application',
      env: { CI: 'true' },
    })
    const snapshot = await captureTeamSnapshot(ctx.db, ctx.paths, team.id, {
      capturedBy: 'operator',
      base: 'HEAD',
    })
    const captured = await captureNativeOperatorVerificationRequest(
      ctx.db,
      ctx.paths,
      {
        teamId: team.id,
        requesterKind: 'operator',
        requesterAgentId: null,
        recipientAgentId: specialist.id,
        snapshotId: snapshot.reference.id,
        checks: [
          {
            command: 'printf x >> executed-once; cat ../planted.txt',
            cwd: 'application',
            purpose: 'redacted evidence',
            timeoutMs: 5000,
          },
          {
            command: 'printf forbidden > ../memory/blocked',
            cwd: 'application',
            purpose: 'readonly refusal',
            timeoutMs: 5000,
          },
          {
            command: 'printf "$LMSTUDIO_API_KEY" > credential-forbidden',
            cwd: 'application',
            purpose: 'unattended refusal',
            timeoutMs: 5000,
          },
        ],
        writablePaths: ['application/executed-once'],
      },
      controller.signal,
      () => [ctx.authToken, selectedKey, secret],
    )
    assert.equal(captured.kind, 'captured')
    if (captured.kind !== 'captured') throw new Error('native canonical capture unavailable')
    let workerOwnershipObserved = false,
      requests = 0
    const steps: [string, Record<string, unknown>][] = [
      ['verification_request', {}],
      ['verification_check', { ordinal: 0 }],
      ['verification_check', { ordinal: 7 }],
      ['verification_check', { ordinal: 0 }],
      ['verification_check', { ordinal: 1 }],
      ['verification_check', { ordinal: 2 }],
      [
        'bash',
        {
          command: `printf forbidden > '${join(team.path, 'application', 'unadmitted-escape').replaceAll("'", "'\\''")}'`,
        },
      ],
    ]
    const handler = (step: number) => (request: IncomingMessage, response: ServerResponse) => {
      let body = ''
      request.on('data', (bytes) => {
        body += bytes.toString()
      })
      request.on('end', () => {
        try {
          requests++
          assert(Buffer.byteLength(body) < 2 * 1024 * 1024)
          const parsed = JSON.parse(body)
          assert.deepEqual(
            (parsed.tools ?? [])
              .map((tool: { function: { name: string } }) => tool.function.name)
              .sort(),
            ['verification_check', 'verification_request'],
          )
          assert(!body.includes(secret))
          assert(!body.includes(selectedKey))
          assert(!body.includes(ctx.authToken))
          const workers = ctx.db.raw
            .query<{ identity_json: string }, []>(
              "SELECT identity_json FROM workspace_resources WHERE kind='worker' AND cleanup_confirmed=0",
            )
            .all()
          workerOwnershipObserved ||= workers.some((row) => {
            const value = JSON.parse(row.identity_json)
            return value.kind !== 'native-command' && value.hostCommands === false
          })
          const tool = steps[step]
          if (tool)
            sseFromCanned(response, {
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: `canonical-verification-${step}`,
                        type: 'function',
                        function: { name: tool[0], arguments: JSON.stringify(tool[1]) },
                      },
                    ],
                  },
                },
              ],
            })
          else
            sseFromCanned(response, {
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: 'All checks passed. This model claim must not change executor facts.',
                  },
                },
              ],
            })
        } catch (error) {
          scenarioFailure = error
          response.writeHead(500)
          response.end('controlled fixture scenario mismatch')
        }
      })
    }
    provider.push(Array.from({ length: steps.length + 1 }, (_, index) => handler(index)))
    assert.equal(
      await dispatchVerificationRequest(captured.request.id, { signal: controller.signal }),
      'dispatched',
    )
    if (scenarioFailure) throw scenarioFailure
    assert.equal(requests, steps.length + 1)
    assert(workerOwnershipObserved)
    assert.equal(isActiveAgent(specialist.id), false)
    const attempts = listVerificationAttempts(ctx.db, captured.request.id)
    assert.equal(attempts.length, 1)
    const attempt = attempts[0]
    assert(attempt)
    assert.equal(attempt.state, 'completed')
    assert.equal(getVerificationRequestById(ctx.db, captured.request.id)?.state, 'completed')
    const outcomes = listVerificationCheckOutcomes(ctx.db, attempt.id)
    assert.deepEqual(
      outcomes.map((value) => value.state),
      ['succeeded', 'failed', 'blocked'],
    )
    for (const outcome of outcomes.slice(0, 2)) {
      assert(outcome.commandId)
      const receipt = getCodingCommand(ctx.db, outcome.commandId)
      assert.equal(receipt?.environment.posture, 'native')
      assert.equal(receipt?.environment.imageId, null)
      assert.deepEqual(receipt?.sourceBefore, snapshot.reference)
      assert(!receipt?.diagnostic.includes(secret))
    }
    assert.equal(outcomes[2]?.commandId, null)
    assert.equal(readFileSync(join(team.path, 'application', 'executed-once'), 'utf8'), 'x')
    assert.equal(existsSync(join(team.path, 'application', 'credential-forbidden')), false)
    assert.equal(existsSync(join(team.path, 'memory', 'blocked')), false)
    assert.equal(existsSync(join(team.path, 'application', 'unadmitted-escape')), false)
    assert.deepEqual(ctx.db.raw.query('SELECT id FROM workspace_writers').all(), [])
    assert.deepEqual(
      ctx.db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
      [],
    )
    completed = true
    return {
      nodeVersion: process.version,
      actualCanonicalDispatch: true,
      restrictedTwoTools: true,
      workerOwnershipObserved: true,
      replayedAndUndeclaredChecksRefused: true,
      unknownBashToolDenied: true,
      nativeDurableReceipts: true,
      modelVerdictIgnored: true,
      readonlyMemory: true,
      resourcesSettled: true,
      providerTransport: 'synthetic-loopback',
      productionNativeSelectionEnabled: false,
    }
  } finally {
    clearTimeout(timer)
    await provider.stop()
    if (completed) closeCtxForShutdown()
    else console.error(`Canonical native verification fixture retained: ${root}`)
    if (saved.home === undefined) delete process.env.BAZILION_HOME
    else process.env.BAZILION_HOME = saved.home
    if (saved.scheduler === undefined) delete process.env.BAZILION_SCHEDULER
    else process.env.BAZILION_SCHEDULER = saved.scheduler
    if (saved.policy === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = saved.policy
  }
}
