import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, test } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import { loadRepositoryInstructions } from '../../src/lib/repository-instructions.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import { createBazilionSession, describeTurn } from '../../src/runtime/pi/session.ts'
import { seedConversationTarget } from '../fixtures/conversation.ts'

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
    // A turn compacts the conversation near the window, with Pi's own margins.
    expect(handle.session.settingsManager.getCompactionEnabled()).toBe(true)
    expect(handle.session.settingsManager.getCompactionReserveTokens()).toBe(16_384)
    expect(handle.session.settingsManager.getCompactionKeepRecentTokens()).toBe(20_000)
    // Pi's own codemode is given in code (BAZ-100); the repository's .pi extension never runs, and
    // with no MCP tools there is nothing for tool_search to find.
    const toolNames = handle.session.getAllTools().map((tool) => tool.name)
    expect(toolNames).toContain('codemode')
    expect(handle.session.getActiveToolNames()).not.toContain('tool_search')
    expect(toolNames.some((name) => name.startsWith('mcp__'))).toBe(false)
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
    const tools = handle.session.agent.state.tools
    expect(tools.map((tool) => tool.name)).toContain('bash')
    // The file tools are there, but Bazilion's own on container paths, never Pi's host ones.
    for (const name of ['read', 'edit', 'write', 'grep', 'find', 'ls', 'apply_patch']) {
      const tool = tools.find((candidate) => candidate.name === name)
      expect(tool?.description, name).toMatch(/Paths are the container's/)
      expect(tool?.description, name).not.toContain(teamDir)
    }
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
        expect.arrayContaining(['read', 'bash', 'memory_write', 'recall', 'web_search']),
      )
      expect(handle.session.systemPrompt).toContain(described.systemPrompt)
      expect(described.promptSections.map((section) => section.id)).toContain('search-guide')
    } finally {
      handle.dispose()
    }
  })

  test("a session's recall reads its own conversation, without the turn's credentials", async () => {
    const root = temporaryRoot()
    const paths = resolvePaths(root)
    const agentDir = paths.agentDir('agent-1')
    const teamDir = paths.teamDir('team-1')
    for (const path of [join(agentDir, 'sessions'), join(teamDir, 'memory')])
      mkdirSync(path, { recursive: true })
    const sessions = join(agentDir, 'sessions')
    const conversation = seedConversationTarget(sessions, teamDir)
    const file = SessionManager.open(join(sessions, `${conversation.id}.jsonl`), sessions, teamDir)
    const say = (text: string) =>
      file.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: 1 })
    say('Use the key recall-session-fixture-key for the launch upload.')
    const kept = say('Now write the post.')
    file.appendCompaction('The user gave a key for the upload.', kept, 9_000)
    const handle = await createBazilionSession({
      agent: { ...resolvedAgent(agentDir, teamDir), skills: [] },
      paths,
      conversation,
      env: {
        BAZILION_BASH_SANDBOX: 'off',
        BAZILION_BASH_APPROVAL: 'off',
        LAUNCH_API_KEY: 'recall-session-fixture-key',
      },
      memory: memoryBackend(),
      apiKey: 'session-prompt-access-token',
    })
    try {
      const recall = handle.session.agent.state.tools.find((tool) => tool.name === 'recall')
      const result = await recall?.execute('call-1', { query: 'launch upload' })
      const text = result?.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
      expect(text).toContain('#1 · user')
      expect(text).toContain('Use the key [REDACTED] for the launch upload.')
    } finally {
      handle.dispose()
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
    contextWindowSetting: null,
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
