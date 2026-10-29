import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { ChatFrame } from '@bazilion/api-types'
import { sseFromCanned, startLmStudioMock } from '../../../cli/test/fixtures/mock-lmstudio.ts'
import {
  createProfile,
  openConfig,
  openSecrets,
  providerStateRepo,
  resolveAgent,
  spawnAgent,
  teamPolicyRepo,
} from '../../src/core/index.ts'
import { putCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import {
  listVerificationAttempts,
  listVerificationCheckOutcomes,
  listVerificationRequests,
} from '../../src/core/repos/verification-requests.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import {
  isActiveAgent,
  ownsActiveAgent,
  registerAgent,
  unregisterAgent,
} from '../../src/lib/agent-cancel.ts'
import { acquireAgentLifecycleLease } from '../../src/lib/agent-lifecycle-lease.ts'
import { runAgentTurn } from '../../src/lib/agent-turn.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import type { WorkspaceLease } from '../../src/lib/coding-environment/workspace.ts'
import {
  CommunicationDeniedError,
  claimDeliverableInbox,
  deliverableInbox,
  sendAgentMessage,
} from '../../src/lib/communication.ts'
import { resolveConversationTarget } from '../../src/lib/conversation-target.ts'
import { closeCtxForShutdown, getCtx } from '../../src/lib/ctx.ts'
import { readTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { inboxAttemptId } from '../../src/lib/inbox-attempt.ts'
import type { PreparedProtectedNativeExecution } from '../../src/lib/native-execution/protected.ts'
import { prepareProtectedExecution } from '../../src/lib/protected-execution.ts'
import { createPreclaimedTurn, createTrustedTurnInvocation } from '../../src/lib/turn-invocation.ts'
import { prepareAgentTurn } from '../../src/lib/turn-preparation.ts'
import { dispatchVerificationRequest } from '../../src/lib/verification/dispatch.ts'
import {
  assertNativeVerificationRequestHost,
  createVerificationRequestHost,
} from '../../src/lib/verification/request-capability.ts'

/** One isolated daemon context. No public selector, installed-client or live-provider claim. */
export async function runCanonicalNativeInboxFixture(root: string, verifyHandoff = false) {
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
    timer = setTimeout(() => controller.abort(), 25_000)
  timer.unref()
  let completed = false,
    releaseAgent: (() => void) | undefined,
    handoff = false
  let retirement: ReturnType<typeof workspaceLifecycle> | undefined
  let workspaceLease: WorkspaceLease | undefined
  let native: PreparedProtectedNativeExecution | undefined
  let agentId: string | undefined
  try {
    const ctx = getCtx(),
      lifecycle = workspaceLifecycle(ctx.db)
    retirement = lifecycle
    const team = registerTeam(
      ctx.db,
      { id: 'native-canonical', name: 'Native canonical' },
      ctx.paths,
    )
    createProfile(ctx.db, ctx.paths, {
      id: 'native-canonical',
      defaultModel: 'lmstudio:native-canonical-fixture',
    })
    const agent = resolveAgent(
      ctx.db,
      ctx.paths,
      spawnAgent(ctx.db, ctx.paths, { profileId: 'native-canonical', teamId: team.id }).id,
    )
    agentId = agent.agent.id
    const sender = spawnAgent(ctx.db, ctx.paths, { profileId: 'native-canonical', teamId: team.id })
    const policy = teamPolicyRepo.get(ctx.db, team.id)
    assert(policy)
    teamPolicyRepo.replacePolicy(ctx.db, team.id, { expectedRevision: policy.revision, edges: [] })
    assert.throws(
      () =>
        sendAgentMessage(ctx.db, {
          from: sender.id,
          to: agent.agent.id,
          payload: 'must be denied',
          origin: 'agent_tool',
        }),
      CommunicationDeniedError,
    )
    const deniedRevision = teamPolicyRepo.get(ctx.db, team.id)
    assert(deniedRevision)
    teamPolicyRepo.replacePolicy(ctx.db, team.id, {
      expectedRevision: deniedRevision.revision,
      edges: [
        {
          sourceKind: 'agent',
          sourceId: sender.id,
          targetKind: 'agent',
          targetId: agent.agent.id,
          posture: 'allow',
        },
        {
          sourceKind: 'agent',
          sourceId: agent.agent.id,
          targetKind: 'user',
          targetId: null,
          posture: 'allow',
        },
        ...(verifyHandoff
          ? [
              {
                sourceKind: 'agent' as const,
                sourceId: agent.agent.id,
                targetKind: 'agent' as const,
                targetId: sender.id,
                posture: 'allow' as const,
              },
            ]
          : []),
      ],
    })
    const messages = Array.from({ length: 8 }, () =>
      sendAgentMessage(ctx.db, {
        from: sender.id,
        to: agent.agent.id,
        payload: 'Run the bounded native fixture.',
        origin: 'agent_tool',
      }),
    )
    const message = messages[0]
    assert(message)
    for (const item of messages) assert.equal(messageRepo.get(ctx.db, item.id)?.readAt, null)
    providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
    openConfig(ctx.db).set('LMSTUDIO_URL', provider.url)
    if (verifyHandoff) openConfig(ctx.db).set('BAZILION_BASH_SANDBOX', 'native')
    openSecrets(ctx.db, ctx.authToken).set('LMSTUDIO_API_KEY', 'controlled-canonical-provider-key')
    const secret = 'controlled-canonical-native-output-secret'
    openSecrets(ctx.db, ctx.authToken).set('SYNTHETIC_NATIVE_SECRET', secret)
    mkdirSync(join(team.path, 'application'), { mode: 0o700 })
    writeFileSync(join(team.path, 'memory', 'canary'), 'canonical-readonly', { flag: 'wx' })
    writeFileSync(join(team.path, 'planted.txt'), secret, { flag: 'wx', mode: 0o600 })
    if (verifyHandoff) {
      writeFileSync(join(team.path, 'application', 'source.txt'), 'baseline\n')
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
      git('add', 'application/source.txt', 'planted.txt')
      git('commit', '-qm', 'base')
    }
    putCodingEnvironment(ctx.db, team.id, 0, {
      backend: 'native',
      cwd: 'application',
      env: { CI: 'true' },
    })
    releaseAgent = await acquireAgentLifecycleLease(agent.agent.id)
    workspaceLease = await lifecycle.claim(team.id, team.path, 'agent')
    native = await prepareProtectedExecution(agent, {
      backend: 'native',
      lease: workspaceLease,
      controller,
    })
    assert.equal(native.backend, 'native')
    for (const item of messages) assert.equal(messageRepo.get(ctx.db, item.id)?.readAt, null)
    const conversation = resolveConversationTarget(ctx.db, ctx.paths, agent.agent.id)
    const claimed = claimDeliverableInbox(
      ctx.db,
      agent.agent.id,
      () => registerAgent(agent.agent.id, controller),
      conversation.id,
    )
    assert.equal(claimed.length, 8)
    assert.deepEqual(
      new Set(claimed.map((item) => item.id)),
      new Set(messages.map((item) => item.id)),
    )
    for (const item of messages) assert.notEqual(messageRepo.get(ctx.db, item.id)?.readAt, null)
    assert(`${agent.agent.id}:${claimed.map((item) => item.id).join(',')}`.length > 256)
    const attemptId = inboxAttemptId(agent.agent.id, claimed)
    assert(attemptId.length <= 256)
    const invocation = createTrustedTurnInvocation({
      kind: 'inbox_wake',
      authorization: {
        origin: 'scheduler_inbox',
        attemptKind: 'inbox_wake',
        attemptId,
        agentId: agent.agent.id,
      },
      turn: {
        agentId: agent.agent.id,
        message: claimed.map((item) => item.payload).join('\n'),
        conversationId: conversation.id,
        attachments: [],
        causalParentMessageId: message.id,
      },
      claim: createPreclaimedTurn({
        agentId: agent.agent.id,
        attemptId,
        controller,
        releaseLease: releaseAgent,
        registered: true,
      }),
      bashApprovalMode: 'auto_deny',
    })
    const guardedRequester = createVerificationRequestHost({
      db: ctx.db,
      paths: ctx.paths,
      agentId: agent.agent.id,
      teamId: team.id,
      turnId: attemptId,
      native: native.host,
      secrets: () => [ctx.authToken, secret, 'controlled-canonical-provider-key'],
      assertActive() {
        assert(ownsActiveAgent(agent.agent.id, controller))
      },
    })
    const requesterBinding = {
      agentId: agent.agent.id,
      teamId: team.id,
      turnId: attemptId,
      native: native.host,
    }
    assert.throws(
      () => assertNativeVerificationRequestHost({ ...guardedRequester }, requesterBinding),
      /requester is unavailable/,
    )
    assert.throws(
      () =>
        assertNativeVerificationRequestHost(guardedRequester, {
          ...requesterBinding,
          agentId: sender.id,
        }),
      /requester is unavailable/,
    )
    let tools: string[] = []
    provider.push([
      (request: IncomingMessage, response: ServerResponse) => {
        let body = ''
        request.on('data', (bytes) => {
          body += bytes.toString()
          assert(body.length < 2 * 1024 * 1024)
        })
        request.on('end', () => {
          const parsed = JSON.parse(body)
          tools = (parsed.tools ?? []).map(
            (value: { function: { name: string } }) => value.function.name,
          )
          sseFromCanned(response, {
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'canonical-environment',
                      type: 'function',
                      function: {
                        name: 'coding_environment',
                        arguments: JSON.stringify({ target: 'application' }),
                      },
                    },
                    {
                      id: 'canonical-bash',
                      type: 'function',
                      function: {
                        name: 'bash',
                        arguments: JSON.stringify({
                          command:
                            'cat ../planted.txt; printf native-bash > bash-marker; if printf forbidden > ../memory/canary 2>/dev/null; then exit 91; fi',
                          timeout: 5,
                        }),
                      },
                    },
                    {
                      id: 'canonical-coding',
                      type: 'function',
                      function: {
                        name: 'coding_command',
                        arguments: JSON.stringify({
                          command:
                            'cat planted.txt; printf native-coding > coding-marker' +
                            (verifyHandoff
                              ? '; printf native-change >> application/source.txt'
                              : ''),
                          cwd: '.',
                          purpose: 'test',
                          timeoutSeconds: 5,
                        }),
                      },
                    },
                    {
                      id: 'canonical-credential-denied',
                      type: 'function',
                      function: {
                        name: 'bash',
                        arguments: JSON.stringify({
                          command: 'printf "$LMSTUDIO_API_KEY" > credential-forbidden',
                          timeout: 5,
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          })
        })
      },
      ...(verifyHandoff
        ? [
            {
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'canonical-native-request-verification',
                        type: 'function',
                        function: {
                          name: 'request_verification',
                          arguments: JSON.stringify({
                            specialist: sender.id,
                            summary: 'Check the captured native change.',
                            checks: [
                              {
                                command:
                                  'grep native-change source.txt; printf verified > verification-marker',
                                cwd: 'application',
                                purpose: 'captured native change',
                                timeoutSeconds: 5,
                              },
                            ],
                            writablePaths: ['application/verification-marker'],
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ]
        : []),
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Native canonical turn finished.' },
          },
        ],
      },
    ])
    handoff = true
    const turn = await prepareAgentTurn({ invocation, protectedExecution: native, workspaceLease })
    const frames: ChatFrame[] = []
    for await (const frame of runAgentTurn(turn)) frames.push(frame)
    assert.deepEqual(
      frames.filter((frame) => frame.kind === 'fatal'),
      [],
    )
    assert.equal(frames.filter((frame) => frame.kind === 'done').length, 1)
    assert.equal(provider.callCount(), verifyHandoff ? 3 : 2)
    assert(tools.includes('request_verification'))
    assert(
      tools.includes('bash') &&
        tools.includes('coding_command') &&
        tools.includes('coding_environment'),
    )
    for (const name of [
      'read',
      'edit',
      'write',
      'grep',
      'find',
      'ls',
      'verification_check',
      'verification_request',
    ])
      assert.equal(tools.includes(name), false)
    assert.equal(
      tools.some((name) => name.startsWith('browser_') || name.startsWith('mcp__')),
      false,
    )
    assert.equal(JSON.stringify(frames).includes(secret), false)
    assert(JSON.stringify(frames).includes('[REDACTED]'))
    assert.equal(readFileSync(join(team.path, 'application', 'bash-marker'), 'utf8'), 'native-bash')
    assert.equal(readFileSync(join(team.path, 'coding-marker'), 'utf8'), 'native-coding')
    assert.equal(readFileSync(join(team.path, 'memory', 'canary'), 'utf8'), 'canonical-readonly')
    assert.equal(existsSync(join(team.path, 'credential-forbidden')), false)
    const rows = ctx.db.raw
      .query<{ receipt_json: string }, []>('SELECT receipt_json FROM coding_commands')
      .all()
    assert.equal(rows.length, 1)
    const receipt = JSON.parse(rows[0]?.receipt_json ?? 'null')
    assert.equal(receipt.state, 'succeeded')
    assert.equal(receipt.environment.posture, 'native')
    assert.equal(receipt.environment.imageId, null)
    assert.equal(isActiveAgent(agent.agent.id), false)
    assert.deepEqual(ctx.db.raw.query('SELECT id FROM workspace_writers').all(), [])
    assert.deepEqual(
      ctx.db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
      [],
    )
    assert.equal(await native.close(), true)
    assert.equal(controller.signal.aborted, false)
    assert.throws(() => assertNativeVerificationRequestHost(guardedRequester, requesterBinding))
    const requested = listVerificationRequests(ctx.db, team.id)
    if (verifyHandoff) {
      assert.equal(requested.length, 1)
      const request = requested[0]
      assert(request)
      assert.equal(request.requesterAgentId, agent.agent.id)
      assert.equal(request.recipientAgentId, sender.id)
      assert.equal(request.environment.sandbox, 'native')
      assert.equal(request.environment.image, null)
      const capturedSource = readTeamSnapshot(ctx.db, ctx.paths, team.id, request.snapshotId)
      assert(capturedSource?.entries.some((entry) => entry.path === 'application/source.txt'))
      const requestCount = requested.length
      await assert.rejects(
        guardedRequester.capture({
          specialist: sender.id,
          checks: [{ command: 'printf forbidden', purpose: 'stale', cwd: '.', timeoutSeconds: 5 }],
        }),
      )
      assert.equal(listVerificationRequests(ctx.db, team.id).length, requestCount)
      provider.push([
        (incoming: IncomingMessage, response: ServerResponse) => {
          let body = ''
          incoming.on('data', (bytes) => {
            body += bytes.toString()
          })
          incoming.on('end', () => {
            const parsed = JSON.parse(body)
            assert.deepEqual(
              (parsed.tools ?? [])
                .map((tool: { function: { name: string } }) => tool.function.name)
                .sort(),
              ['verification_check', 'verification_request'],
            )
            sseFromCanned(response, {
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'specialist-read',
                        type: 'function',
                        function: { name: 'verification_request', arguments: '{}' },
                      },
                    ],
                  },
                },
              ],
            })
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
                    id: 'specialist-check',
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
              message: { role: 'assistant', content: 'Captured check reported.' },
            },
          ],
        },
      ])
      assert.equal(
        await dispatchVerificationRequest(request.id, { signal: controller.signal }),
        'dispatched',
      )
      const attempt = listVerificationAttempts(ctx.db, request.id)[0]
      assert(attempt)
      assert.equal(attempt.state, 'completed')
      assert.equal(listVerificationCheckOutcomes(ctx.db, attempt.id)[0]?.state, 'succeeded')
      assert.equal(
        readFileSync(join(team.path, 'application', 'verification-marker'), 'utf8'),
        'verified',
      )
      assert(
        deliverableInbox(ctx.db, agent.agent.id, false).some(
          (message) => message.fromAgentId === sender.id && message.payload.includes(request.id),
        ),
      )
      assert.equal(isActiveAgent(sender.id), false)
      assert.deepEqual(ctx.db.raw.query('SELECT id FROM workspace_writers').all(), [])
      assert.deepEqual(
        ctx.db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
        [],
      )
    } else assert.equal(requested.length, 0)
    completed = true
    return {
      node: process.version,
      platform: process.platform,
      actualDaemonPreparationAndTurn: true,
      readinessBeforeMessageClaim: true,
      boundedEightMessageAttempt: true,
      teamPolicyPeerDenyThenAllow: true,
      nativeToolScope: true,
      actualCodingReceipt: true,
      nativeAgentRequesterAdmitted: true,
      copiedWrongAndStaleRequesterRefused: true,
      ...(verifyHandoff
        ? { nativeVerificationRequestedAndDispatched: true, nativeSpecialistResultDelivered: true }
        : {}),
      writerReleased: true,
      providerTransport: 'synthetic-loopback',
      productionNativeSelectionEnabled: false,
    }
  } finally {
    clearTimeout(timer)
    if (!handoff) {
      releaseAgent?.()
      if (agentId && ownsActiveAgent(agentId, controller)) unregisterAgent(agentId)
      if (native) await native.close().catch(() => false)
      if (workspaceLease && retirement) await retirement.release(workspaceLease)
    }
    await provider.stop()
    if (completed) closeCtxForShutdown()
    else console.error(`Canonical native turn fixture retained: ${root}`)
    if (saved.home === undefined) delete process.env.BAZILION_HOME
    else process.env.BAZILION_HOME = saved.home
    if (saved.scheduler === undefined) delete process.env.BAZILION_SCHEDULER
    else process.env.BAZILION_SCHEDULER = saved.scheduler
    if (saved.policy === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = saved.policy
  }
}
