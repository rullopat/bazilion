import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createProfile, resolveAgent, spawnAgent } from '../../src/core/index.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import { createRecallHost } from '../../src/lib/recall-host.ts'
import { recallTool } from '../../src/runtime/tools/recall.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedConversationTarget, seedSessionMessages } from '../fixtures/conversation.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'p', defaultModel: 'lmstudio:test-model' })
})
afterEach(() => env.cleanup())

function conversationOf(agentId: string, title: string, lines: string[]) {
  const agent = resolveAgent(env.db, env.paths, agentId)
  const target = seedConversationTarget(
    join(env.paths.agentDir(agentId), 'sessions'),
    env.paths.home,
  )
  conversations.create(env.db, agentId, target.id, title)
  seedSessionMessages(
    agent,
    env.paths,
    lines.map((text, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', text })),
    target,
  )
  return target.id
}

test('recall everywhere finds a message in another conversation of the Agent, and reads it', async () => {
  const agent = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId }).id
  const other = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId }).id
  const earlier = conversationOf(agent, 'Launch plan', [
    'The launch date is the 3rd of March, write it down.',
    'Noted: launch on 3 March, with the secret-token-123 kept private.',
  ])
  const current = conversationOf(agent, 'Today', ['When is the launch?'])
  const someoneElse = conversationOf(other, 'Not yours', ['launch date is in June'])
  const host = createRecallHost({
    db: env.db,
    paths: env.paths,
    agentId: agent,
    conversationId: current,
    secrets: ['secret-token-123'],
  })
  const found = await host.search('launch date')
  expect(found).toContain(`Conversation "Launch plan" (id ${earlier}`)
  expect(found).toContain('#1 · user')
  expect(found).not.toContain('June')
  expect(found).not.toContain('When is the launch')

  const read = await host.read(earlier, 1)
  expect(read).toContain('Messages 1 to 2 of the 2 messages')
  expect(read).toContain('launch on 3 March')
  expect(read).not.toContain('secret-token-123')
  await expect(host.read(someoneElse, 1)).rejects.toThrow(/no other conversation/)
  await expect(host.read(current, 1)).rejects.toThrow(/that is this conversation/)

  // Through the tool, as the model calls it.
  const tool = recallTool({ branch: () => [], secrets: [], elsewhere: host })
  expect(
    String(await tool.invoke({ query: 'launch date', everywhere: true }, { toolCallId: 'c' })),
  ).toContain('Launch plan')
  expect(
    String(await tool.invoke({ conversation: earlier, from: 2 }, { toolCallId: 'c' })),
  ).toContain('#2 · assistant')
  expect(String(await host.search('nothing like this'))).toMatch(
    /^None of your other conversations/,
  )
})
