import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodingCommandReceipt, NativeExecutionRequest } from '@bazilion/api-types'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, expect, test as platformTest, vi } from 'vitest'
import { createProfile, resolveAgent, spawnAgent } from '../../src/core/index.ts'
import { resolveRepositoryContext } from '../../src/lib/repository-context/index.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import type { CodingHost } from '../../src/runtime/pi/coding-contract.ts'
import {
  type CreateProtectedBazilionSessionOptions,
  createBazilionSession,
  createProtectedBazilionSession,
} from '../../src/runtime/pi/session.ts'
import type { ProtectedDockerRuntime } from '../../src/runtime/shell/docker.ts'
import { snapshotNativeSessionExecution } from '../../src/runtime/shell/native-tooling.ts'
import type { NativeExecutionHost } from '../../src/runtime/worker/ipc-protocol.ts'
import { createMinimalWorkerScratch } from '../../src/runtime/worker/runtime.ts'
import { makeTestEnv } from '../core/helpers.ts'

// Supported native SDK admission is Linux-only. Mac refusal has dedicated coverage;
// these synthetic proxy contracts remain mandatory on Linux, not Mac qualification.
const test = platformTest.skipIf(process.platform !== 'linux')
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
})

async function fixture() {
  const env = makeTestEnv()
  cleanups.push(env.cleanup)
  createProfile(env.db, env.paths, {
    id: 'native-session',
    defaultModel: 'openai-codex:gpt-5.6-sol',
  })
  const id = spawnAgent(env.db, env.paths, { profileId: 'native-session', teamId: env.teamId }).id
  const agent = resolveAgent(env.db, env.paths, id)
  const workspace = realpathSync(agent.team.path)
  mkdirSync(join(workspace, 'application'))
  mkdirSync(join(workspace, 'memory'), { recursive: true })
  const scratch = createMinimalWorkerScratch(env.home)
  const memory: MemoryBackend = {
    async init() {},
    async read() {
      throw new Error('unused')
    },
    async write() {
      throw new Error('unused')
    },
    async search() {
      return []
    },
    async list() {
      return []
    },
    async remove() {},
  }
  const calls: NativeExecutionRequest[] = []
  const host: NativeExecutionHost = {
    cancel: () => false,
    async exec(request, output) {
      calls.push(request)
      output('stdout', Buffer.from('SIMULATED_NATIVE_PROXY_OUTPUT'))
      return { code: 0, signal: null, stdoutTruncated: false, stderrTruncated: false }
    },
  }
  // These intentionally synthetic receipt replies exercise SDK routing only. They are not stored,
  // do not claim native evidence, and do not replace actual backend/security qualification.
  const codingHost: CodingHost = {
    invoke: vi.fn(async (request) => {
      if (request.action === 'start')
        return { id: 'simulated-receipt', startedAt: Date.now() } as CodingCommandReceipt
      if (request.action === 'finish')
        return { id: request.id, ...request.outcome } as CodingCommandReceipt
      throw new Error('unused simulated coding host action')
    }),
  }
  const repositoryContext = await resolveRepositoryContext({ teamId: env.teamId, root: workspace })
  const repositoryContextHost = (target: string) =>
    resolveRepositoryContext({ teamId: env.teamId, root: workspace, target })
  const token = 'synthetic-native-session-provider-key'
  const conversationId = randomUUID()
  writeFileSync(
    join(agent.agent.dir, 'sessions', `${conversationId}.jsonl`),
    `${JSON.stringify(SessionManager.inMemory(workspace, { id: conversationId }).getHeader())}\n`,
    { flag: 'wx' },
  )
  const nativeExecution = { cwd: 'application', host }
  const protectedOptions: CreateProtectedBazilionSessionOptions = {
    agent,
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: agent.reasoningLevel,
      apiKey: token,
    },
    paths: {
      agentDir: agent.agent.dir,
      teamDir: agent.team.path,
      memoryDir: join(workspace, 'memory'),
      sessionDir: join(agent.agent.dir, 'sessions'),
      skills: [],
      homeDocuments: {
        'AGENTS.md': 'Private Agent instructions',
        'SOUL.md': null,
        'TOOLS.md': null,
        'IDENTITY.md': null,
        'BOOTSTRAP.md': null,
      },
    },
    scratch,
    nativeExecution,
    memory,
    codingHost,
    repositoryContext,
    repositoryContextHost,
    conversation: { id: conversationId, filename: `${conversationId}.jsonl` },
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
    bashApprovalHost: { requestApproval: async () => 'denied' },
    fileSink: async () => ({ resultId: 'unused' }),
    refreshApiKey: async () => token,
  }
  const configuredOptions = {
    agent,
    paths: env.paths,
    env: {},
    enabledProviders: new Set(['openai-codex']),
    apiKey: token,
    nativeExecution,
    memory,
    codingHost,
    repositoryContext,
    repositoryContextHost,
    conversation: protectedOptions.conversation,
  }
  return { ...env, workspace, calls, host, nativeExecution, protectedOptions, configuredOptions }
}

test.each([
  'configured',
  'protected',
] as const)('native %s SDK session routes both coding tools through one proxy and excludes host tools', async (kind) => {
  const f = await fixture()
  const creating =
    kind === 'configured'
      ? createBazilionSession(f.configuredOptions)
      : createProtectedBazilionSession(f.protectedOptions)
  // Async provider/loader preparation must not adopt caller mutations.
  f.nativeExecution.cwd = 'unadmitted-after-preparation'
  const handle = await creating
  try {
    const names = handle.session.getAllTools().map((tool) => tool.name)
    expect(names).toContain('bash')
    expect(names).toContain('coding_command')
    expect(
      names.filter((name) => ['read', 'edit', 'write', 'grep', 'find', 'ls'].includes(name)),
    ).toEqual([])
    expect(
      names.some((name) => ['codemode', 'tool_search'].includes(name) || name.startsWith('mcp__')),
    ).toBe(false)
    expect(handle.session.settingsManager.getCacheWarmingMode()).toBe('off')
    expect(handle.session.systemPrompt).toContain(f.workspace)
    expect(handle.session.systemPrompt).toContain('including localhost')
    expect(handle.session.systemPrompt).not.toContain(
      'ephemeral,\nnetwork-disabled Docker container',
    )
    let rounds = 0
    // Real Pi SDK tool dispatch, synthetic provider and native transport: not a live-model or
    // installed/native-kernel acceptance claim. In particular this checks the actual SDK ctx.cwd.
    handle.session.agent.streamFunction = (model) => {
      const stream = createAssistantMessageEventStream()
      const tools = rounds++ === 0
      queueMicrotask(() =>
        stream.push({
          type: 'done',
          reason: tools ? 'toolUse' : 'stop',
          message: message(model, tools),
        }),
      )
      return stream
    }
    await handle.session.prompt('Exercise the synthetic native proxy routing fixture.')
    expect(rounds).toBe(2)
    expect(f.calls).toEqual([
      {
        toolCallId: 'native-session-bash',
        command: 'printf proxy-bash',
        cwd: 'application',
        timeoutMs: 2000,
      },
      {
        toolCallId: 'native-session-coding',
        command: 'printf proxy-coding',
        cwd: '.',
        timeoutMs: 2000,
      },
    ])
    expect(handle.session.getLastAssistantText()).toBe('finished synthetic routing')
  } finally {
    handle.dispose()
  }
})

test.each([
  'configured',
  'protected',
] as const)('native %s session refuses unavailable protection without a local bash/coding fallback', async (kind) => {
  const f = await fixture()
  const marker = join(f.workspace, 'host-fallback-forbidden')
  f.host.exec = async () => {
    throw Object.assign(new Error('Native protection unavailable'), {
      code: 'unavailable',
      cleanupConfirmed: true,
    })
  }
  const handle = await (kind === 'configured'
    ? createBazilionSession(f.configuredOptions)
    : createProtectedBazilionSession(f.protectedOptions))
  try {
    const context = {
      cwd: join(f.workspace, 'application'),
      sessionManager: handle.session.sessionManager,
    } as never
    const bash = handle.session.getToolDefinition('bash'),
      coding = handle.session.getToolDefinition('coding_command')
    if (!bash || !coding) throw new Error('Native session tools missing')
    await expect(
      bash.execute(
        'failed-bash',
        { command: `printf forbidden > '${marker}'` },
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow('Native protection unavailable')
    const result = await coding.execute(
      'failed-coding',
      { command: `printf forbidden > '${marker}'`, cwd: '.', purpose: 'test', timeoutSeconds: 2 },
      undefined,
      undefined,
      context,
    )
    expect(result.details).toMatchObject({ codingReceipt: { state: 'blocked' } })
    expect(existsSync(marker)).toBe(false)
  } finally {
    handle.dispose()
  }
})

test('native protected session requires exactly one backend before creating a provider/session', async () => {
  const f = await fixture()
  await expect(
    createProtectedBazilionSession({ ...f.protectedOptions, nativeExecution: undefined }),
  ).rejects.toThrow('exactly one execution backend')
  await expect(
    createProtectedBazilionSession({ ...f.protectedOptions, docker: {} as ProtectedDockerRuntime }),
  ).rejects.toThrow('exactly one execution backend')
  await expect(
    createProtectedBazilionSession({
      ...f.protectedOptions,
      dockerLifecycle: {
        name: () => 'unused',
        async beforeCreate() {},
        async afterCreate() {},
        async afterRemove() {},
      },
    }),
  ).rejects.toThrow('exactly one execution backend')
})

test('native configured session rejects a Docker selection and restricted-mode capability widening', async () => {
  const f = await fixture()
  for (const mode of ['docker', ' docker '])
    await expect(
      createBazilionSession({ ...f.configuredOptions, env: { BAZILION_BASH_SANDBOX: mode } }),
    ).rejects.toThrow('another execution backend')
  await expect(
    createBazilionSession({ ...f.configuredOptions, env: { BAZILION_BASH_SANDBOX: 'unknown' } }),
  ).rejects.toThrow('BAZILION_BASH_SANDBOX must be')
  await expect(
    createBazilionSession({ ...f.configuredOptions, restricted: {} as never }),
  ).rejects.toThrow('restricted mode')
})

test('native session proxy description is closed and refuses environment/root/backend overrides', () => {
  const host = {
    exec: async () => ({ code: 0, signal: null, stdoutTruncated: false, stderrTruncated: false }),
    cancel: () => false,
  }
  for (const extra of [{ env: {} }, { workspace: '/unadmitted' }, { backend: 'host' }])
    expect(() => snapshotNativeSessionExecution({ cwd: '.', host, ...extra })).toThrow(
      'unavailable',
    )
  expect(() => snapshotNativeSessionExecution({ cwd: '../escape', host })).toThrow()
})

function message(model: Model<Api>, tools: boolean): AssistantMessage {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: tools
      ? [
          {
            type: 'toolCall',
            id: 'native-session-bash',
            name: 'bash',
            arguments: { command: 'printf proxy-bash', timeout: 2 },
          },
          {
            type: 'toolCall',
            id: 'native-session-coding',
            name: 'coding_command',
            arguments: {
              command: 'printf proxy-coding',
              cwd: '.',
              purpose: 'test',
              timeoutSeconds: 2,
            },
          },
        ]
      : [{ type: 'text', text: 'finished synthetic routing' }],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: tools ? 'toolUse' : 'stop',
    timestamp: Date.now(),
  }
}
