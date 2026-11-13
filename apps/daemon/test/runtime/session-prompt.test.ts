import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { afterEach, describe, expect, test } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import { loadRepositoryInstructions } from '../../src/lib/repository-instructions.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import {
  createBazilionSession,
  createRestrictedReviewSession,
  describeTurn,
} from '../../src/runtime/pi/session.ts'
import {
  cleanupMinimalWorkerScratch,
  createMinimalWorkerScratch,
} from '../../src/runtime/worker/runtime.ts'
import { seedConversationTarget } from '../fixtures/conversation.ts'
import { startMockServer } from './mock-server.ts'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('session prompt boundary', () => {
  test('an Agent session loads root repository instructions and never auto-discovers .pi resources', async () => {
    const root = temporaryRoot()
    const paths = resolvePaths(root)
    const agentDir = paths.agentDir('agent-1')
    const teamDir = paths.teamDir('team-1')
    for (const path of [join(agentDir, 'sessions'), join(teamDir, 'memory')])
      mkdirSync(path, { recursive: true })
    writeFileSync(join(agentDir, 'AGENTS.md'), 'PRIVATE_AGENT_SENTINEL\n')
    mkdirSync(join(teamDir, '.pi', 'extensions'), { recursive: true })
    mkdirSync(join(teamDir, '.pi', 'skills', 'untrusted'), { recursive: true })
    writeFileSync(
      join(teamDir, '.pi', 'extensions', 'untrusted.ts'),
      "throw new Error('REPOSITORY_EXTENSION_EXECUTED')",
    )
    writeFileSync(
      join(teamDir, '.pi', 'skills', 'untrusted', 'SKILL.md'),
      '---\nname: untrusted\ndescription: Untrusted fixture\n---\nAUTO_DISCOVERY_SKILL_SENTINEL',
    )
    writeFileSync(join(teamDir, 'AGENTS.md'), 'ROOT_REPOSITORY_SENTINEL\n')
    mkdirSync(join(teamDir, 'application'))
    writeFileSync(join(teamDir, 'application', 'AGENTS.md'), 'NESTED_REPOSITORY_SENTINEL\n')
    const handle = await createBazilionSession({
      repositoryInstructions: loadRepositoryInstructions(teamDir),
      conversation: seedConversationTarget(join(agentDir, 'sessions'), teamDir),
      agent: { ...resolvedAgent(agentDir, teamDir), skills: [] },
      paths,
      env: { BAZILION_BASH_SANDBOX: 'off', BAZILION_BASH_APPROVAL: 'off' },
      memory: memoryBackend(),
      apiKey: 'session-prompt-access-token',
    })
    expect(handle.session.settingsManager.getCacheWarmingMode()).toBe('off')
    expect(
      handle.session
        .getAllTools()
        .some(
          (tool) =>
            ['codemode', 'tool_search'].includes(tool.name) || tool.name.startsWith('mcp__'),
        ),
    ).toBe(false)
    let providerSystemPrompt = ''
    let calls = 0
    handle.session.agent.streamFunction = (model) => {
      calls++
      return completedStream(model)
    }
    try {
      await handle.session.prompt('inspect the prompt')
      providerSystemPrompt = handle.session.systemPrompt
    } finally {
      handle.dispose()
    }

    expect(calls).toBe(1)
    // The root instructions are loaded up front; a nested AGENTS.md is read when work reaches it.
    expect(providerSystemPrompt).toContain('ROOT_REPOSITORY_SENTINEL')
    expect(providerSystemPrompt).toContain(`${teamDir}/AGENTS.md`)
    expect(providerSystemPrompt).not.toContain('NESTED_REPOSITORY_SENTINEL')
    expect(providerSystemPrompt).toContain('govern its own directory and everything below it')
    expect(providerSystemPrompt).not.toContain('AUTO_DISCOVERY_SKILL_SENTINEL')
    expect(providerSystemPrompt).toContain('# Agent instructions')
    expect(providerSystemPrompt).toContain('PRIVATE_AGENT_SENTINEL')
    // T10: the browser operating guide follows the browser tools; no host, no guide.
    expect(providerSystemPrompt).not.toContain('# Browser research')
  })

  test('a Docker-sandboxed session tells the model container paths, never host paths', async () => {
    const root = temporaryRoot()
    const paths = resolvePaths(root)
    const agentDir = paths.agentDir('agent-1')
    const teamDir = paths.teamDir('team-1')
    const skillDir = join(paths.skillsDir, 'audit-skill')
    for (const path of [join(agentDir, 'sessions'), join(teamDir, 'memory'), join(teamDir, 'app')])
      mkdirSync(path, { recursive: true })
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: audit-skill\ndescription: A test skill.\n---\nUse the mounted helper when needed.',
    )
    writeFileSync(join(teamDir, 'AGENTS.md'), 'ROOT_REPOSITORY_SENTINEL\n')
    writeFileSync(join(teamDir, 'app', 'AGENTS.md'), 'APP_REPOSITORY_SENTINEL\n')
    const handle = await createBazilionSession({
      repositoryInstructions: loadRepositoryInstructions(teamDir, 'app'),
      conversation: seedConversationTarget(join(agentDir, 'sessions'), teamDir),
      agent: resolvedAgent(agentDir, teamDir),
      paths,
      env: { BAZILION_BASH_SANDBOX: 'docker', BAZILION_BASH_APPROVAL: 'off' },
      docker: {
        image: 'test:image',
        cwd: 'app',
        containerPrefix: `bazilion-${'1'.repeat(12)}-${'2'.repeat(12)}-`,
      },
      memory: memoryBackend(),
      apiKey: 'session-prompt-access-token',
    })
    const tools = handle.session.agent.state.tools.map((tool) => tool.name)
    expect(tools).toContain('bash')
    for (const hostTool of ['read', 'edit', 'write', 'grep', 'find', 'ls'])
      expect(tools).not.toContain(hostTool)
    let providerSystemPrompt = ''
    handle.session.agent.streamFunction = (model) => completedStream(model)
    try {
      await handle.session.prompt('inspect the prompt')
      providerSystemPrompt = handle.session.systemPrompt
    } finally {
      handle.dispose()
    }

    expect(providerSystemPrompt).toContain('ROOT_REPOSITORY_SENTINEL')
    expect(providerSystemPrompt).toContain('/workspace/AGENTS.md')
    expect(providerSystemPrompt).toContain('APP_REPOSITORY_SENTINEL')
    expect(providerSystemPrompt).toContain('/workspace/app/AGENTS.md')
    expect(providerSystemPrompt).toContain('- team-1 (Team One): /workspace\n')
    // Pi's working directory is the container's: the Team's coding cwd under /workspace.
    expect(providerSystemPrompt).toContain('<cwd>\n/workspace/app\n</cwd>')
    expect(providerSystemPrompt).toContain('Runtime directory: `/skills/0-audit-skill`')
    expect(providerSystemPrompt).not.toContain(root)
  })

  test('restricted review provider context contains no host or package paths', async () => {
    const root = temporaryRoot()
    const scratch = createMinimalWorkerScratch(root)
    const proposalTool: ToolDefinition = {
      name: 'propose_lesson',
      label: 'propose_lesson',
      description: 'Return a bounded proposal set.',
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }], details: {} }
      },
    }
    const handle = await createRestrictedReviewSession({
      runtime: {
        providerName: 'openai-codex',
        modelId: 'gpt-5.6-sol',
        reasoningLevel: 'low',
        apiKey: 'review-prompt-access-token',
      },
      scratch,
      systemPrompt: 'Restricted reviewer instructions. Use propose_lesson only.',
      tools: [proposalTool],
      refreshApiKey: async () => 'review-prompt-access-token',
    })
    expect(handle.session.agent.state.tools.map((tool) => tool.name)).toEqual([proposalTool.name])
    let providerSystemPrompt = ''
    handle.session.agent.streamFunction = (model) => {
      // 0.87.1 composes the effective prompt at request time; the session
      // getter exposes it (the transcript's leading system message is empty).
      providerSystemPrompt = handle.session.systemPrompt
      return completedStream(model)
    }

    try {
      await handle.session.prompt('bounded review digest')
    } finally {
      handle.dispose()
      cleanupMinimalWorkerScratch(scratch)
    }

    // 0.87.1 composes the cwd as a <cwd> block; assert the semantic content.
    expect(providerSystemPrompt).toContain(
      'Restricted reviewer instructions. Use propose_lesson only.',
    )
    expect(providerSystemPrompt).toContain('<cwd>\n/review\n</cwd>')
    expect(providerSystemPrompt).not.toContain(root)
    expect(providerSystemPrompt).not.toContain('node_modules')
    // T10: restricted turns run a daemon-authored system prompt; the browser
    // guide is never composed into them.
    expect(providerSystemPrompt).not.toContain('# Browser research')
  })

  test('the context description matches the tools and prompt a session gets', async () => {
    const root = temporaryRoot()
    const paths = resolvePaths(root)
    const agentDir = paths.agentDir('agent-1')
    const teamDir = paths.teamDir('team-1')
    for (const path of [join(agentDir, 'sessions'), join(teamDir, 'memory')])
      mkdirSync(path, { recursive: true })
    const options = {
      agent: { ...resolvedAgent(agentDir, teamDir), skills: [] },
      paths,
      env: { BAZILION_BASH_SANDBOX: 'off', BAZILION_BASH_APPROVAL: 'off' },
      memory: memoryBackend(),
      webSearchHost: { search: async () => ({}) as never },
    }
    const described = describeTurn(options)
    const handle = await createBazilionSession({
      ...options,
      conversation: seedConversationTarget(join(agentDir, 'sessions'), teamDir),
      apiKey: 'session-prompt-access-token',
    })
    try {
      expect(described.tools.map((tool) => tool.name).sort()).toEqual(
        handle.session.agent.state.tools.map((tool) => tool.name).sort(),
      )
      expect(described.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['read', 'bash', 'memory_write', 'web_search']),
      )
      expect(handle.session.systemPrompt).toContain(described.systemPrompt)
      expect(described.promptSections.map((section) => section.id)).toContain('search-guide')
    } finally {
      handle.dispose()
    }
  })

  test('a session asks for a refreshed token only for its own provider', async () => {
    const root = temporaryRoot()
    const scratch = createMinimalWorkerScratch(root)
    const requests: string[] = []
    const handle = await createRestrictedReviewSession({
      runtime: {
        providerName: 'azure-openai',
        modelId: 'gpt-6.1-sol',
        reasoningLevel: 'low',
        apiKey: 'azure-initial-fixture-token',
      },
      scratch,
      systemPrompt: 'Restricted reviewer instructions.',
      tools: [],
      refreshApiKey: async (provider) => {
        requests.push(provider)
        return 'azure-rotated-fixture-token'
      },
    })
    try {
      // Pi asks by its own provider id ("azure"); other providers get nothing.
      for (const provider of ['openai', 'azure-openai-responses']) {
        expect(await handle.session.agent.getApiKey?.(provider)).toBeUndefined()
      }
      let sentKey: string | undefined
      handle.session.agent.streamFunction = (model, _context, options) => {
        sentKey = options?.apiKey
        return completedStream(model)
      }
      await handle.session.prompt('bounded review digest')
      expect(sentKey).toBe('azure-rotated-fixture-token')
      expect(new Set(requests)).toEqual(new Set(['azure-openai']))
      expect(handle.redactionSecrets).toContain('azure-rotated-fixture-token')
    } finally {
      handle.dispose()
      cleanupMinimalWorkerScratch(scratch)
    }
  })

  test('a static key reaches the provider from memory without a refresher', async () => {
    const root = temporaryRoot()
    const scratch = createMinimalWorkerScratch(root)
    const auth: Array<string | null> = []
    const provider = await startMockServer((req) => {
      auth.push(req.headers.get('authorization'))
      const chunk = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`
      return new Response(
        chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'done' } }] }) +
          chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      )
    })
    const handle = await createRestrictedReviewSession({
      runtime: {
        providerName: 'fireworks',
        modelId: 'accounts/fixture/models/upstream',
        reasoningLevel: 'low',
        apiKey: 'fireworks-static-fixture-key',
        baseUrl: `${provider.url}/v1`,
      },
      scratch,
      systemPrompt: 'Restricted reviewer instructions.',
      tools: [],
    })
    try {
      await handle.session.prompt('bounded review digest')
      expect(auth).toEqual(['Bearer fireworks-static-fixture-key'])
    } finally {
      handle.dispose()
      cleanupMinimalWorkerScratch(scratch)
      await provider.stop()
    }
  })

  test('materializes explicit Vertex credentials only inside turn scratch', async () => {
    const root = temporaryRoot()
    const scratch = createMinimalWorkerScratch(root)
    const content = JSON.stringify({ type: 'service_account', private_key: 'vertex-secret' })
    const handle = await createRestrictedReviewSession({
      runtime: {
        providerName: 'google-vertex',
        modelId: 'gemini-3.6-flash',
        reasoningLevel: 'low',
        credentialEnv: [
          { name: 'GOOGLE_CLOUD_PROJECT', value: 'project-one' },
          { name: 'GOOGLE_CLOUD_LOCATION', value: 'europe-west1' },
        ],
        credentialFile: { envName: 'GOOGLE_APPLICATION_CREDENTIALS', content },
      },
      scratch,
      systemPrompt: 'Restricted reviewer instructions.',
      tools: [],
      refreshApiKey: async () => '',
    })
    const credentialPath = join(scratch.tempDir, 'provider-credential.json')
    try {
      expect(readFileSync(credentialPath, 'utf8')).toBe(content)
      expect(statSync(credentialPath).mode & 0o777).toBe(0o600)
      expect(credentialPath.startsWith(scratch.root)).toBe(true)
    } finally {
      handle.dispose()
      cleanupMinimalWorkerScratch(scratch)
    }
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-session-prompt-test-'))
  cleanup.push(root)
  return root
}

function resolvedAgent(agentDir: string, teamDir: string): ResolvedAgent {
  return {
    agent: {
      id: 'agent-1',
      profileId: 'profile-1',
      name: 'Agent One',
      modelOverride: 'openai-codex:gpt-5.6-sol',
      reasoningLevel: 'high',
      reviewEnabled: true,
      reviewEveryNTurns: 8,
      reviewModel: 'openai-codex:gpt-5.6-sol',
      reviewReasoningLevel: 'low',
      reviewTurnsSinceLast: 0,
      status: 'idle',
      dir: agentDir,
      teamId: 'team-1',
      telegramTopicId: null,
      telegramMirrorMode: 'minimal',
      telegramIconEmoji: null,
      createdAt: 0,
      archivedAt: null,
    },
    profile: {
      id: 'profile-1',
      name: 'Profile One',
      dir: join(agentDir, '..', '..', 'profiles', 'profile-1'),
      defaultModel: 'openai-codex:gpt-5.6-sol',
      skillsMode: 'selected',
      createdAt: 0,
      updatedAt: 0,
    },
    model: 'openai-codex:gpt-5.6-sol',
    reasoningLevel: 'high',
    team: {
      id: 'team-1',
      name: 'Team One',
      path: teamDir,
      userMd: '',
      telegramTopicNameFormat: null,
      policyMode: 'open',
      createdAt: 0,
    },
    skills: ['audit-skill'],
    privateLessons: [],
  }
}

function memoryBackend(): MemoryBackend {
  return {
    init: async () => {},
    read: async () => {
      throw new Error('unused')
    },
    write: async () => {
      throw new Error('unused')
    },
    search: async () => [],
    list: async () => [],
    remove: async () => {},
  }
}

function completedStream(model: Model<Api>) {
  const stream = createAssistantMessageEventStream()
  queueMicrotask(() => {
    stream.push({
      type: 'done',
      reason: 'stop',
      message: assistantMessage(model),
    })
  })
  return stream
}

function assistantMessage(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'done' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}
