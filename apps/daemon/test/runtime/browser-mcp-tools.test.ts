import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BROWSER_SNAPSHOT_SCOPES, type ResolvedAgent } from '@bazilion/api-types'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import { createBrowserHost } from '../../src/lib/browser/host.ts'
import type {
  BrowserAdmission,
  BrowserConfig,
  ManagedBrowserEntry,
} from '../../src/lib/browser/pool.ts'
import { resources } from '../../src/lib/resources.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import {
  extractToolResultImages,
  extractToolResultText,
  piMessagesToProviderView,
} from '../../src/runtime/pi/events.ts'
import { createBazilionSession } from '../../src/runtime/pi/session.ts'
import { browserTools } from '../../src/runtime/tools/browser.ts'
import { mcpProxyTools } from '../../src/runtime/tools/mcp.ts'
import { createToolRegistry } from '../../src/runtime/tools/registry.ts'
import type { ToolResultPart } from '../../src/runtime/tools/types.ts'
import type { BrowserHost, McpHost } from '../../src/runtime/worker/ipc-protocol.ts'
import { seedConversationTarget } from '../fixtures/conversation.ts'

test('browserTools proxy every action to the host with the agentId', async () => {
  const calls: Array<{ agentId: string; action: string; args: Record<string, unknown> }> = []
  const host: BrowserHost = {
    async invoke(agentId, action, args) {
      calls.push({ agentId, action, args })
      return [{ type: 'text', text: 'ok' }]
    },
  }
  const reg = createToolRegistry(browserTools(host, 'agent-1'))
  const names = reg.list().map((d) => d.name)
  expect(names).toContain('browser_navigate')
  expect(names).toContain('browser_snapshot')
  expect(names).toContain('browser_take_screenshot')

  const out = await reg.invoke('browser_navigate', JSON.stringify({ url: 'https://example.com' }))
  expect(out).toEqual([{ type: 'text', text: 'ok' }])
  expect(calls).toEqual([
    { agentId: 'agent-1', action: 'navigate', args: { url: 'https://example.com' } },
  ])
})

test('browser_snapshot exposes and forwards only the closed semantic scope contract', async () => {
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
    properties: { scope: { type: 'string', enum: BROWSER_SNAPSHOT_SCOPES } },
  })
  for (const scope of BROWSER_SNAPSHOT_SCOPES) await snapshot?.invoke({ scope })
  expect(calls).toEqual(
    BROWSER_SNAPSHOT_SCOPES.map((scope) => ({ action: 'snapshot', args: { scope } })),
  )
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
  await reg.invoke('browser_click', JSON.stringify({ ref: 'e5', observationId: 'obs-current' }))
  expect(calls).toEqual(['click'])
})

test('browser ref tools expose the observationId required by the daemon', () => {
  const tools = browserTools({ invoke: async () => [] }, 'a')
  const click = tools.find((tool) => tool.def.name === 'browser_click')
  const type = tools.find((tool) => tool.def.name === 'browser_type')
  const fill = tools.find((tool) => tool.def.name === 'browser_fill_form')
  expect(click?.def.parameters).toMatchObject({
    required: ['ref', 'observationId'],
    properties: { observationId: { type: 'string' } },
  })
  expect(type?.def.parameters).toMatchObject({
    required: ['ref', 'text', 'observationId'],
    properties: { observationId: { type: 'string' } },
  })
  expect(fill?.def.parameters).toMatchObject({
    required: ['fields', 'observationId'],
    properties: { observationId: { type: 'string' } },
  })
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

describe('browser tool surface (T09)', () => {
  test('browser_status is a read-only tool mapped to the status action', async () => {
    const calls: Array<{ agentId: string; action: string; args: Record<string, unknown> }> = []
    const host: BrowserHost = {
      async invoke(agentId, action, args) {
        calls.push({ agentId, action, args })
        return [{ type: 'text', text: '{}' }]
      },
    }
    const reg = createToolRegistry(browserTools(host, 'agent-1'))
    expect(reg.list().map((d) => d.name)).toContain('browser_status')
    await reg.invoke('browser_status', '{}')
    expect(calls).toEqual([{ agentId: 'agent-1', action: 'status', args: {} }])
  })

  test('browser_tabs uses stable tab ids, not positional indexes', () => {
    const host: BrowserHost = { invoke: async () => [{ type: 'text', text: '' }] }
    const reg = createToolRegistry(browserTools(host, 'a'))
    const tabs = reg.list().find((d) => d.name === 'browser_tabs')
    expect(tabs).toBeTruthy()
    const props = (tabs!.parameters as { properties: Record<string, unknown> }).properties
    expect(props.index).toBeUndefined()
    expect(props.tabId).toBeDefined()
  })
})

describe('browser IPC identity binding (daemon host, T09)', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    resources().browsers.clear()
  })

  const dispatchStub = () =>
    vi.fn(
      async (
        _agentId: string,
        _action: string,
        _args: Record<string, unknown>,
      ): Promise<ToolResultPart[]> => [{ type: 'text', text: '' }],
    )

  const config = (): BrowserConfig => ({
    executablePath: '/nonexistent/bazilion-fixture-browser',
    allowPrivate: false,
    idleMs: 900_000,
    maxSessions: 2,
  })

  const admission = (agentId: string, signal?: AbortSignal): BrowserAdmission => {
    const root = mkdtempSync(join(tmpdir(), 'bazilion-t09-'))
    roots.push(root)
    return { paths: resolvePaths(root), agentId, teamId: 'team-1', ...(signal ? { signal } : {}) }
  }

  test('a forged agent id is refused before the pool is touched', async () => {
    const dispatch = dispatchStub()
    const host = createBrowserHost(config(), admission('agent-1'), dispatch)
    await expect(
      host.invoke('other-agent', 'navigate', { url: 'https://example.com' }),
    ).rejects.toThrow(/not admitted/)
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('an unknown action is refused before the pool is touched', async () => {
    const dispatch = dispatchStub()
    const host = createBrowserHost(config(), admission('agent-1'), dispatch)
    await expect(host.invoke('agent-1', 'evaluate_javascript', { script: '1+1' })).rejects.toThrow(
      /unknown action/,
    )
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('non-object and oversized args are refused', async () => {
    const dispatch = dispatchStub()
    const host = createBrowserHost(config(), admission('agent-1'), dispatch)
    await expect(
      host.invoke('agent-1', 'navigate', ['not', 'a', 'record'] as never),
    ).rejects.toThrow(/invalid action arguments/)
    await expect(
      host.invoke('agent-1', 'navigate', { blob: 'x'.repeat(80 * 1024) }),
    ).rejects.toThrow(/invalid action arguments/)
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('a cancelled turn refuses browser work', async () => {
    const dispatch = dispatchStub()
    const controller = new AbortController()
    const host = createBrowserHost(config(), admission('agent-1', controller.signal), dispatch)
    controller.abort()
    await expect(host.invoke('agent-1', 'snapshot', {})).rejects.toThrow(/cancelled/)
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('allowed ordinary IPC forwards the canonical agent id', async () => {
    const dispatch = vi.fn(
      async (
        _agentId: string,
        _action: string,
        _args: Record<string, unknown>,
      ): Promise<ToolResultPart[]> => [{ type: 'text', text: 'bounded observation' }],
    )
    const host = createBrowserHost(config(), admission('agent-1'), dispatch)
    const out = await host.invoke('agent-1', 'navigate', { url: 'https://example.com' })
    expect(out).toEqual([{ type: 'text', text: 'bounded observation' }])
    expect(dispatch).toHaveBeenCalledWith('agent-1', 'navigate', { url: 'https://example.com' })
  })

  test('browser_status never dispatches (it must never launch) and reports bounded JSON', async () => {
    const dispatch = dispatchStub()
    const host = createBrowserHost(config(), admission('agent-1'), dispatch)
    const out = await host.invoke('agent-1', 'status', {})
    expect(dispatch).not.toHaveBeenCalled()
    const first = out[0]
    const text = first?.type === 'text' ? first.text : ''
    const status = JSON.parse(text)
    expect(status).toMatchObject({
      agentId: 'agent-1',
      enabled: true,
      availability: 'unavailable',
      state: 'stopped',
      profilePresent: false,
      reasonCode: 'browser_invalid_executable',
    })
    expect(typeof status.remedy).toBe('string')
    // Bounded result, even though status is operator/model-facing.
    expect(text.length).toBeLessThan(2048)
  })

  test('status reflects the filesystem profile slot and a live session state', async () => {
    const adm = admission('agent-1')
    mkdirSync(adm.paths.browserDir('agent-1'), { recursive: true })
    const entry = {
      agentId: 'agent-1',
      state: 'running',
      handle: null,
      posture: 'test',
      lastUsedAt: 0,
      idleMs: 0,
      busy: 0,
      failure: { reasonCode: 'browser_start_failed', detail: 'fixture failure' },
      close: async () => {},
    } as unknown as ManagedBrowserEntry
    resources().browsers.set('agent-1', entry)
    try {
      const host = createBrowserHost(config(), adm, vi.fn())
      const out = await host.invoke('agent-1', 'status', {})
      const first = out[0]
      const status = JSON.parse(first?.type === 'text' ? first.text : '{}')
      expect(status.profilePresent).toBe(true)
      expect(status.state).toBe('running')
      // A live failure classification wins over config facts.
      expect(status.reasonCode).toBe('browser_start_failed')
      expect(status.remedy).toBe(
        'The managed browser could not start. Check browser installation and daemon logs.',
      )
      expect(existsSync(adm.paths.browserDir('agent-1'))).toBe(true)
    } finally {
      resources().browsers.delete('agent-1')
    }
  })

  test('a different agent profile slot is never reported', async () => {
    const adm = admission('agent-1')
    mkdirSync(adm.paths.browserDir('other-agent'), { recursive: true })
    const host = createBrowserHost(config(), adm, vi.fn())
    const out = await host.invoke('agent-1', 'status', {})
    const first = out[0]
    const status = JSON.parse(first?.type === 'text' ? first.text : '{}')
    expect(status.profilePresent).toBe(false)
  })
})

describe('guide and tools align at the session seam (T10)', () => {
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
        createdAt: 0,
      },
      skills: [],
      privateLessons: [],
    }) as ResolvedAgent

  const stubBrowserHost: BrowserHost = {
    invoke: async () => [{ type: 'text', text: '' }],
  }

  test('an ordinary session with a browser host carries the guide; without one it does not', async () => {
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
        enabledProviders: new Set(['openai-codex']),
        apiKey: 'fixture-token',
        ...(browserHost ? { browserHost } : {}),
      })
    }

    const admitted = await mk(stubBrowserHost)
    try {
      expect(admitted.session.systemPrompt).toContain('# Browser research (guide v')
    } finally {
      admitted.dispose()
    }

    const denied = await mk()
    try {
      expect(denied.session.systemPrompt).not.toContain('# Browser research')
    } finally {
      denied.dispose()
    }
  })
})
