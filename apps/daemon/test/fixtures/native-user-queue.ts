import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { UserQueueItem } from '@bazilion/api-types'
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
import { setTelegramTopicId } from '../../src/core/repos/agents.ts'
import { putCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as telegramAcl from '../../src/core/repos/telegram-acl.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { cancelAgent, isActiveAgent } from '../../src/lib/agent-cancel.ts'
import { closeCtxForShutdown, getCtx } from '../../src/lib/ctx.ts'
import { captureTelegramQueueBinding } from '../../src/lib/telegram/queue-binding.ts'
import {
  installQueueNoticeTransport,
  notifyTelegramQueueStatus,
} from '../../src/lib/telegram/queue-notice.ts'
import { enqueueTelegramInput } from '../../src/lib/user-queue-admission.ts'
import { drainUserQueueHead } from '../../src/lib/user-queue-drain.ts'
import { startUserQueuePump } from '../../src/lib/user-queue-pump.ts'

/** Real authenticated queue/approval handlers and native workers; only model transport is synthetic. */
export async function runNativeUserQueueFixture(root: string) {
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
  let actorId: string | undefined, drainingTask: Promise<boolean> | undefined
  let pump: ReturnType<typeof startUserQueuePump> | undefined
  try {
    const ctx = getCtx(),
      config = openConfig(ctx.db)
    config.set('BAZILION_BASH_SANDBOX', 'native')
    config.set('BROWSER_ENABLED', 'false')
    config.set('LMSTUDIO_URL', provider.url)
    openSecrets(ctx.db, ctx.authToken).set(
      'LMSTUDIO_API_KEY',
      'controlled-native-queue-provider-key',
    )
    providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
    providerModelRepo.replace(ctx.db, 'lmstudio', ['native-queue'])
    const team = registerTeam(ctx.db, { id: 'native-queue', name: 'Native queue' }, ctx.paths)
    createProfile(ctx.db, ctx.paths, {
      id: 'native-queue',
      defaultModel: 'lmstudio:native-queue',
      skillsMode: 'selected',
    })
    const actor = spawnAgent(ctx.db, ctx.paths, { profileId: 'native-queue', teamId: team.id })
    actorId = actor.id
    mkdirSync(join(team.path, 'application'))
    mkdirSync(join(team.path, 'memory'), { recursive: true })
    writeFileSync(join(team.path, 'memory', 'canary'), 'readonly')
    let defaults = putCodingEnvironment(ctx.db, team.id, 0, {
      backend: 'native',
      cwd: 'application',
      env: { CI: 'true', TZ: 'UTC' },
    })
    const policy = (posture: 'deny' | 'allow' | 'approval_required') => {
      const current = teamPolicyRepo.get(ctx.db, team.id)
      assert(current)
      teamPolicyRepo.replacePolicy(ctx.db, team.id, {
        expectedRevision: current.revision,
        edges: [
          ...(posture === 'deny'
            ? []
            : [
                {
                  sourceKind: 'user' as const,
                  sourceId: null,
                  targetKind: 'agent' as const,
                  targetId: actor.id,
                  posture,
                },
              ]),
          {
            sourceKind: 'agent',
            sourceId: actor.id,
            targetKind: 'user',
            targetId: null,
            posture: 'allow',
          },
        ],
      })
    }
    const app = createApp(),
      base = `/api/agents/${actor.id}/queue`
    const post = (url: string, body: unknown = {}) =>
      app.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.authToken}` },
        body: JSON.stringify(body),
      })
    const input = (phase: string, attachment = false) => ({
      requestId: randomUUID(),
      expectedSelection: conversations.selection(ctx.db, actor.id),
      message: `Run native queued ${phase}.`,
      attachments: attachment
        ? [
            {
              name: 'held-attachment.txt',
              mimeType: 'text/plain',
              data: Buffer.from('native-queued-input').toString('base64'),
            },
          ]
        : [],
    })
    const enqueue = async (body: ReturnType<typeof input>) => {
      const response = await post(base, body)
      assert.equal(response.status, 202, await response.clone().text())
      return (await response.json()) as UserQueueItem
    }
    const assertReleased = () => {
      assert.equal(isActiveAgent(actor.id), false)
      assert.deepEqual(ctx.db.raw.query('SELECT id FROM workspace_writers').all(), [])
      assert.deepEqual(
        ctx.db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
        [],
      )
    }
    const botToken = 'controlled-native-queue-bot-token'
    const scripts = (phase: string, protectedTurn: boolean, cancel = false, attachment = false) =>
      provider.push([
        (request: IncomingMessage, response: ServerResponse) => {
          let body = ''
          request.on('data', (bytes) => {
            body += bytes.toString()
          })
          request.on('end', () => {
            try {
              const parsed = JSON.parse(body),
                tools = (parsed.tools ?? []).map(
                  (tool: { function: { name: string } }) => tool.function.name,
                )
              assert(tools.includes('bash'))
              assert(tools.includes('coding_command'))
              assert(!tools.includes('read'))
              assert(!tools.includes('write'))
              if (protectedTurn)
                assert(
                  !tools.some(
                    (name: string) => name.startsWith('browser_') || name.startsWith('mcp__'),
                  ),
                )
              assert(!body.includes(ctx.authToken))
              assert(!body.includes('controlled-native-queue-provider-key'))
              assert(!body.includes(botToken))
              let attached = ''
              if (attachment) {
                assert(body.includes('held-attachment.txt'))
                assert(!body.includes('/inputs/'))
                const uploads = join(actor.dir, 'uploads'),
                  files = readdirSync(uploads)
                assert.equal(files.length, 1)
                const path = join(uploads, files[0] ?? '')
                assert.equal(readFileSync(path, 'utf8'), 'native-queued-input')
                const quoted = `'${path.replaceAll("'", "'\\''")}'`
                attached = `test "$(cat ${quoted})" = native-queued-input; if printf forbidden > ${quoted} 2>/dev/null; then exit 92; fi; `
              }
              const calls = cancel
                ? [
                    {
                      id: 'queue-cancel',
                      type: 'function',
                      function: {
                        name: 'coding_command',
                        arguments: JSON.stringify({
                          command:
                            'printf started > cancel-started; sleep 30; printf late > cancel-late',
                          cwd: 'application',
                          purpose: 'test',
                          timeoutSeconds: 60,
                        }),
                      },
                    },
                  ]
                : [
                    {
                      id: `${phase}-bash`,
                      type: 'function',
                      function: {
                        name: 'bash',
                        arguments: JSON.stringify({
                          command: `set -e; test "$CI:$TZ" = true:UTC; test -z "\${!LMSTUDIO@}"; test -z "\${!TELEGRAM@}"; ${attached}printf ${phase} >> ${phase}-count; if printf forbidden > ../memory/canary 2>/dev/null; then exit 91; fi`,
                        }),
                      },
                    },
                    {
                      id: `${phase}-coding`,
                      type: 'function',
                      function: {
                        name: 'coding_command',
                        arguments: JSON.stringify({
                          command: `printf ${phase} > ${phase}-coding`,
                          cwd: 'application',
                          purpose: 'test',
                          timeoutSeconds: 5,
                        }),
                      },
                    },
                    {
                      id: `${phase}-danger`,
                      type: 'function',
                      function: {
                        name: 'bash',
                        arguments: JSON.stringify({
                          command: 'printf "$LMSTUDIO_API_KEY" > credential-forbidden',
                        }),
                      },
                    },
                  ]
              sseFromCanned(response, {
                choices: [
                  {
                    finish_reason: 'tool_calls',
                    message: { role: 'assistant', content: null, tool_calls: calls },
                  },
                ],
              })
            } catch (error) {
              providerFailure ??= error
              response.writeHead(500)
              response.end('controlled fixture failure')
            }
          })
        },
        ...(!cancel
          ? [
              {
                choices: [
                  {
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: `${phase} finished.` },
                  },
                ],
              },
            ]
          : []),
      ])

    policy('deny')
    assert.equal((await post(base, input('denied'))).status, 403)
    assert.equal(provider.callCount(), 0)
    assert.deepEqual(ctx.db.raw.query('SELECT id FROM user_queue_items').all(), [])
    assertReleased()
    policy('approval_required')
    const approvedInput = input('approved', true),
      held = await enqueue(approvedInput)
    assert.equal(held.status, 'held')
    assert(held.approvalId)
    assert.equal(provider.callCount(), 0)
    assertReleased()
    let control = queue.control(ctx.db, actor.id)
    assert.equal(
      (await post(`${base}/control`, { paused: true, expectedRevision: control.revision })).status,
      200,
    )
    assert.equal((await post(`/api/approvals/${held.approvalId}/approve`)).status, 409)
    assert.equal(provider.callCount(), 0)
    assertReleased()
    control = queue.control(ctx.db, actor.id)
    assert.equal(
      (await post(`${base}/control`, { paused: false, expectedRevision: control.revision })).status,
      200,
    )
    // Ordinary host mode must not make protected macOS deliveries depend on Docker.
    if (process.platform === 'darwin') {
      config.set('BAZILION_BASH_SANDBOX', 'off')
      const endpoint = `/api/teams/${team.id}/coding-environment`
      const headers = {
        authorization: `Bearer ${ctx.authToken}`,
        'content-type': 'application/json',
      }
      const status = await app.request(endpoint, { headers })
      assert.equal(status.status, 200)
      const value = (await status.json()) as import('@bazilion/api-types').CodingEnvironmentStatus
      assert.deepEqual(value.supportedBackends, ['native'])
      assert.equal(value.configuredExecution, 'host')
      assert.equal(value.image, null)
      const rejected = await app.request(endpoint, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          expectedRevision: defaults.revision,
          config: { backend: 'docker', image: 'must-not-start', cwd: 'application', env: {} },
        }),
      })
      assert.equal(rejected.status, 400)
      assert((await rejected.text()).includes('not supported on macOS'))
      assertReleased()
    }
    scripts('approved', true, false, true)
    const delivered = await post(`/api/approvals/${held.approvalId}/approve`)
    if (providerFailure) throw providerFailure
    assert.equal(delivered.status, 200, await delivered.clone().text())
    assert.equal(((await delivered.json()) as { status: string }).status, 'delivered')
    assert.equal(queue.get(ctx.db, actor.id, held.id)?.status, 'completed')
    config.set('BAZILION_BASH_SANDBOX', 'native')
    assert.equal(readFileSync(join(team.path, 'application', 'approved-count'), 'utf8'), 'approved')
    assert.equal((await post(`/api/approvals/${held.approvalId}/approve`)).status, 409)
    assert.equal((await enqueue(approvedInput)).id, held.id)
    assert.equal(await drainUserQueueHead(actor.id), false)
    assert.equal(provider.callCount(), 2)
    assertReleased()

    const denied = await enqueue(input('operator-denied'))
    assert(denied.approvalId)
    assert.equal((await post(`/api/approvals/${denied.approvalId}/deny`)).status, 200)
    assert.equal((await post(`/api/approvals/${denied.approvalId}/approve`)).status, 409)
    assert.equal(provider.callCount(), 2)
    assertReleased()
    policy('allow')
    defaults = putCodingEnvironment(ctx.db, team.id, defaults.revision, {
      backend: 'docker',
      image: 'must-not-start',
      cwd: 'application',
      env: {},
    })
    const unavailableInput = input('unavailable'),
      unavailable = await enqueue(unavailableInput)
    assert.equal(await drainUserQueueHead(actor.id), true)
    assert.equal(queue.get(ctx.db, actor.id, unavailable.id)?.status, 'failed')
    assert.equal(provider.callCount(), 2)
    assert.equal((await enqueue(unavailableInput)).status, 'failed')
    assertReleased()
    putCodingEnvironment(ctx.db, team.id, defaults.revision, {
      backend: 'native',
      cwd: 'application',
      env: { CI: 'true', TZ: 'UTC' },
    })
    const direct = await enqueue(input('direct'))
    scripts('direct', false)
    pump = startUserQueuePump()
    const pumpDeadline = performance.now() + 10_000
    while (
      ['pending', 'claimed', 'running'].includes(
        queue.get(ctx.db, actor.id, direct.id)?.status ?? '',
      ) &&
      performance.now() < pumpDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 5))
    await pump.stop()
    pump = undefined
    if (providerFailure) throw providerFailure
    assert.equal(queue.get(ctx.db, actor.id, direct.id)?.status, 'completed')
    assert.equal(readFileSync(join(team.path, 'application', 'direct-count'), 'utf8'), 'direct')
    assert.equal(provider.callCount(), 4)
    assertReleased()

    // Real retained owner/topic/credential bindings and protected native workers; no live bot API.
    config.set('TELEGRAM_CHAT_ID', '-100')
    openSecrets(ctx.db, ctx.authToken).set('TELEGRAM_BOT_TOKEN', botToken)
    telegramAcl.add(ctx.db, { userId: 11, role: 'owner' })
    setTelegramTopicId(ctx.db, actor.id, 42)
    const notices: Array<{ chatId: number; topicId: number; text: string }> = []
    installQueueNoticeTransport(() => ({
      db: ctx.db,
      authToken: ctx.authToken,
      botToken,
      send: async (chatId, topicId, text) => {
        notices.push({ chatId, topicId, text })
      },
    }))
    const telegramBinding = (messageId: number, text: string) =>
      captureTelegramQueueBinding(
        ctx.db,
        ctx.authToken,
        {
          origin: 'telegram_agent_topic',
          attemptKind: 'telegram_ingress',
          attemptId: `-100:${messageId}`,
          requester: 'telegram:11',
          approvalPayloadKind: 'telegram_ingress',
          approvalPayload: {
            agentId: actor.id,
            conversationId: direct.conversationId,
            chatId: -100,
            threadId: 42,
            messageId,
            text,
            media: null,
          },
        },
        botToken,
      )
    const telegram = await enqueueTelegramInput(
      telegramBinding(5, 'Native Telegram queue'),
      'Native Telegram queue',
      [],
    )
    scripts('telegram', true)
    assert.equal(await drainUserQueueHead(actor.id), true)
    if (providerFailure) throw providerFailure
    assert.equal(queue.get(ctx.db, actor.id, telegram.id)?.status, 'completed')
    assert.equal(readFileSync(join(team.path, 'application', 'telegram-count'), 'utf8'), 'telegram')
    assertReleased()
    policy('approval_required')
    const telegramApproved = await enqueueTelegramInput(
      telegramBinding(6, 'Native approved Telegram queue'),
      'Native approved Telegram queue',
      [],
    )
    assert.equal(telegramApproved.status, 'held')
    assert(telegramApproved.approvalId)
    await notifyTelegramQueueStatus(ctx.db, actor.id, telegramApproved.id)
    assert.equal(notices.length, 1)
    assert.equal(notices[0]?.chatId, -100)
    assert.equal(notices[0]?.topicId, 42)
    assert(!JSON.stringify(notices).includes('Native approved Telegram queue'))
    assert(!JSON.stringify(notices).includes(botToken))
    assertReleased()
    scripts('telegram-approved', true)
    const telegramDelivery = await post(`/api/approvals/${telegramApproved.approvalId}/approve`)
    if (providerFailure) throw providerFailure
    assert.equal(telegramDelivery.status, 200, await telegramDelivery.clone().text())
    assert.equal(queue.get(ctx.db, actor.id, telegramApproved.id)?.status, 'completed')
    assert.equal((await post(`/api/approvals/${telegramApproved.approvalId}/approve`)).status, 409)
    assert.equal(
      readFileSync(join(team.path, 'application', 'telegram-approved-count'), 'utf8'),
      'telegram-approved',
    )
    assertReleased()
    policy('allow')
    const rebound = await enqueueTelegramInput(
      telegramBinding(7, 'Must not follow rebound topic'),
      'Must not follow rebound topic',
      [],
    )
    setTelegramTopicId(ctx.db, actor.id, 43)
    assert.equal(await drainUserQueueHead(actor.id), true)
    assert.equal(queue.get(ctx.db, actor.id, rebound.id)?.status, 'failed')
    assert.equal(provider.callCount(), 8)
    assert.equal(notices.length, 1)
    assertReleased()

    const cancelled = await enqueue(input('cancelled'))
    scripts('cancelled', false, true)
    drainingTask = drainUserQueueHead(actor.id)
    const draining = drainingTask
    const deadline = performance.now() + 10_000
    while (
      !existsSync(join(team.path, 'application', 'cancel-started')) &&
      performance.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 5))
    assert(
      existsSync(join(team.path, 'application', 'cancel-started')),
      'actual native queued command did not start',
    )
    assert.equal(queue.get(ctx.db, actor.id, cancelled.id)?.status, 'running')
    control = queue.control(ctx.db, actor.id)
    assert.equal(
      (await post(`${base}/stop`, { expectedRevision: control.revision - 1 })).status,
      409,
    )
    assert.equal(isActiveAgent(actor.id), true)
    const stopped = await post(`${base}/stop`, { expectedRevision: control.revision })
    assert.equal(stopped.status, 200)
    assert.equal(((await stopped.json()) as { cancelled: boolean }).cancelled, true)
    await draining
    if (providerFailure) throw providerFailure
    assert.equal(queue.get(ctx.db, actor.id, cancelled.id)?.status, 'cancelled')
    assert.equal(provider.callCount(), 9)
    assert.equal(existsSync(join(team.path, 'application', 'cancel-late')), false)
    assert.equal(existsSync(join(team.path, 'application', 'credential-forbidden')), false)
    assert.equal(readFileSync(join(team.path, 'memory', 'canary'), 'utf8'), 'readonly')
    assertReleased()
    const toolResults = readdirSync(join(actor.dir, 'sessions'))
      .filter((file) => file.endsWith('.jsonl'))
      .flatMap((file) =>
        readFileSync(join(actor.dir, 'sessions', file), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      )
      .filter((entry) => entry.type === 'message' && entry.message?.role === 'toolResult')
      .map((entry) => entry.message)
    for (const phase of ['approved', 'direct', 'telegram', 'telegram-approved']) {
      const denied = toolResults.find((result) => result.toolCallId === `${phase}-danger`)
      assert.equal(denied?.isError, true)
      assert.deepEqual(denied.details?.nativeExecutionFailure, {
        code: 'approval_denied',
        cleanupConfirmed: true,
      })
    }
    const receipts = ctx.db.raw
      .query<{ receipt_json: string }, []>('SELECT receipt_json FROM coding_commands')
      .all()
      .map((row) => JSON.parse(row.receipt_json))
    assert.equal(receipts.length, 5)
    assert(
      receipts.every(
        (receipt) =>
          receipt.environment.posture === 'native' && receipt.environment.imageId === null,
      ),
    )
    assert.equal(
      receipts.find((receipt) => receipt.toolCallId === 'queue-cancel')?.state,
      'cancelled',
    )
    completed = true
    return {
      node: process.version,
      platform: process.platform,
      authenticatedNativeQueue: true,
      policyDeniesBeforeEffects: true,
      pausedApprovalHasNoEffects: true,
      approvedProtectedNativeDispatch: true,
      approvedAttachmentReadonly: true,
      communicationGrantDoesNotGrantShellRisk: true,
      duplicateAndDeniedApprovalCannotReplay: true,
      unavailableNativeQueueFailsWithoutFallback: true,
      configuredNativeQueue: true,
      actualQueuePump: true,
      liveQueueCancellationSettled: true,
      staleQueueStopCannotSignal: true,
      resourcesSettled: true,
      providerTransport: 'synthetic-loopback',
      installedClientQualified: false,
      boundTelegramNativeQueue: true,
      approvedTelegramNativeDispatch: true,
      reboundTelegramRefusedBeforeEffects: true,
      telegramTransport: 'synthetic-notices',
      restartRestoreQualified: false,
    }
  } finally {
    if (!completed && actorId && isActiveAgent(actorId)) cancelAgent(actorId)
    await drainingTask?.catch(() => {})
    await pump?.stop()
    await provider.stop()
    installQueueNoticeTransport(null)
    if (completed) closeCtxForShutdown()
    else console.error(`Native user queue fixture retained: ${root}`)
    if (saved.home === undefined) delete process.env.BAZILION_HOME
    else process.env.BAZILION_HOME = saved.home
    if (saved.scheduler === undefined) delete process.env.BAZILION_SCHEDULER
    else process.env.BAZILION_SCHEDULER = saved.scheduler
    if (saved.policy === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = saved.policy
  }
}
