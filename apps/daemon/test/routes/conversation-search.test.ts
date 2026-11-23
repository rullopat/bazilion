import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConversationSearchResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import { openSecrets } from '../../src/core/repos/secrets.ts'
import * as webTokens from '../../src/core/repos/webTokens.ts'
import { plainText, snippetOf } from '../../src/lib/conversation-search.ts'
import { startConversation } from '../../src/lib/conversation-target.ts'
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
afterEach(() => env.cleanup())

let parent: string | null = null
function write(
  agent: string,
  conversationId: string,
  role: 'user' | 'assistant',
  text: string,
  at: number,
) {
  const id = randomUUID().slice(0, 8)
  const message =
    role === 'user'
      ? { role, content: [{ type: 'text', text }], timestamp: at }
      : {
          role,
          content: [{ type: 'text', text }],
          provider: 'lmstudio',
          model: 'test',
          usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
          stopReason: 'stop',
          timestamp: at,
        }
  appendFileSync(
    join(env.paths.agentDir(agent), 'sessions', `${conversationId}.jsonl`),
    `${JSON.stringify({ type: 'message', id, parentId: parent, timestamp: new Date(at).toISOString(), message })}\n`,
  )
  parent = id
}

async function search(query: string, extra = ''): Promise<Response> {
  return createApp().request(`/api/conversations/search?q=${encodeURIComponent(query)}${extra}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

test('finds the messages that hold every word, newest first, with where they are', async () => {
  const first = startConversation(env.db, env.paths, agentId, 'Launch plan')
  parent = null
  write(agentId, first.id, 'user', 'Draft the launch email for Paperboat', 1000)
  write(agentId, first.id, 'assistant', 'Here is the launch email: "Paperboat is live"', 2000)
  const second = startConversation(env.db, env.paths, agentId, 'Later')
  parent = null
  write(agentId, second.id, 'user', 'The EMAIL went out; the launch is done', 3000)
  write(agentId, second.id, 'assistant', 'Nothing about it here', 4000)
  const other = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
  const theirs = startConversation(env.db, env.paths, other)
  parent = null
  write(other, theirs.id, 'user', 'a launch without the e-word', 5000)

  const response = await search('Launch email')
  expect(response.status).toBe(200)
  const body = (await response.json()) as ConversationSearchResponse
  expect(body.words).toEqual(['launch', 'email'])
  expect(body.hits.map((hit) => [hit.conversationTitle, hit.role, hit.at, hit.active])).toEqual([
    ['Later', 'user', 3000, true],
    ['Launch plan', 'assistant', 2000, false],
    ['Launch plan', 'user', 1000, false],
  ])
  expect(body.hits[1]?.snippet).toBe('Here is the launch email: "Paperboat is live"')
  // A quote in the words is found too.
  const quoted = (await (await search('"paperboat')).json()) as ConversationSearchResponse
  expect(quoted.hits).toHaveLength(1)

  const limited = (await (await search('launch', '&limit=2')).json()) as ConversationSearchResponse
  expect(limited.hits).toHaveLength(2)
  expect(limited.truncated).toBe(true)
  const one = (await (
    await search('launch', `&agent=${other}`)
  ).json()) as ConversationSearchResponse
  expect(one.hits.map((hit) => hit.agentId)).toEqual([other])

  expect((await search('a')).status).toBe(400)
  expect((await search('launch', '&agent=nobody')).status).toBe(404)
})

test('a stored credential is never found, and an unreadable history is counted', async () => {
  openSecrets(env.db, token).set('ANTHROPIC_API_KEY', 'sk-ant-searchable-secret-123')
  const conversation = startConversation(env.db, env.paths, agentId)
  parent = null
  write(agentId, conversation.id, 'user', 'my key is sk-ant-searchable-secret-123 ok', 1000)
  const hidden = (await (
    await search('sk-ant-searchable-secret-123')
  ).json()) as ConversationSearchResponse
  expect(hidden.hits).toEqual([])
  const around = (await (await search('my key')).json()) as ConversationSearchResponse
  expect(around.hits[0]?.snippet).not.toContain('searchable-secret')

  conversations.create(env.db, agentId, randomUUID())
  const body = (await (await search('anything')).json()) as ConversationSearchResponse
  expect(body.unreadable).toBe(1)
})

test('a snippet is cut around the first word found', () => {
  const text = `${'a '.repeat(100)}needle ${'b '.repeat(100)}`
  const snippet = snippetOf(text, ['needle'])
  expect(snippet.startsWith('…')).toBe(true)
  expect(snippet.endsWith('…')).toBe(true)
  expect(snippet).toContain('needle')
  expect(snippetOf('short needle', ['needle'])).toBe('short needle')
})

test('a snippet reads as the message does, without its Markdown', () => {
  expect(plainText('**Dark mode is in.** See `theme.js` and [the diff](https://x.test).')).toBe(
    'Dark mode is in. See theme.js and the diff.',
  )
  expect(
    plainText('## Tracks\n| Track | Owner |\n| --- | --- |\n| Toggle | Dev |')
      .replace(/\s+/g, ' ')
      .trim(),
  ).toBe('Tracks Track Owner Toggle Dev')
  expect(plainText('- one\n2. two\n> quoted *word* and snake_case_name')).toBe(
    'one\ntwo\nquoted word and snake_case_name',
  )
  expect(snippetOf('**The headline is plain**: *Paperboat 2.0 is here*', ['headline'])).toBe(
    'The headline is plain: Paperboat 2.0 is here',
  )
})

test('a word only in a link address is not found; each match knows its place in its conversation', async () => {
  const conversation = startConversation(env.db, env.paths, agentId)
  parent = null
  write(
    agentId,
    conversation.id,
    'assistant',
    'Read [the guide](https://x.test/deployment-checklist).',
    1000,
  )
  write(agentId, conversation.id, 'user', 'The checklist is long', 2000)
  write(agentId, conversation.id, 'assistant', 'Then follow the checklist step by step', 3000)
  const body = (await (await search('checklist')).json()) as ConversationSearchResponse
  expect(body.hits.map((hit) => [hit.at, hit.nth])).toEqual([
    [3000, 1],
    [2000, 0],
  ])
  expect(body.hits.every((hit) => hit.snippet.toLowerCase().includes('checklist'))).toBe(true)
})
