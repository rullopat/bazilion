import type { ActivityResponse, AgentActivity } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import * as results from '../../src/core/repos/results.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import * as webTokens from '../../src/core/repos/webTokens.ts'
import { noteTurnEnd, noteTurnFrame, stepTarget } from '../../src/lib/activity.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { startConversation } from '../../src/lib/conversation-target.ts'
import { questionRegistry } from '../../src/lib/questions.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let token: string
let agentId: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: token }),
}))
beforeEach(() => {
  env = makeTestEnv()
  token = webTokens.create(env.db, 'test', { kind: 'bootstrap' }).token
  // The first-run gate opens once a provider has a model.
  providerState.setEnabled(env.db, 'lmstudio', true)
  providerModels.replace(env.db, 'lmstudio', ['test'])
  createProfile(env.db, env.paths, { id: 'worker', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'worker', teamId: env.teamId }).id
})
afterEach(() => {
  noteTurnEnd(agentId)
  unregisterAgent(agentId)
  env.cleanup()
})

async function activity(): Promise<AgentActivity[]> {
  const response = await createApp().request('/api/activity', {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as ActivityResponse).agents
}

test('an idle Agent with nothing produced reads as such; archived Agents are left out', async () => {
  expect((await createApp().request('/api/activity')).status).toBe(401)
  const archived = spawnAgent(env.db, env.paths, { profileId: 'worker', teamId: env.teamId }).id
  agentRepo.archive(env.db, archived)
  expect(await activity()).toEqual([
    {
      agentId,
      teamId: env.teamId,
      working: false,
      step: null,
      questions: 0,
      approvals: 0,
      queuePaused: false,
      followUps: 0,
      jobs: 0,
      lastActivityAt: null,
      results: 0,
      lastResultAt: null,
    },
  ])
})

test('a running turn shows its latest tool call, and nothing once it ends', async () => {
  registerAgent(agentId, new AbortController())
  expect(await activity()).toMatchObject([{ working: true, step: null }])
  const call = (name: string, args: object) =>
    noteTurnFrame(agentId, {
      kind: 'event',
      event: { type: 'tool_call', id: 'call', name, arguments: JSON.stringify(args) },
    })
  call('bash', { command: 'ls site' })
  call('write', { path: 'site/theme.js', content: 'const a = 1' })
  // Frames that are not tool calls leave the step alone.
  noteTurnFrame(agentId, { kind: 'event', event: { type: 'assistant_delta', delta: 'done' } })
  expect(await activity()).toMatchObject([
    { working: true, step: { tool: 'write', target: 'site/theme.js' } },
  ])
  noteTurnEnd(agentId)
  unregisterAgent(agentId)
  expect(await activity()).toMatchObject([{ working: false, step: null }])
})

test('questions, a paused queue, results and the last conversation change are counted', async () => {
  const before = Date.now()
  const conversation = startConversation(env.db, env.paths, agentId)
  const { question } = questionRegistry.ask(
    { agentId, conversationId: conversation.id },
    { prompt: 'Staging or production?', choices: [{ label: 'Staging' }, { label: 'Production' }] },
  )
  queue.add(env.db, {
    agentId,
    conversationId: conversation.id,
    message: 'later',
    attachments: [],
  })
  queue.setPaused(env.db, agentId, true)
  results.publish(env.db, {
    teamId: env.teamId,
    agentId,
    sessionId: conversation.id,
    toolCallId: 'call',
    name: 'cover.png',
    mimeType: 'image/png',
    bytes: Buffer.from([137, 80, 78, 71]),
  })
  try {
    const [entry] = await activity()
    expect(entry).toMatchObject({
      questions: 1,
      approvals: 0,
      queuePaused: true,
      followUps: 1,
      results: 1,
    })
    expect(entry?.lastResultAt).toBeGreaterThanOrEqual(before)
    // File times have a coarser clock than Date.now().
    expect(entry?.lastActivityAt).toBeGreaterThanOrEqual(before - 2_000)
  } finally {
    questionRegistry.answer(agentId, question.id, { kind: 'skip' })
  }
  // A paused queue with nothing waiting is not worth a marker.
  for (const item of queue.list(env.db, agentId).items) queue.remove(env.db, agentId, item.id)
  expect(await activity()).toMatchObject([{ questions: 0, queuePaused: false }])
})

test('a step names what its tool works on', () => {
  expect(stepTarget('{"path":"site/index.html","content":"x"}')).toBe('site/index.html')
  expect(stepTarget('{"command":"git status\\ngit diff"}')).toBe('git status')
  expect(stepTarget('{"url":"https://example.com/a"}')).toBe('https://example.com/a')
  expect(stepTarget(JSON.stringify({ command: 'x'.repeat(400) }))).toHaveLength(160)
  expect(stepTarget('{"full_page":true}')).toBeNull()
  expect(stepTarget('not json')).toBeNull()
})
