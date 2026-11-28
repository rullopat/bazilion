// Tool search and Code Mode in a turn (BAZ-100): Pi's `tool_search` and `codemode` over
// Bazilion's tools, driven by Pi's faux model through a real turn session.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConversationTarget, ResolvedAgent } from '@bazilion/api-types'
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import { afterEach, expect, test } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import { isToolCallId } from '../../src/core/tool-call-id.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import { piMessagesToProviderView, translatePiEvent } from '../../src/runtime/pi/events.ts'
import { createBazilionSession, describeTurn } from '../../src/runtime/pi/session.ts'
import type { InjectedMcpTool, McpHost } from '../../src/runtime/worker/ipc-protocol.ts'
import { seedConversationTarget } from '../fixtures/conversation.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const memory: MemoryBackend = {
  write: async () => ({ path: 'x', created: true }),
  read: async () => null,
  search: async () => [],
  list: async () => [],
} as unknown as MemoryBackend

function agentIn(agentDir: string, teamDir: string): ResolvedAgent {
  return {
    agent: {
      id: 'agent-1',
      name: 'Agent One',
      role: null,
      profileId: 'profile-1',
      modelOverride: null,
      reasoningOverride: null,
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
      dir: join(agentDir, '..', 'profile-1'),
      defaultModel: 'anthropic:claude-haiku-5-5',
      skillsMode: 'selected',
      createdAt: 0,
      updatedAt: 0,
    },
    model: 'anthropic:claude-haiku-5-5',
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
    contextWindowSetting: null,
  } as unknown as ResolvedAgent
}

const docsTools: InjectedMcpTool[] = ['lookup', 'search'].map((name) => ({
  toolName: `mcp__docs__${name}`,
  serverId: 'server-docs',
  serverName: 'docs',
  rawName: name,
  description: `The docs ${name} tool: ${name} pages of the product documentation`,
  inputSchema: { type: 'object', properties: {} },
}))

const RESULT_ID = '11111111-2222-4333-8444-555555555555'
const SECRET = 'SECRETVALUE-0123456789'

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-tool-reach-'))
  roots.push(home)
  const paths = resolvePaths(home)
  const agentDir = paths.agentDir('agent-1')
  const teamDir = paths.teamDir('team-1')
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(teamDir, { recursive: true })
  writeFileSync(join(teamDir, 'report.md'), '# Report\n')
  const conversation = seedConversationTarget(join(agentDir, 'sessions'), teamDir)
  const mcpCalls: string[] = []
  const mcpHost: McpHost = {
    async invoke(_serverId, rawName, args) {
      mcpCalls.push(rawName)
      if (args.fail) throw new Error(`upstream rejected token ${SECRET}`)
      if (args.leak) return [{ type: 'text', text: `the token is ${SECRET}` }]
      return [{ type: 'text', text: `${rawName} found the page` }]
    },
  }
  const open = (target: ConversationTarget) =>
    createBazilionSession({
      conversation: target,
      agent: agentIn(agentDir, teamDir),
      paths,
      env: { BAZILION_BASH_SANDBOX: 'off', BAZILION_BASH_APPROVAL: 'off', SOME_API_TOKEN: SECRET },
      memory,
      apiKey: 'fixture-token',
      mcpHost,
      mcpTools: docsTools,
      // Never reached: a script cannot ask the operator.
      askUser: async () => {
        throw new Error('ask_user ran from a script')
      },
      // As the daemon's results store does: the call's id must be one it takes.
      fileSink: async (_file, toolCallId) => {
        if (!isToolCallId(toolCallId)) throw new Error('Invalid result tool call')
        return { resultId: RESULT_ID }
      },
    })
  return { paths, agentDir, teamDir, conversation, mcpCalls, open }
}

/** Answer the turn's model requests with these steps, in order. */
function script(
  session: Awaited<ReturnType<ReturnType<typeof setup>['open']>>['session'],
  steps: Parameters<ReturnType<typeof createFauxCore>['setResponses']>[0],
) {
  const faux = createFauxCore({ provider: 'faux', models: [{ id: 'm', contextWindow: 200_000 }] })
  faux.setResponses(steps)
  // Every request goes to the faux model: nothing leaves this machine.
  session.agent.streamFunction = (_model, context, options) =>
    faux.streamSimple(faux.getModel(), context, options)
  return faux
}

test('MCP tools wait to be found; the prompt names their connection', async () => {
  const { open, conversation } = setup()
  const handle = await open(conversation)
  try {
    const active = handle.session.getActiveToolNames()
    expect(active).toContain('codemode')
    expect(active).toContain('tool_search')
    expect(active).toContain('deliver_file')
    expect(active.filter((name) => name.startsWith('mcp__'))).toEqual([])
    const all = handle.session.getAllTools()
    expect(all.find((tool) => tool.name === 'mcp__docs__search')?.exposure).toBe('deferred')
    expect(all.find((tool) => tool.name === 'ask_user')?.exposure).toBe('model-only')
    expect(handle.session.systemPrompt).toContain('# Connections')
    expect(handle.session.systemPrompt).toContain('- docs (`mcp__docs`): 2 tools')
  } finally {
    handle.dispose()
  }
})

test('a search loads a tool for the rest of the conversation; a script calls tools and shows their files', async () => {
  const { open, conversation, mcpCalls } = setup()
  let loaded: string[] = []
  const first = await open(conversation)
  const frames: ReturnType<typeof translatePiEvent> = []
  first.session.subscribe((event) => frames.push(...translatePiEvent(event)))
  script(first.session, [
    fauxAssistantMessage([fauxToolCall('tool_search', { query: 'search docs pages' })], {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage(
      [
        fauxToolCall('codemode', {
          code: [
            'const page = await tools.mcp__docs__lookup({})',
            'await tools.deliver_file({ path: "report.md" })',
            'let asked = "no"',
            'try { await tools.ask_user({ questions: [] }) } catch (error) { asked = "refused" }',
            'return (page.content?.[0]?.text ?? page) + " / ask_user " + asked',
          ].join('\n'),
        }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(fauxText('Done.')),
  ])
  try {
    await first.session.prompt('Find the page and deliver the report')
    loaded = first.session.getActiveToolNames().filter((name) => name.startsWith('mcp__'))
    expect(loaded).toContain('mcp__docs__search')
    expect(mcpCalls).toEqual(['lookup'])

    const view = piMessagesToProviderView(first.session.agent.state.messages)
    const ran = view.find((message) => message.toolName === 'codemode')
    expect(ran?.content).toContain('lookup found the page / ask_user refused')
    // The file a call inside the script saved is shown with the script's step.
    expect(ran?.results).toEqual([{ resultId: RESULT_ID }])
    expect(ran?.calls).toEqual([
      { name: 'mcp__docs__lookup', status: 'ok' },
      { name: 'deliver_file', status: 'ok' },
    ])
    expect(view.every((message) => typeof message.at === 'number')).toBe(true)

    // The script's own calls never show as steps of their own.
    const ids = frames.flatMap((frame) =>
      frame.type === 'tool_result' || frame.type === 'tool_error' ? [frame.name] : [],
    )
    expect(ids).toEqual(['tool_search', 'codemode'])
  } finally {
    first.dispose()
  }

  const next = await open(conversation)
  try {
    // A new turn of the same conversation keeps what the search loaded.
    expect(next.session.getActiveToolNames().filter((name) => name.startsWith('mcp__'))).toEqual(
      loaded,
    )
  } finally {
    next.dispose()
  }
})

test('what a script’s calls return, and the record of them kept with its result, hold no credential', async () => {
  const { open, conversation, agentDir } = setup()
  const handle = await open(conversation)
  script(handle.session, [
    fauxAssistantMessage(
      [
        fauxToolCall('codemode', {
          code: [
            'const leaked = await tools.mcp__docs__lookup({ leak: true })',
            'let failed = ""',
            'try { await tools.mcp__docs__search({ fail: true }) } catch (error) { failed = error.message }',
            'return leaked + " | " + failed',
          ].join('\n'),
        }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(fauxText('Done.')),
  ])
  try {
    await handle.session.prompt('Look it up')
    const ran = piMessagesToProviderView(handle.session.agent.state.messages).find(
      (message) => message.toolName === 'codemode',
    )
    expect(ran?.content).toContain('the token is [REDACTED]')
    expect(ran?.content).toContain('upstream rejected token [REDACTED]')
  } finally {
    handle.dispose()
  }
  const saved = readFileSync(join(agentDir, 'sessions', `${conversation.id}.jsonl`), 'utf8')
  expect(saved).toContain('nestedCalls')
  expect(saved).not.toContain(SECRET)
})

test('the context report counts codemode and tool_search, not the tools waiting to be found', () => {
  const { paths, agentDir, teamDir } = setup()
  const turn = describeTurn({
    agent: agentIn(agentDir, teamDir),
    paths,
    env: { BAZILION_BASH_SANDBOX: 'off', BAZILION_BASH_APPROVAL: 'off' },
    memory,
    mcpHost: { invoke: async () => [] },
    mcpTools: docsTools,
  })
  const names = turn.tools.map((tool) => tool.name)
  expect(names).toContain('codemode')
  expect(names).toContain('tool_search')
  expect(names.filter((name) => name.startsWith('mcp__'))).toEqual([])
})

test('a script’s call resolves as its tool declares, with credentials taken out', async () => {
  const { open, conversation } = setup()
  const handle = await open(conversation)
  script(handle.session, [
    fauxAssistantMessage(
      [
        fauxToolCall('codemode', {
          code: [
            `const run = await tools.bash({ command: "echo the token is ${SECRET}" })`,
            'if (typeof run !== "object") return "text: " + run',
            `return "exit " + run.exit_code + ", " + (run.output.includes("${SECRET}") ? "leaked" : "clean")`,
          ].join('\n'),
        }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(fauxText('Done.')),
  ])
  try {
    await handle.session.prompt('Run it')
    const ran = piMessagesToProviderView(handle.session.agent.state.messages).find(
      (message) => message.toolName === 'codemode',
    )
    expect(ran?.content).toContain('exit 0, clean')
  } finally {
    handle.dispose()
  }
})

test('the file Pi writes the whole of a long output to holds no credential, a command’s or a script’s', async () => {
  const { open, conversation } = setup()
  const handle = await open(conversation)
  script(handle.session, [
    fauxAssistantMessage(
      [
        fauxToolCall('bash', {
          // Long enough to be cut, and the last value arrives in two pieces.
          command: `for i in $(seq 1 3000); do echo "line $i ${SECRET}"; done; printf '${SECRET.slice(0, 8)}'; sleep 0.2; printf '${SECRET.slice(8)}\\n'`,
        }),
      ],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(
      [fauxToolCall('codemode', { code: `text("x".repeat(50000))\nreturn "${SECRET}"` })],
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(fauxText('Done.')),
  ])
  const files: string[] = []
  try {
    await handle.session.prompt('Print them')
    for (const name of ['bash', 'codemode']) {
      const message = handle.session.agent.state.messages.find(
        (entry) => entry.role === 'toolResult' && entry.toolName === name,
      ) as { details?: { fullOutputPath?: string } } | undefined
      const path = message?.details?.fullOutputPath
      expect(path, name).toBeTypeOf('string')
      files.push(path as string)
      const full = readFileSync(path as string, 'utf8')
      expect(full, name).toContain('[REDACTED]')
      expect(full, name).not.toContain(SECRET)
    }
  } finally {
    handle.dispose()
    for (const file of files) rmSync(file, { force: true })
  }
})
