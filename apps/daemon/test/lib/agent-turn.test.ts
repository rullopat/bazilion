import type { ChatFrame } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, openConfig, providerStateRepo, spawnAgent } from '../../src/core/index.ts'
import type { InjectedMcpTool, McpHost } from '../../src/runtime/worker/ipc-protocol.ts'
import type { AgentTurnWorkerSpec } from '../../src/runtime/worker/runtime.ts'
import type { AgentTurnSpawnOptions } from '../../src/runtime/worker/spawn.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

// One rule for every origin: an unattended turn is prepared and run like chat, with the same
// tools; only dangerous-command approval differs (auto-deny).
let env: TestEnv
let agentId: string
let spawned: Array<{ spec: AgentTurnWorkerSpec; hosts: AgentTurnSpawnOptions }>
const mcpTool: InjectedMcpTool = {
  toolName: 'mcp__notes__lookup',
  serverId: 'notes',
  rawName: 'lookup',
  description: 'Look up a note.',
  inputSchema: { type: 'object' },
}
const mcpHost: McpHost = { invoke: async () => [] }
const priorSandbox = process.env.BAZILION_BASH_SANDBOX

beforeEach(() => {
  delete process.env.BAZILION_BASH_SANDBOX
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'worker', defaultModel: 'lmstudio:test-model' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'worker', teamId: env.teamId }).id
  providerStateRepo.setEnabled(env.db, 'lmstudio', true)
  // A configured search backend: every turn kind gets web_search from it.
  openConfig(env.db).set('SEARXNG_URL', 'http://127.0.0.1:8888')
  spawned = []
  vi.resetModules()
  vi.doMock('../../src/lib/ctx.ts', () => ({
    getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-auth' }),
  }))
  vi.doMock('../../src/runtime/index.ts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/runtime/index.ts')>()),
    spawnWorkerTurn: (spec: AgentTurnWorkerSpec, hosts: AgentTurnSpawnOptions) => {
      spawned.push({ spec, hosts })
      return (async function* (): AsyncGenerator<ChatFrame> {
        yield { kind: 'done', messages: [] }
      })()
    },
  }))
  vi.doMock('../../src/lib/mcp/resolve.ts', () => ({
    resolveMcpForTurn: async () => ({ tools: [mcpTool], host: mcpHost }),
  }))
})

afterEach(() => {
  vi.doUnmock('../../src/lib/ctx.ts')
  vi.doUnmock('../../src/runtime/index.ts')
  vi.doUnmock('../../src/lib/mcp/resolve.ts')
  vi.resetModules()
  env.cleanup()
  if (priorSandbox === undefined) delete process.env.BAZILION_BASH_SANDBOX
  else process.env.BAZILION_BASH_SANDBOX = priorSandbox
})

async function runTurn(origin: 'http' | 'trigger' | 'inbox') {
  const { registerAgent } = await import('../../src/lib/agent-cancel.ts')
  const { prepareAgentTurn, runAgentTurn } = await import('../../src/lib/agent-turn.ts')
  const turn = {
    attemptId: `${origin}-attempt`,
    agentId,
    message: `${origin} work`,
    attachments: [],
    conversationId: seedRegisteredConversation(env.db, env.paths, agentId).id,
  }
  let prepared: Awaited<ReturnType<typeof prepareAgentTurn>>
  if (origin === 'http') {
    prepared = await prepareAgentTurn({ ...turn, origin, bashApprovalMode: 'interactive' })
  } else {
    // The scheduler's own handoff: the registration is claimed first.
    const controller = new AbortController()
    registerAgent(agentId, controller)
    prepared = await prepareAgentTurn({ ...turn, origin, claim: { controller } })
  }
  const frames: ChatFrame[] = []
  for await (const frame of runAgentTurn(prepared)) frames.push(frame)
  expect(frames).toEqual([{ kind: 'done', messages: [] }])
  const call = spawned.at(-1)
  if (!call) throw new Error('no worker was spawned')
  return call
}

/** What the worker is offered: the hosts behind its tools, and its MCP tools and sandbox. */
function offered({ spec, hosts }: Awaited<ReturnType<typeof runTurn>>) {
  return {
    mcpTools: spec.mcpTools,
    docker: spec.docker,
    hosts: Object.entries(hosts)
      .filter(([, value]) => value !== undefined)
      .map(([name]) => name)
      .sort(),
  }
}

test.each([
  'trigger',
  'inbox',
] as const)('%s: an unattended turn gets the same tools as chat and auto-denies dangerous commands', async (origin) => {
  const chat = await runTurn('http')
  const unattended = await runTurn(origin)

  expect(offered(unattended)).toEqual(offered(chat))
  expect(unattended.spec.mcpTools).toEqual([mcpTool])
  expect(unattended.hosts.browserHost).toBeDefined()
  expect(unattended.hosts.webSearchHost).toBeDefined()
  expect(unattended.hosts.mcpHost).toBe(mcpHost)
  // With BAZILION_BASH_SANDBOX unset (off) both run host bash; no Docker runtime is prepared.
  expect(unattended.spec.docker).toBeUndefined()
  expect(chat.spec.bashApprovalMode).toBe('interactive')
  expect(unattended.spec.bashApprovalMode).toBe('auto_deny')
})

test('a provider that cannot serve the Agent is refused at admission, before any worker starts', async () => {
  // An admission refusal (HTTP 409, a failed queue item, inbox messages left unread for a retry),
  // never a turn that may have run.
  providerStateRepo.setEnabled(env.db, 'lmstudio', false)
  await expect(runTurn('http')).rejects.toMatchObject({
    name: 'ExecutionUnavailableError',
    message: expect.stringMatching(/lmstudio provider is disabled/),
  })

  createProfile(env.db, env.paths, { id: 'codex', defaultModel: 'openai-codex:gpt-6-astra' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'codex', teamId: env.teamId }).id
  providerStateRepo.setEnabled(env.db, 'openai-codex', true)
  await expect(runTurn('http')).rejects.toMatchObject({
    name: 'ExecutionUnavailableError',
    message: expect.stringMatching(/openai-codex is not connected/),
  })
  expect(spawned).toEqual([])
})

test('the worker environment, and so every shell command, never carries Bazilion’s own credentials', async () => {
  const { openSecrets } = await import('../../src/core/index.ts')
  const secrets = openSecrets(env.db, 'test-auth')
  secrets.set('ANTHROPIC_API_KEY', 'provider-key')
  secrets.set('OPENAI_CODEX_OAUTH', '{"refresh":"r","access":"a","expires":1}')
  secrets.set('TELEGRAM_BOT_TOKEN', '123:bot')
  secrets.set('MCP_TOKEN_ABC123', 'mcp-bearer')
  const prior = { token: process.env.BAZILION_TOKEN, copy: process.env.COPIED_BOOTSTRAP }
  process.env.BAZILION_TOKEN = 'cli-bearer'
  process.env.COPIED_BOOTSTRAP = 'test-auth'
  try {
    const { hosts } = await runTurn('http')
    expect(hosts.env.ANTHROPIC_API_KEY).toBe('provider-key')
    for (const internal of [
      'OPENAI_CODEX_OAUTH',
      'TELEGRAM_BOT_TOKEN',
      'MCP_TOKEN_ABC123',
      'BAZILION_TOKEN',
      'COPIED_BOOTSTRAP',
    ])
      expect(hosts.env).not.toHaveProperty(internal)
    expect(Object.values(hosts.env)).not.toContain('test-auth')
  } finally {
    if (prior.token === undefined) delete process.env.BAZILION_TOKEN
    else process.env.BAZILION_TOKEN = prior.token
    if (prior.copy === undefined) delete process.env.COPIED_BOOTSTRAP
    else process.env.COPIED_BOOTSTRAP = prior.copy
  }
})
