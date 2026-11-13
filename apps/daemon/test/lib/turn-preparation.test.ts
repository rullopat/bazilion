import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, providerStateRepo, spawnAgent } from '../../src/core/index.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let agentId: string
let priorSandbox: string | undefined

beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, {
    id: 'turn-preparation-profile',
    defaultModel: 'lmstudio:test-model',
  })
  agentId = spawnAgent(env.db, env.paths, {
    profileId: 'turn-preparation-profile',
    teamId: env.teamId,
  }).id
  // Admission refuses a provider that is not enabled.
  providerStateRepo.setEnabled(env.db, 'lmstudio', true)
  priorSandbox = process.env.BAZILION_BASH_SANDBOX
  process.env.BAZILION_BASH_SANDBOX = 'off'
  vi.resetModules()
  vi.doMock('../../src/lib/ctx.ts', () => ({
    getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-auth-token' }),
  }))
})

afterEach(() => {
  if (priorSandbox === undefined) delete process.env.BAZILION_BASH_SANDBOX
  else process.env.BAZILION_BASH_SANDBOX = priorSandbox
  vi.doUnmock('../../src/lib/ctx.ts')
  vi.resetModules()
  env.cleanup()
})

test('ask_user is offered only to turns the owner can answer', async () => {
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const http = {
    origin: 'http',
    attemptId: randomUUID(),
    agentId,
    message: 'question route',
    attachments: [],
    bashApprovalMode: 'auto_deny',
  } as const
  const foreground = await prepareAgentTurn({ ...http, questionMode: 'web' })
  expect(foreground.questions).toBe(true)
  releasePreparedAgentTurn(foreground)
  const background = await prepareAgentTurn(http)
  expect(background.questions).toBe(false)
  releasePreparedAgentTurn(background)
  const telegram = await prepareAgentTurn({
    origin: 'telegram',
    attemptId: '-100:77',
    agentId,
    message: 'from my phone',
    attachments: [],
  })
  expect(telegram.questions).toBe(true)
  expect(telegram.bashApprovalMode).toBe('auto_deny')
  releasePreparedAgentTurn(telegram)
})

test('a queued turn runs in the conversation it was sent to and cannot ask the user', async () => {
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const { startConversation } = await import('../../src/lib/conversation-target.ts')
  const target = seedRegisteredConversation(env.db, env.paths, agentId)
  startConversation(env.db, env.paths, agentId)
  const prepared = await prepareAgentTurn({
    origin: 'http',
    attemptId: randomUUID(),
    agentId,
    conversationId: target.id,
    message: 'queued',
    attachments: [],
    bashApprovalMode: 'auto_deny',
  })
  expect(prepared.conversation.id).toBe(target.id)
  expect(prepared.questions).toBe(false)
  releasePreparedAgentTurn(prepared)
})

test('images go to the model; other files are saved and noted in the message', async () => {
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const image = { name: 'image.png', mimeType: 'image/png', data: 'aW1hZ2U=' }
  const prepared = await prepareAgentTurn({
    origin: 'http',
    attemptId: 'turn-preparation-1',
    agentId,
    message: 'exact message',
    attachments: [image, { name: 'notes.txt', mimeType: 'text/plain', data: 'bm90ZXM=' }],
    bashApprovalMode: 'interactive',
  })
  try {
    expect(prepared.images).toEqual([image])
    expect(prepared.message).toMatch(
      /^exact message\n\n\[file saved to .*-notes\.txt \(text\/plain/,
    )
    expect(prepared.bashApprovalMode).toBe('interactive')
  } finally {
    releasePreparedAgentTurn(prepared)
  }
})

test('teammates prepare turns at the same time, each with the workspace instructions', async () => {
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  writeFileSync(join(env.paths.teamDir(env.teamId), 'AGENTS.md'), 'TEAM_RULES')
  const teammate = spawnAgent(env.db, env.paths, {
    profileId: 'turn-preparation-profile',
    teamId: env.teamId,
  }).id
  const prepare = (id: string) =>
    prepareAgentTurn({
      origin: 'http',
      attemptId: `concurrent-${id}`,
      agentId: id,
      message: 'work',
      attachments: [],
      bashApprovalMode: 'auto_deny',
    })
  const first = await prepare(agentId)
  const second = await prepare(teammate)
  try {
    for (const turn of [first, second])
      expect(turn.repositoryInstructions).toEqual([{ path: 'AGENTS.md', content: 'TEAM_RULES' }])
  } finally {
    releasePreparedAgentTurn(first)
    releasePreparedAgentTurn(second)
  }
})

test.each([
  'off',
  'docker',
] as const)('an unattended turn follows BAZILION_BASH_SANDBOX=%s exactly like chat', async (sandbox) => {
  process.env.BAZILION_BASH_SANDBOX = sandbox
  vi.resetModules()
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const prepared = await prepareAgentTurn({
    origin: 'trigger',
    attemptId: `trigger-${sandbox}:1000`,
    agentId,
    message: 'unattended message',
    attachments: [],
    claim: { controller: new AbortController() },
  })
  try {
    // Host execution with the sandbox off; the same Docker settings as chat with it on.
    if (sandbox === 'off') expect(prepared.docker).toBeUndefined()
    else
      expect(prepared.docker).toEqual({
        image: 'debian:bookworm-slim',
        cwd: '.',
        containerPrefix: expect.stringMatching(/^bazilion-[0-9a-f]{12}-[0-9a-f]{12}-$/),
      })
    expect(prepared.bashApprovalMode).toBe('auto_deny')
  } finally {
    releasePreparedAgentTurn(prepared)
  }
})

test('a busy Agent refuses a Telegram turn without registering it', async () => {
  vi.resetModules()
  const { isActiveAgent, ownsActiveAgent, registerAgent, unregisterAgent } = await import(
    '../../src/lib/agent-cancel.ts'
  )
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const request = {
    origin: 'telegram',
    attemptId: '-100:77',
    agentId,
    conversationId: seedRegisteredConversation(env.db, env.paths, agentId).id,
    message: 'retained exact head',
    attachments: [],
  } as const
  const busy = new AbortController()
  registerAgent(agentId, busy)
  try {
    await expect(prepareAgentTurn(request)).rejects.toMatchObject({ code: 'agent_turn_active' })
    expect(ownsActiveAgent(agentId, busy)).toBe(true)
  } finally {
    unregisterAgent(agentId)
  }
  expect(isActiveAgent(agentId)).toBe(false)

  const prepared = await prepareAgentTurn(request)
  expect(isActiveAgent(agentId)).toBe(true)
  releasePreparedAgentTurn(prepared)
})

test.each([
  'trigger',
  'inbox',
] as const)('a %s turn takes over the scheduler registration', async (origin) => {
  vi.resetModules()
  const { isActiveAgent, registerAgent } = await import('../../src/lib/agent-cancel.ts')
  const { prepareAgentTurn, releasePreparedAgentTurn } = await import(
    '../../src/lib/turn-preparation.ts'
  )
  const scheduled = (controller: AbortController) =>
    prepareAgentTurn({
      origin,
      attemptId: `${origin}-1`,
      agentId,
      message: 'scheduled work',
      attachments: [],
      causalParentMessageId: origin === 'inbox' ? 'message-1' : undefined,
      claim: { controller },
    })

  const controller = new AbortController()
  registerAgent(agentId, controller)
  const prepared = await scheduled(controller)
  expect(prepared.controller).toBe(controller)
  expect(prepared.questions).toBe(false)
  expect(prepared.bashApprovalMode).toBe('auto_deny')
  expect(isActiveAgent(agentId)).toBe(true)
  releasePreparedAgentTurn(prepared)
  expect(isActiveAgent(agentId)).toBe(false)

  // A turn that cannot start gives the registration back.
  providerStateRepo.setEnabled(env.db, 'lmstudio', false)
  const refused = new AbortController()
  registerAgent(agentId, refused)
  await expect(scheduled(refused)).rejects.toThrow(/disabled/)
  expect(isActiveAgent(agentId)).toBe(false)
})
