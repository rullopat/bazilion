import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { sseFromCanned, startLmStudioMock } from '../../../cli/test/fixtures/mock-lmstudio.ts'
import {
  createProfile,
  mcpServerRepo,
  openConfig,
  openSecrets,
  providerStateRepo,
  resolveAgent,
  resolvePaths,
  spawnAgent,
  teamPolicyRepo,
} from '../../src/core/index.ts'
import { putCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { isActiveAgent } from '../../src/lib/agent-cancel.ts'
import { runAgentTurn } from '../../src/lib/agent-turn.ts'
import { closeBrowserSession } from '../../src/lib/browser/pool.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { sendAgentMessage } from '../../src/lib/communication.ts'
import { closeCtxForShutdown, getCtx } from '../../src/lib/ctx.ts'
import { acquireDaemonLiveness, type DaemonLivenessHandle } from '../../src/lib/daemon-liveness.ts'
import { closeMcpConnection } from '../../src/lib/mcp/pool.ts'
import { prepareSelectedProtectedExecution } from '../../src/lib/protected-execution.ts'
import { resources, shutdownResources } from '../../src/lib/resources.ts'
import { _tickOnce, stopScheduler } from '../../src/lib/scheduler.ts'
import { createTrustedTurnInvocation } from '../../src/lib/turn-invocation.ts'
import { prepareAgentTurn } from '../../src/lib/turn-preparation.ts'

/** Actual daemon selection, configured Pi worker and scheduler ticks; only provider transport is synthetic. */
export async function runSelectedNativeTurnsFixture(
  root: string,
  platformTools?: { readonly mcpFixture: string },
) {
  const saved = {
    home: process.env.BAZILION_HOME,
    scheduler: process.env.BAZILION_SCHEDULER,
    policy: process.env.BAZILION_TEAM_POLICY_ENFORCEMENT,
  }
  process.env.BAZILION_HOME = join(root, 'h')
  process.env.BAZILION_SCHEDULER = 'off'
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  const provider = await startLmStudioMock()
  let completed = false
  let providerFailure: unknown
  let primaryFailure: unknown
  let daemonLiveness: DaemonLivenessHandle | undefined
  let browserAgent: string | undefined
  let mcpServer: string | undefined
  let privateHits = 0
  const privateOrigin = platformTools
    ? createServer((_request, response) => {
        privateHits++
        response.end('must not reach this private origin')
      })
    : undefined
  if (privateOrigin)
    await new Promise<void>((resolve) => privateOrigin.listen(0, '127.0.0.1', resolve))
  const forbiddenUrl = privateOrigin
    ? `http://127.0.0.1:${(privateOrigin.address() as AddressInfo).port}/must-not-reach`
    : ''
  let retirement: Promise<void> | undefined
  const retirePlatform = () =>
    (retirement ??= (async () => {
      if (!platformTools) return
      if (browserAgent) await closeBrowserSession(browserAgent)
      if (mcpServer) await closeMcpConnection(mcpServer)
      assert.equal(resources().browsers.size, 0)
      assert.equal(resources().mcp.size, 0)
      await shutdownResources()
    })().catch((error) => {
      completed = false
      console.error(`Platform retirement retained: ${root}`)
      throw primaryFailure === undefined
        ? error
        : new AggregateError([primaryFailure, error], 'Platform fixture and retirement failed')
    }))
  try {
    if (platformTools) daemonLiveness = acquireDaemonLiveness(resolvePaths())
    const ctx = getCtx(),
      config = openConfig(ctx.db)
    config.set('BAZILION_BASH_SANDBOX', 'native')
    config.set('BROWSER_ENABLED', platformTools ? 'true' : 'false')
    if (platformTools) {
      config.set('BROWSER_HEADLESS', 'true')
      config.set('BROWSER_ALLOW_PRIVATE_NETWORK', 'false')
      mcpServer = mcpServerRepo.insert(ctx.db, {
        name: 'nativeplatform',
        transport: 'stdio',
        command: process.execPath,
        args: [platformTools.mcpFixture],
      }).id
    }
    config.set('LMSTUDIO_URL', provider.url)
    const secret = 'controlled-selected-native-secret'
    openSecrets(ctx.db, ctx.authToken).set('LMSTUDIO_API_KEY', 'controlled-selected-native-key')
    openSecrets(ctx.db, ctx.authToken).set('SELECTED_NATIVE_API_KEY', secret)
    providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
    const team = registerTeam(ctx.db, { id: 'selected-native', name: 'Selected native' }, ctx.paths)
    createProfile(ctx.db, ctx.paths, {
      id: 'selected-native',
      defaultModel: 'lmstudio:selected-native',
      skillsMode: 'selected',
    })
    const actor = spawnAgent(ctx.db, ctx.paths, { profileId: 'selected-native', teamId: team.id })
    const sender = spawnAgent(ctx.db, ctx.paths, { profileId: 'selected-native', teamId: team.id })
    if (platformTools) browserAgent = actor.id
    const policy = teamPolicyRepo.get(ctx.db, team.id)
    assert(policy)
    teamPolicyRepo.replacePolicy(ctx.db, team.id, {
      expectedRevision: policy.revision,
      edges: [
        {
          sourceKind: 'user',
          sourceId: null,
          targetKind: 'agent',
          targetId: actor.id,
          posture: 'allow',
        },
        {
          sourceKind: 'agent',
          sourceId: sender.id,
          targetKind: 'agent',
          targetId: actor.id,
          posture: 'allow',
        },
      ],
    })
    mkdirSync(join(team.path, 'application'))
    mkdirSync(join(team.path, 'memory'), { recursive: true })
    writeFileSync(join(team.path, 'memory', 'canary'), 'readonly')
    writeFileSync(join(team.path, 'planted.txt'), secret)
    const guidance =
      'Native platform fixture: repository instructions belong to this application scope.'
    if (platformTools) {
      writeFileSync(join(team.path, 'application', 'AGENTS.md'), guidance)
      const git = (...args: string[]) =>
        execFileSync('git', ['-C', team.path, ...args], {
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
        })
      git('init', '-q', '-b', 'main')
      git('add', 'application/AGENTS.md')
      git('commit', '-qm', 'fixture baseline')
    }
    let defaults = putCodingEnvironment(ctx.db, team.id, 0, {
      backend: 'native',
      cwd: 'application',
      env: { CI: 'true', TZ: 'UTC' },
    })
    const assertReleased = () => {
      assert.equal(isActiveAgent(actor.id), false)
      assert.deepEqual(ctx.db.raw.query('SELECT id FROM workspace_writers').all(), [])
      assert.deepEqual(
        ctx.db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
        [],
      )
    }
    const queue = (phase: string, unattended = false) =>
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
              assert(tools.includes('request_verification'))
              if (platformTools) {
                assert(
                  body.includes(guidance),
                  'guarded repository instructions must reach the coding worker',
                )
                assert.equal(tools.includes('browser_tabs'), !unattended)
                assert.equal(tools.includes('browser_navigate'), !unattended)
                assert.equal(tools.includes('mcp__nativeplatform__foo'), !unattended)
              }
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
                assert(!tools.includes(name), `unadmitted native tool ${name}`)
              assert(!body.includes(secret))
              assert(!body.includes(ctx.authToken))
              if (phase === 'inbox')
                assert(
                  messages.every((message) => messageRepo.get(ctx.db, message.id)?.readAt !== null),
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
                          id: `${phase}-bash`,
                          type: 'function',
                          function: {
                            name: 'bash',
                            arguments: JSON.stringify({
                              command: `set -e; test "$CI:$TZ" = true:UTC; test -z "\${!LMSTUDIO@}"; cat ../planted.txt; printf ${phase} > ${phase}-bash; if printf forbidden > ../memory/canary 2>/dev/null; then exit 91; fi`,
                            }),
                          },
                        },
                        {
                          id: `${phase}-coding`,
                          type: 'function',
                          function: {
                            name: 'coding_command',
                            arguments: JSON.stringify({
                              command: `printf ${phase} > ${phase}-coding; cat ../planted.txt`,
                              cwd: 'application',
                              purpose: 'test',
                              timeoutSeconds: 5,
                            }),
                          },
                        },
                        ...(unattended
                          ? [
                              {
                                id: `${phase}-danger`,
                                type: 'function',
                                function: {
                                  name: 'bash',
                                  arguments: JSON.stringify({
                                    command: 'printf "$LMSTUDIO_API_KEY" > must-not-run',
                                  }),
                                },
                              },
                              ...(platformTools
                                ? ['browser_tabs', 'mcp__nativeplatform__foo'].map((name) => ({
                                    id: `${phase}-${name}`,
                                    type: 'function',
                                    function: {
                                      name,
                                      arguments: JSON.stringify(
                                        name === 'browser_tabs' ? { op: 'list' } : {},
                                      ),
                                    },
                                  }))
                                : []),
                            ]
                          : []),
                      ],
                    },
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
        ...(platformTools && !unattended
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
                          id: 'platform-mcp',
                          type: 'function',
                          function: { name: 'mcp__nativeplatform__foo', arguments: '{}' },
                        },
                        {
                          id: 'platform-tabs',
                          type: 'function',
                          function: {
                            name: 'browser_tabs',
                            arguments: JSON.stringify({ op: 'list' }),
                          },
                        },
                        {
                          id: 'platform-snapshot',
                          type: 'function',
                          function: { name: 'browser_snapshot', arguments: '{}' },
                        },
                        {
                          id: 'platform-private',
                          type: 'function',
                          function: {
                            name: 'browser_navigate',
                            arguments: JSON.stringify({ url: forbiddenUrl }),
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
              message: { role: 'assistant', content: `${phase} finished.` },
            },
          ],
        },
      ])
    const messages: ReturnType<typeof messageRepo.send>[] = []
    const invocation = (attemptId: string) =>
      createTrustedTurnInvocation({
        kind: 'operator_http',
        authorization: {
          origin: 'http_chat',
          attemptKind: 'http_chat_ingress',
          attemptId,
          requester: 'user',
          agentId: actor.id,
        },
        turn: { agentId: actor.id, message: 'Run the native command.', attachments: [] },
        bashApprovalMode: 'auto_deny',
      })
    config.set('BAZILION_BASH_SANDBOX', process.platform === 'darwin' ? 'docker' : 'off')
    const earlyLease = await workspaceLifecycle(ctx.db).claim(team.id, team.path, 'agent')
    try {
      await assert.rejects(
        prepareSelectedProtectedExecution(resolveAgent(ctx.db, ctx.paths, actor.id), {
          lease: earlyLease,
          controller: new AbortController(),
          expectedBackend: 'native',
        }),
        process.platform === 'darwin'
          ? /Docker execution is not supported on macOS/
          : /Protected execution selection changed/,
      )
      assert.equal(provider.callCount(), 0)
      assert.deepEqual(ctx.db.raw.query('SELECT id FROM workspace_resources').all(), [])
    } finally {
      await workspaceLifecycle(ctx.db).release(earlyLease)
    }
    config.set('BAZILION_BASH_SANDBOX', 'native')
    queue('configured')
    const foreground = await prepareAgentTurn({ invocation: invocation('selected-configured') })
    assert(foreground.configuredNative)
    assert.equal(foreground.protectedExecution, undefined)
    assert.equal(foreground.configuredDocker, undefined)
    const frames = []
    for await (const frame of runAgentTurn(foreground)) frames.push(frame)
    if (providerFailure) throw providerFailure
    assert(!frames.some((frame) => frame.kind === 'fatal'))
    assert(!JSON.stringify(frames).includes(secret))
    assert.equal(
      readFileSync(join(team.path, 'application', 'configured-coding'), 'utf8'),
      'configured',
    )
    assert.equal(
      readFileSync(join(team.path, 'application', 'configured-bash'), 'utf8'),
      'configured',
    )
    assertReleased()
    const platformEvents = frames.flatMap((frame) => (frame.kind === 'event' ? [frame.event] : []))
    if (platformTools) {
      for (const name of ['mcp__nativeplatform__foo', 'browser_tabs', 'browser_snapshot']) {
        assert(
          platformEvents.some((event) => event.type === 'tool_result' && event.name === name),
          `actual ${name} IPC result missing`,
        )
        assert(
          !platformEvents.some((event) => event.type === 'tool_error' && event.name === name),
          `actual ${name} failed`,
        )
      }
      assert(
        platformEvents.some(
          (event) =>
            event.type === 'tool_error' &&
            event.name === 'browser_navigate' &&
            /blocked|private|loopback/i.test(event.error),
        ),
      )
      assert.equal(privateHits, 0)
      assert.equal(resources().browsers.get(actor.id)?.state, 'running')
      assert(mcpServer)
      assert(
        resources().mcp.has(mcpServer),
        'MCP must remain daemon-owned after coding worker exit',
      )
    }

    // A stale public selection must refuse before a provider request or executable worker input.
    const stale = await prepareAgentTurn({ invocation: invocation('selected-config-changed') })
    assert(stale.configuredNative)
    config.set('BAZILION_BASH_SANDBOX', 'off')
    const callsBefore = provider.callCount()
    await assert.rejects(async () => {
      for await (const _frame of runAgentTurn(stale)) {
      }
    }, /Native execution selection changed/)
    assert.equal(provider.callCount(), callsBefore)
    assertReleased()
    config.set('BAZILION_BASH_SANDBOX', 'native')

    const browserLastUsed = resources().browsers.get(actor.id)?.lastUsedAt
    const mcpLastUsed = mcpServer ? resources().mcp.get(mcpServer)?.lastUsedAt : undefined
    // The real scheduler consumes a due occurrence once through native protected preparation.
    queue('scheduled', true)
    const trigger = triggerRepo.insert(ctx.db, {
      agentId: actor.id,
      kind: 'interval',
      intervalSec: 1,
      cronExpr: null,
      message: 'Run the declared native scheduled fixture.',
    })
    ctx.db.raw.run('UPDATE agent_triggers SET created_at=? WHERE id=?', [
      Date.now() - 2000,
      trigger.id,
    ])
    await _tickOnce()
    triggerRepo.setEnabled(ctx.db, trigger.id, false)
    if (providerFailure) throw providerFailure
    assert.deepEqual(
      ctx.db.raw
        .query<{ status: string; attempt_count: number }, []>(
          'SELECT status,attempt_count FROM trigger_dispatches',
        )
        .all()
        .map((row) => ({ ...row })),
      [{ status: 'succeeded', attempt_count: 1 }],
    )
    assert.equal(
      readFileSync(join(team.path, 'application', 'scheduled-coding'), 'utf8'),
      'scheduled',
    )
    assert.equal(
      readFileSync(join(team.path, 'application', 'scheduled-bash'), 'utf8'),
      'scheduled',
    )
    assertReleased()

    // An incompatible saved Docker default cannot claim inbox messages or fall back to Docker/host.
    for (let n = 0; n < 8; n++)
      messages.push(
        sendAgentMessage(ctx.db, {
          from: sender.id,
          to: actor.id,
          payload: `Run the native inbox fixture ${n}`,
          origin: 'agent_tool',
          attemptKind: 'agent_tool',
          attemptId: `selected-inbox-${n}`,
        }),
      )
    defaults = putCodingEnvironment(ctx.db, team.id, defaults.revision, {
      backend: 'docker',
      image: 'must-not-start',
      cwd: 'application',
      env: {},
    })
    const beforeInbox = provider.callCount()
    await _tickOnce()
    assert.equal(provider.callCount(), beforeInbox)
    assert(messages.every((message) => messageRepo.get(ctx.db, message.id)?.readAt === null))
    assertReleased()
    putCodingEnvironment(ctx.db, team.id, defaults.revision, {
      backend: 'native',
      cwd: 'application',
      env: { CI: 'true', TZ: 'UTC' },
    })
    queue('inbox', true)
    await _tickOnce()
    if (providerFailure) throw providerFailure
    assert(messages.every((message) => messageRepo.get(ctx.db, message.id)?.readAt !== null))
    assert.equal(readFileSync(join(team.path, 'application', 'inbox-coding'), 'utf8'), 'inbox')
    assert.equal(readFileSync(join(team.path, 'application', 'inbox-bash'), 'utf8'), 'inbox')
    assert.equal(provider.callCount(), platformTools ? 7 : 6)
    assert.equal(readFileSync(join(team.path, 'memory', 'canary'), 'utf8'), 'readonly')
    assert.equal(existsSync(join(team.path, 'application', 'must-not-run')), false)
    const receipts = ctx.db.raw
      .query<{ receipt_json: string }, []>('SELECT receipt_json FROM coding_commands')
      .all()
      .map((row) => JSON.parse(row.receipt_json))
    assert.equal(receipts.length, 3)
    assert(
      receipts.every(
        (receipt) =>
          receipt.environment.posture === 'native' &&
          receipt.environment.imageId === null &&
          receipt.state === 'succeeded',
      ),
    )
    assert(!JSON.stringify(receipts).includes(secret))
    assertReleased()
    const shutdownMessage = sendAgentMessage(ctx.db, {
      from: sender.id,
      to: actor.id,
      payload: 'shutdown during native readiness',
      origin: 'agent_tool',
    })
    const preparingTick = _tickOnce()
    const observeDeadline = performance.now() + 5000
    let observedAcknowledged = false
    while (performance.now() < observeDeadline) {
      observedAcknowledged = !!ctx.db.raw
        .query(
          'SELECT id FROM workspace_resources WHERE creation_acknowledged=1 AND cleanup_confirmed=0',
        )
        .get()
      if (observedAcknowledged) break
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    assert(observedAcknowledged, 'actual readiness resource was not acknowledged')
    assert.equal(isActiveAgent(actor.id), false)
    assert.equal(messageRepo.get(ctx.db, shutdownMessage.id)?.readAt, null)
    await stopScheduler()
    await preparingTick
    assert.equal(provider.callCount(), platformTools ? 7 : 6)
    assert.equal(messageRepo.get(ctx.db, shutdownMessage.id)?.readAt, null)
    assertReleased()
    if (platformTools) {
      assert.equal(privateHits, 0)
      assert.equal(resources().browsers.get(actor.id)?.lastUsedAt, browserLastUsed)
      assert(mcpServer)
      assert.equal(resources().mcp.get(mcpServer)?.lastUsedAt, mcpLastUsed)
      await retirePlatform()
      assert(
        existsSync(ctx.paths.browserDir(actor.id)),
        'stop preserves the private browser profile',
      )
    }
    completed = true
    return {
      ...(platformTools
        ? {
            ordinaryNativeDaemonBrowserAndMcp: true,
            guardedRepositoryInstructions: true,
            managedBlankPageAndPrivateSsrfDenial: true,
            backgroundCannotUseBrowserOrMcp: true,
            daemonResourceRetirementConfirmed: true,
            browserSiteJourneyQualified: false,
          }
        : {}),
      node: process.version,
      platform: process.platform,
      explicitInstallationNativeSelection: true,
      actualConfiguredTurn: true,
      selectionDriftRefusedBeforeWorkerOrProvider: true,
      nativeIntentCannotBecomeDockerDuringPreparation: true,
      actualScheduledTick: true,
      actualInboxTick: true,
      unavailableInboxLeavesEightUnread: true,
      shutdownDrainsAcknowledgedUnregisteredNativeReadiness: true,
      nativeBashAndCoding: true,
      readonlyMemory: true,
      liveRedaction: true,
      unattendedDangerAutoDenied: true,
      resourcesSettled: true,
      providerTransport: 'synthetic-loopback',
      installedClientQualified: false,
      dockerRetired: false,
    }
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    await stopScheduler()
    try {
      await retirePlatform()
    } finally {
      if (privateOrigin)
        await new Promise<void>((resolve, reject) =>
          privateOrigin.close((error) => (error ? reject(error) : resolve())),
        )
      await provider.stop()
      if (completed) {
        closeCtxForShutdown()
        daemonLiveness?.stop()
      } else console.error(`Selected native turns fixture retained: ${root}`)
      if (saved.home === undefined) delete process.env.BAZILION_HOME
      else process.env.BAZILION_HOME = saved.home
      if (saved.scheduler === undefined) delete process.env.BAZILION_SCHEDULER
      else process.env.BAZILION_SCHEDULER = saved.scheduler
      if (saved.policy === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
      else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = saved.policy
    }
  }
}
