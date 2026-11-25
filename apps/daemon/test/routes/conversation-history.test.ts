// A conversation after a compaction, as people read it: every message stays, the compaction marks
// where its summary starts, and editing the last message counts the same messages the page shows.

import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ChatContextResponse,
  Conversation,
  SessionMessagesResponse,
} from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import * as webTokens from '../../src/core/repos/webTokens.ts'
import { unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { turnContextWindow } from '../../src/runtime/providers/pi-runtime.ts'
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
  providerState.setEnabled(env.db, 'lmstudio', true)
  providerModels.replace(env.db, 'lmstudio', ['test'])
  createProfile(env.db, env.paths, { id: 'test', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
})
afterEach(() => {
  unregisterAgent(agentId)
  env.cleanup()
})

function request(path: string, method = 'GET', body?: unknown) {
  return createApp().request(`/api/agents/${agentId}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const AT = Date.parse('2026-11-20T10:00:00Z')
const usage = (input: number) => ({
  input,
  output: 100,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
})

/** A conversation of three exchanges, compacted before the third, then a fourth exchange. */
async function compactedConversation(): Promise<Conversation> {
  const response = await request('/conversations', 'POST', {})
  const conversation = (await response.json()) as Conversation
  let parent: string | null = null
  let n = 0
  const lines: string[] = []
  const entry = (fields: Record<string, unknown>) => {
    const id = `e${++n}`
    lines.push(
      JSON.stringify({
        id,
        parentId: parent,
        timestamp: new Date(AT + n * 1000).toISOString(),
        ...fields,
      }),
    )
    parent = id
    return id
  }
  const exchange = (question: string, answer: string, input: number) => {
    const first = entry({
      type: 'message',
      message: { role: 'user', content: question, timestamp: AT },
    })
    entry({
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: answer }],
        provider: 'lmstudio',
        model: 'test',
        usage: usage(input),
        stopReason: 'stop',
        timestamp: AT,
      },
    })
    return first
  }
  exchange('What is the launch date?', 'The launch is on Monday.', 1_000)
  exchange('Who writes the post?', 'Quill writes it.', 2_000)
  const kept = exchange('And the headline?', 'Paperboat 2.0 is here.', 3_000)
  entry({
    type: 'compaction',
    summary: 'The launch is on Monday; Quill writes the post.',
    firstKeptEntryId: kept,
    tokensBefore: 3_100,
  })
  exchange('Make it warmer.', 'Meet the new Paperboat.', 1_200)
  appendFileSync(
    join(env.paths.agentDir(agentId), 'sessions', `${conversation.id}.jsonl`),
    `${lines.join('\n')}\n`,
  )
  return conversation
}

test('a compacted conversation keeps every message and marks where its summary starts', async () => {
  const conversation = await compactedConversation()
  const body = (await (await request('/sessions/messages')).json()) as SessionMessagesResponse
  expect(body.messages.map((message) => message.content)).toEqual([
    'What is the launch date?',
    'The launch is on Monday.',
    'Who writes the post?',
    'Quill writes it.',
    'And the headline?',
    'Paperboat 2.0 is here.',
    'Make it warmer.',
    'Meet the new Paperboat.',
  ])
  expect(body.compactions).toEqual([
    {
      index: 4,
      summary: 'The launch is on Monday; Quill writes the post.',
      tokensBefore: 3_100,
      at: AT + 7_000,
    },
  ])
  // The model's own report for its last reply; a local model's window is the one Pi is told.
  expect(body.context).toEqual({ tokens: 1_300, window: 32_768 })

  const earlier = (await (await request(`/conversations/${conversation.id}`)).json()) as {
    messages: unknown[]
    compactions: SessionMessagesResponse['compactions']
  }
  expect(earlier.messages).toHaveLength(8)
  expect(earlier.compactions.map((mark) => mark.index)).toEqual([4])

  const context = (await (await request('/chat/context')).json()) as ChatContextResponse
  expect(context.window).toEqual({ tokens: 1_300, window: 32_768 })
})

test('editing the message after a compaction keeps the compaction', async () => {
  await compactedConversation()
  // Edit the last message: the conversation goes back to just after the compaction, which stays;
  // before the first reply after it, the conversation's size is not known.
  const truncated = await request('/chat/truncate', 'POST', { keepCount: 6 })
  expect(await truncated.json()).toEqual({ before: 8, after: 6 })
  const body = (await (await request('/sessions/messages')).json()) as SessionMessagesResponse
  expect(body.messages).toHaveLength(6)
  expect(body.compactions.map((mark) => mark.index)).toEqual([4])
  expect(body.context.tokens).toBeNull()
})

test('editing a message before the compaction takes the compaction away', async () => {
  await compactedConversation()
  // The page counts every message, so position 2 is "Who writes the post?" here as there.
  await request('/chat/truncate', 'POST', { keepCount: 2 })
  const body = (await (await request('/sessions/messages')).json()) as SessionMessagesResponse
  expect(body.messages.map((message) => message.content)).toEqual([
    'What is the launch date?',
    'The launch is on Monday.',
  ])
  expect(body.compactions).toEqual([])
  expect(body.context.tokens).toBe(1_100)
})

test('the window is the one a turn gives Pi: its catalog, or 32,768 for a local model', () => {
  expect(turnContextWindow('openai-codex:gpt-6.2-astra')).toBe(272_000)
  expect(turnContextWindow('lmstudio:test')).toBe(32_768)
  expect(turnContextWindow('not a model')).toBeNull()
})
