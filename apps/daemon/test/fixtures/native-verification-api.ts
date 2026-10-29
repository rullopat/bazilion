import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { VerificationResponse } from '@bazilion/api-types'
import { sseFromCanned, startLmStudioMock } from '../../../cli/test/fixtures/mock-lmstudio.ts'
import { createApp } from '../../src/app.ts'
import {
  createProfile,
  openConfig,
  openSecrets,
  providerModelRepo,
  providerStateRepo,
  spawnAgent,
  teamPolicyRepo,
} from '../../src/core/index.ts'
import { putCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import {
  getVerificationRequestById,
  listVerificationAttempts,
  listVerificationCheckOutcomes,
} from '../../src/core/repos/verification-requests.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { closeCtxForShutdown, getCtx } from '../../src/lib/ctx.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { stopNativeVerificationCaptures } from '../../src/lib/verification/capture-admissions.ts'
import { dispatchVerificationRequest } from '../../src/lib/verification/dispatch.ts'

/** Authenticated Hono API + actual native readiness/dispatch. Not an installed-client qualification. */
export async function runNativeVerificationApiFixture(root: string) {
  const saved = {
    home: process.env.BAZILION_HOME,
    scheduler: process.env.BAZILION_SCHEDULER,
    policy: process.env.BAZILION_TEAM_POLICY_ENFORCEMENT,
  }
  process.env.BAZILION_HOME = join(root, 'h')
  process.env.BAZILION_SCHEDULER = 'off'
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  const provider = await startLmStudioMock()
  let completed = false,
    providerFailure: unknown
  try {
    const ctx = getCtx(),
      config = openConfig(ctx.db)
    config.set('BAZILION_BASH_SANDBOX', 'off')
    config.set('LMSTUDIO_URL', provider.url)
    openSecrets(ctx.db, ctx.authToken).set('LMSTUDIO_API_KEY', 'controlled-native-api-provider-key')
    const secret = 'controlled-native-api-protected-value'
    openSecrets(ctx.db, ctx.authToken).set('NATIVE_API_SECRET', secret)
    providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
    providerModelRepo.replace(ctx.db, 'lmstudio', ['native-api'])
    const team = registerTeam(ctx.db, { id: 'native-api', name: 'Native API' }, ctx.paths)
    createProfile(ctx.db, ctx.paths, {
      id: 'native-api',
      defaultModel: 'lmstudio:native-api',
      skillsMode: 'selected',
    })
    const specialist = spawnAgent(ctx.db, ctx.paths, { profileId: 'native-api', teamId: team.id })
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
    mkdirSync(join(team.path, 'application'))
    mkdirSync(join(team.path, 'memory'), { recursive: true })
    writeFileSync(join(team.path, 'memory', 'canary'), 'readonly')
    writeFileSync(join(team.path, 'application', 'source.txt'), 'base\n')
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
    git('add', 'application/source.txt')
    git('commit', '-qm', 'base')
    writeFileSync(join(team.path, 'application', 'source.txt'), 'native API change\n')
    const snapshot = await captureTeamSnapshot(ctx.db, ctx.paths, team.id, {
      capturedBy: 'operator',
      base: 'HEAD',
    })
    assert(snapshot.reference.complete)
    const body = {
      recipientAgentId: specialist.id,
      snapshotId: snapshot.reference.id,
      checks: [
        {
          command:
            'set -e; grep "native API change" source.txt; printf native-api > api-marker; if printf forbidden > ../memory/canary 2>/dev/null; then exit 91; fi',
          cwd: 'application',
          purpose: 'native API capture',
          timeoutMs: 5000,
        },
      ],
      writablePaths: ['application/api-marker'],
    }
    const app = createApp(),
      url = `/api/teams/${team.id}/verifications`
    const post = async (
      input: unknown,
      token = ctx.authToken,
      signal?: AbortSignal,
    ): Promise<Response> =>
      app.request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
        signal,
      })
    const assertReleased = () => {
      assert.deepEqual(ctx.db.raw.query('SELECT id FROM workspace_writers').all(), [])
      assert.deepEqual(
        ctx.db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
        [],
      )
    }
    assert.equal((await post(body, '')).status, 401)
    assert.equal(
      (await post({ ...body, environment: { sandbox: 'off' }, requesterAgentId: specialist.id }))
        .status,
      400,
    )
    const legacyResponse = await post({
      ...body,
      summary: 'legitimate legacy capture before native selection',
    })
    assert.equal(legacyResponse.status, 201)
    const legacyId = ((await legacyResponse.json()) as VerificationResponse).request?.request.id
    assert(legacyId)
    putCodingEnvironment(ctx.db, team.id, 0, {
      backend: 'native',
      cwd: 'application',
      env: { CI: 'true' },
    })
    config.set('BAZILION_BASH_SANDBOX', 'native')
    assert.equal(await dispatchVerificationRequest(legacyId), 'not_dispatchable')
    assert.equal(getVerificationRequestById(ctx.db, legacyId)?.state, 'blocked')
    assert.deepEqual(listVerificationAttempts(ctx.db, legacyId), [])
    assert.equal(
      (await post({ ...body, checks: [{ ...body.checks[0], command: `printf ${secret}` }] }))
        .status,
      409,
    )
    assert.equal(
      ctx.db.raw
        .query<{ count: number }, []>('SELECT count(*) AS count FROM verification_requests')
        .get()?.count,
      1,
    )
    assertReleased()
    assert.equal(provider.callCount(), 0)

    const response = await post(body)
    assert.equal(response.status, 201)
    const report = (await response.json()) as VerificationResponse
    assert(report.request)
    assert.deepEqual(report.request.request.requester, { kind: 'operator' })
    assert.equal(report.request.request.environment.sandbox, 'native')
    assert.equal(report.request.request.environment.image, null)
    assert.equal(report.request.request.snapshot.id, snapshot.reference.id)
    assert(!JSON.stringify(report).includes(secret))
    assert(!JSON.stringify(report).includes(ctx.authToken))
    assertReleased()
    assert.equal(provider.callCount(), 0)
    const requestId = report.request.request.id
    provider.push([
      (request: IncomingMessage, res: ServerResponse) => {
        let bytes = ''
        request.on('data', (part) => {
          bytes += part.toString()
        })
        request.on('end', () => {
          try {
            const parsed = JSON.parse(bytes)
            assert.deepEqual(
              (parsed.tools ?? [])
                .map((tool: { function: { name: string } }) => tool.function.name)
                .sort(),
              ['verification_check', 'verification_request'],
            )
            assert(!bytes.includes(secret))
            assert(!bytes.includes(ctx.authToken))
            sseFromCanned(res, {
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'api-read',
                        type: 'function',
                        function: { name: 'verification_request', arguments: '{}' },
                      },
                    ],
                  },
                },
              ],
            })
          } catch (error) {
            providerFailure ??= error
            res.writeHead(500)
            res.end('controlled fixture failure')
          }
        })
      },
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'api-check',
                  type: 'function',
                  function: { name: 'verification_check', arguments: '{"ordinal":0}' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Captured native check finished.' },
          },
        ],
      },
    ])
    assert.equal(await dispatchVerificationRequest(requestId), 'dispatched')
    if (providerFailure) throw providerFailure
    const attempt = listVerificationAttempts(ctx.db, requestId)[0]
    assert(attempt)
    assert.equal(attempt.state, 'completed')
    assert.equal(listVerificationCheckOutcomes(ctx.db, attempt.id)[0]?.state, 'succeeded')
    assert.equal(readFileSync(join(team.path, 'application', 'api-marker'), 'utf8'), 'native-api')
    assert.equal(readFileSync(join(team.path, 'memory', 'canary'), 'utf8'), 'readonly')
    assertReleased()
    assert.equal(provider.callCount(), 3)

    // Capture a separate immutable request, then refuse it before any attempt if native is switched off.
    const second = await post({ ...body, summary: 'selection-off refusal' })
    assert.equal(second.status, 201)
    const secondId = ((await second.json()) as VerificationResponse).request?.request.id
    assert(secondId)
    config.set('BAZILION_BASH_SANDBOX', 'off')
    assert.equal(await dispatchVerificationRequest(requestId), 'not_dispatchable')
    assert.equal(getVerificationRequestById(ctx.db, requestId)?.state, 'completed')
    assert.equal(listVerificationAttempts(ctx.db, requestId).length, 1)
    assert.equal(await dispatchVerificationRequest(secondId), 'not_dispatchable')
    assert.equal(getVerificationRequestById(ctx.db, secondId)?.state, 'blocked')
    assert.deepEqual(listVerificationAttempts(ctx.db, secondId), [])
    assert.equal(provider.callCount(), 3)
    assertReleased()
    config.set('BAZILION_BASH_SANDBOX', 'native')

    const waitForReadiness = async (pending: Promise<Response>) => {
      let settled = false
      void pending
        .finally(() => {
          settled = true
        })
        .catch(() => {})
      const deadline = performance.now() + 5000
      while (performance.now() < deadline) {
        if (
          ctx.db.raw
            .query(
              'SELECT id FROM workspace_resources WHERE creation_acknowledged=1 AND cleanup_confirmed=0',
            )
            .get()
        )
          return
        if (settled) throw new Error('native API admission completed before controlled observation')
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      throw new Error('native API readiness was not acknowledged')
    }
    const count = ctx.db.raw
      .query<{ count: number }, []>('SELECT count(*) AS count FROM verification_requests')
      .get()?.count
    const changing = post({ ...body, summary: 'selection-change during readiness' })
    await waitForReadiness(changing)
    config.set('BAZILION_BASH_SANDBOX', 'off')
    assert.equal((await changing).status, 409)
    assert.equal(
      ctx.db.raw
        .query<{ count: number }, []>('SELECT count(*) AS count FROM verification_requests')
        .get()?.count,
      count,
    )
    assertReleased()
    config.set('BAZILION_BASH_SANDBOX', 'native')

    const stopping = post({ ...body, summary: 'shutdown during operator readiness' })
    await waitForReadiness(stopping)
    await stopNativeVerificationCaptures()
    assert.equal((await stopping).status, 409)
    assertReleased()
    assert.equal((await post(body)).status, 409)
    assert.equal(
      ctx.db.raw
        .query<{ count: number }, []>('SELECT count(*) AS count FROM verification_requests')
        .get()?.count,
      count,
    )
    assert.equal(provider.callCount(), 3)
    assertReleased()
    completed = true
    return {
      node: process.version,
      platform: process.platform,
      authenticatedCanonicalHttpCapture: true,
      forgedEnvironmentAndImpersonationRejected: true,
      secretCommandsRefusedBeforeStorage: true,
      actualNativeFactsNotJson: true,
      noProviderBeforeReadiness: true,
      actualTwoToolSpecialist: true,
      actualCapturedExecution: true,
      nativeOffRefusesBeforeAttempt: true,
      legacyCaptureCannotFallBackToHostUnderNativeSelection: true,
      midReadinessSelectionChangeRefused: true,
      operatorShutdownFencesAndDrainsReadiness: true,
      resourcesSettled: true,
      providerTransport: 'synthetic-loopback',
      installedClientQualified: false,
    }
  } finally {
    await stopNativeVerificationCaptures()
    await provider.stop()
    if (completed) closeCtxForShutdown()
    else console.error(`Native verification API fixture retained: ${root}`)
    if (saved.home === undefined) delete process.env.BAZILION_HOME
    else process.env.BAZILION_HOME = saved.home
    if (saved.scheduler === undefined) delete process.env.BAZILION_SCHEDULER
    else process.env.BAZILION_SCHEDULER = saved.scheduler
    if (saved.policy === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = saved.policy
  }
}
