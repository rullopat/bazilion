import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import { afterEach, describe, expect, test } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import {
  extractToolResultImages,
  extractToolResultText,
  piMessagesToProviderView,
} from '../../src/runtime/pi/events.ts'
import { createBazilionSession } from '../../src/runtime/pi/session.ts'
import { browserGuideSection } from '../../src/runtime/session/browser-guide.ts'
import { browserTools } from '../../src/runtime/tools/browser.ts'
import { mcpProxyTools } from '../../src/runtime/tools/mcp.ts'
import type { ToolResultPart } from '../../src/runtime/tools/types.ts'
import type { BrowserHost, McpHost } from '../../src/runtime/worker/ipc-protocol.ts'
import { seedConversationTarget } from '../fixtures/conversation.ts'
import { createToolRegistry } from '../fixtures/tool-registry.ts'

test('browserTools proxy every action to the host with the agentId', async () => {
  const calls: Array<{ agentId: string; action: string; args: Record<string, unknown> }> = []
  const host: BrowserHost = {
    async invoke(agentId, action, args) {
      calls.push({ agentId, action, args })
      return [{ type: 'text', text: 'ok' }]
    },
  }
  const reg = createToolRegistry(browserTools(host, 'agent-1'))
  expect(reg.list().map((d) => d.name)).toEqual(
    [
      'navigate',
      'snapshot',
      'click',
      'type',
      'hover',
      'select',
      'fill_form',
      'press_key',
      'go_back',
      'tabs',
      'take_screenshot',
      'console',
      'network',
    ].map((action) => `browser_${action}`),
  )

  const out = await reg.invoke('browser_navigate', JSON.stringify({ url: 'https://example.com' }))
  expect(out).toEqual([{ type: 'text', text: 'ok' }])
  expect(calls).toEqual([
    { agentId: 'agent-1', action: 'navigate', args: { url: 'https://example.com' } },
  ])
})

test('browser_snapshot takes an optional element ref and a page of the latest snapshot', async () => {
  const calls: unknown[] = []
  const tools = browserTools(
    {
      invoke: async (_id, action, args) => {
        calls.push({ action, args })
        return []
      },
    },
    'a',
  )
  const snapshot = tools.find((tool) => tool.def.name === 'browser_snapshot')
  expect(snapshot?.def.parameters).toMatchObject({
    additionalProperties: false,
    required: [],
    properties: { ref: { type: 'string' }, page: { type: 'integer', minimum: 1 } },
  })
  await snapshot?.invoke({ page: 2 })
  expect(calls).toEqual([{ action: 'snapshot', args: { page: 2 } }])
})

test('browser_click maps to the click action', async () => {
  const calls: string[] = []
  const host: BrowserHost = {
    async invoke(_agentId, action) {
      calls.push(action)
      return [{ type: 'text', text: '' }]
    },
  }
  const reg = createToolRegistry(browserTools(host, 'a'))
  await reg.invoke('browser_click', JSON.stringify({ ref: 'e5' }))
  expect(calls).toEqual(['click'])
})

test('mcpProxyTools route to (serverId, rawName) and expose the namespaced name', async () => {
  const calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = []
  const host: McpHost = {
    async invoke(serverId, toolName, args) {
      calls.push({ serverId, toolName, args })
      return [{ type: 'text', text: 'done' }]
    },
  }
  const reg = createToolRegistry(
    mcpProxyTools(host, [
      {
        toolName: 'mcp__gh__search',
        serverId: 'srv-1',
        rawName: 'search',
        description: 'Search GitHub',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ]),
  )
  expect(reg.has('mcp__gh__search')).toBe(true)
  const out = await reg.invoke('mcp__gh__search', JSON.stringify({ q: 'bug' }))
  expect(out).toEqual([{ type: 'text', text: 'done' }])
  expect(calls).toEqual([{ serverId: 'srv-1', toolName: 'search', args: { q: 'bug' } }])
})

test('extractToolResultImages pulls image blocks, text helper keeps text', () => {
  const content: ToolResultPart[] = [
    { type: 'text', text: 'before' },
    { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    { type: 'text', text: 'after' },
  ]
  const result = { content, details: {} }
  expect(extractToolResultText(result)).toBe('beforeafter')
  expect(extractToolResultImages(result)).toEqual([{ data: 'AAAA', mimeType: 'image/png' }])
})

test('extractToolResultImages returns [] when there are no images', () => {
  expect(extractToolResultImages({ content: [{ type: 'text', text: 'x' }], details: {} })).toEqual(
    [],
  )
})

test('piMessagesToProviderView carries tool-result images into the persisted view', () => {
  // biome-ignore lint/suspicious/noExplicitAny: minimal pi AgentMessage shape for the test
  const messages: any[] = [
    {
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'browser_take_screenshot',
      content: [
        { type: 'text', text: 'Screenshot of https://example.com' },
        { type: 'image', data: 'PNGDATA', mimeType: 'image/png' },
      ],
    },
  ]
  const out = piMessagesToProviderView(messages)
  expect(out).toHaveLength(1)
  expect(out[0]?.role).toBe('tool')
  expect(out[0]?.content).toBe('Screenshot of https://example.com')
  expect(out[0]?.images).toEqual([{ data: 'PNGDATA', mimeType: 'image/png' }])
})

test('piMessagesToProviderView carries USER-attached images into the persisted view', () => {
  // biome-ignore lint/suspicious/noExplicitAny: minimal pi AgentMessage shape for the test
  const messages: any[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', data: 'USERIMG', mimeType: 'image/png' },
      ],
    },
  ]
  const out = piMessagesToProviderView(messages)
  expect(out[0]?.role).toBe('user')
  expect(out[0]?.content).toBe('what is this?')
  expect(out[0]?.images).toEqual([{ data: 'USERIMG', mimeType: 'image/png' }])
})

test('piMessagesToProviderView omits images when a tool returns none', () => {
  // biome-ignore lint/suspicious/noExplicitAny: minimal pi AgentMessage shape for the test
  const messages: any[] = [
    {
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'web_fetch',
      content: [{ type: 'text', text: 'hi' }],
    },
  ]
  const out = piMessagesToProviderView(messages)
  expect(out[0]?.images).toBeUndefined()
})

test('browser_tabs addresses tabs by id, not by position', () => {
  const tabs = browserTools({ invoke: async () => [] }, 'a').find(
    (tool) => tool.def.name === 'browser_tabs',
  )
  const props = (tabs?.def.parameters as { properties: Record<string, unknown> }).properties
  expect(props.index).toBeUndefined()
  expect(props.tabId).toBeDefined()
})

describe('the browser guide comes with the browser tools', () => {
  const sessionRoots: string[] = []
  afterEach(() => {
    for (const path of sessionRoots.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  const fakeMemory = (): MemoryBackend => ({
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
  })

  const sessionAgent = (dir: string, teamDir: string): ResolvedAgent =>
    ({
      agent: {
        id: 'agent-1',
        profileId: 'profile-1',
        name: 'Agent One',
        modelOverride: null,
        reasoningLevel: 'medium',
        reviewEnabled: false,
        reviewEveryNTurns: 8,
        reviewModel: null,
        reviewReasoningLevel: 'low',
        reviewTurnsSinceLast: 0,
        status: 'idle',
        dir,
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
        dir: join(dir, '..', 'profile-1'),
        defaultModel: 'openai-codex:gpt-5.6-sol',
        skillsMode: 'selected',
        createdAt: 0,
        updatedAt: 0,
      },
      model: 'openai-codex:gpt-5.6-sol',
      reasoningLevel: 'medium',
      team: {
        id: 'team-1',
        name: 'Team One',
        path: teamDir,
        userMd: '',
        telegramTopicNameFormat: null,
        policyMode: 'open',
        createdAt: 0,
      },
      skills: [],
      privateLessons: [],
    }) as ResolvedAgent

  const stubBrowserHost: BrowserHost = {
    invoke: async () => [{ type: 'text', text: '' }],
  }

  test('a session with a browser host carries the guide; without one it does not', async () => {
    const mk = async (browserHost?: BrowserHost) => {
      const home = mkdtempSync(join(tmpdir(), 'bazilion-guide-session-'))
      sessionRoots.push(home)
      const paths = resolvePaths(home)
      const agentDir = paths.agentDir('agent-1')
      const teamDir = paths.teamDir('team-1')
      mkdirSync(agentDir, { recursive: true })
      mkdirSync(teamDir, { recursive: true })
      return createBazilionSession({
        conversation: seedConversationTarget(join(agentDir, 'sessions'), teamDir),
        agent: sessionAgent(agentDir, teamDir),
        paths,
        env: { BAZILION_BASH_SANDBOX: 'off', BAZILION_BASH_APPROVAL: 'off' },
        memory: fakeMemory(),
        apiKey: 'fixture-token',
        ...(browserHost ? { browserHost } : {}),
      })
    }

    const admitted = await mk(stubBrowserHost)
    try {
      expect(admitted.session.systemPrompt).toContain(browserGuideSection())
    } finally {
      admitted.dispose()
    }

    const denied = await mk()
    try {
      expect(denied.session.systemPrompt).not.toContain(browserGuideSection())
    } finally {
      denied.dispose()
    }
  })
})
