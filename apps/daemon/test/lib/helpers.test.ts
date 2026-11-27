import type { ChatFrame } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

interface Prepared {
  request: { helper: { controller: AbortController }; message: string; conversationId: string }
}

let env: TestEnv
let helpers: typeof import('../../src/lib/helpers.ts')
let wakes: typeof import('../../src/lib/wakes.ts')
/** Each helper's turn ends when the test answers it. */
let answer: Map<string, (text: string) => void>
let prepared: Prepared[]

beforeEach(async () => {
  env = makeTestEnv()
  profileRepo.insert(env.db, {
    id: 'p',
    name: 'p',
    defaultModel: 'lmstudio:x',
    skillsMode: 'selected',
  })
  agentRepo.insert(env.db, {
    id: 'a1',
    profileId: 'p',
    name: 'A',
    modelOverride: null,
    reasoningLevel: 'medium',
    status: 'idle',
    teamId: env.teamId,
  })
  answer = new Map()
  prepared = []
  vi.resetModules()
  vi.doMock('../../src/lib/agent-turn.ts', () => ({
    prepareAgentTurn: async (request: Prepared['request']) => {
      const turn = { request }
      prepared.push(turn)
      return turn
    },
    runAgentTurn: (turn: Prepared) =>
      (async function* (): AsyncGenerator<ChatFrame> {
        yield {
          kind: 'event',
          event: { type: 'tool_call', id: 'c1', name: 'web_fetch', arguments: '{}' },
        }
        const signal = turn.request.helper.controller.signal
        const text = await new Promise<string | null>((resolve) => {
          answer.set(turn.request.conversationId, resolve)
          signal.addEventListener('abort', () => resolve(null), { once: true })
        })
        if (text === null) return
        yield { kind: 'done', messages: [{ role: 'assistant', content: text }] }
      })(),
  }))
  helpers = await import('../../src/lib/helpers.ts')
  wakes = await import('../../src/lib/wakes.ts')
  helpers._resetHelpersForTest()
  wakes._resetWakesForTest()
})

afterEach(() => {
  helpers._resetHelpersForTest()
  wakes._resetWakesForTest()
  env.cleanup()
  vi.doUnmock('../../src/lib/agent-turn.ts')
  vi.resetModules()
})

function start(parent: AbortController, turnId = 'turn-1') {
  const selected = seedRegisteredConversation(env.db, env.paths, 'a1').id
  return helpers
    .startHelper({
      db: env.db,
      paths: env.paths,
      agentId: 'a1',
      parentConversationId: selected,
      parentTurnId: turnId,
      parentSignal: parent.signal,
      task: 'Read the second source',
    })
    .then((helper) => ({ helper, selected }))
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('a helper works in a conversation of its own and its answer goes to the waiting turn', async () => {
  helpers.turnOpened('turn-1')
  const parent = new AbortController()
  const { helper, selected } = await start(parent)
  expect(helper).toMatchObject({ status: 'running', task: 'Read the second source' })
  expect(helper.conversationId).not.toBe(selected)
  expect(conversations.selectedId(env.db, 'a1')).toBe(selected)
  expect(prepared[0]?.request.message).toMatch(/You are a helper[\s\S]*Read the second source$/)
  expect(helpers.runningHelperCount('a1')).toBe(1)
  await settle()
  expect(helpers.listHelpers('a1')[0]?.activity).toBe('using web_fetch')

  const waited = helpers.waitForHelpers('a1', [helper.id], 60_000)
  answer.get(helper.conversationId)?.('It agrees.')
  expect(await waited).toMatchObject([{ status: 'done', answer: 'It agrees.' }])
  // The waiting turn had it: its end wakes nobody.
  helpers.turnClosed('turn-1')
  expect(wakes.takeWakes('a1')).toEqual([])
})

test('an answer after the turn ended wakes the Agent; stopping the turn stops its helpers', async () => {
  helpers.turnOpened('turn-1')
  const first = await start(new AbortController())
  helpers.turnClosed('turn-1')
  answer.get(first.helper.conversationId)?.('Found it.')
  await settle()
  await settle()
  const [wake] = wakes.takeWakes('a1')
  expect(wake).toMatchObject({
    id: `helper:${first.helper.id}`,
    conversationId: first.selected,
    summary: 'Your helper finished: Read the second source',
  })
  expect(wake?.text).toContain('Found it.')

  helpers.turnOpened('turn-2')
  const parent = new AbortController()
  const second = await start(parent, 'turn-2')
  parent.abort()
  await settle()
  await settle()
  expect(helpers.listHelpers('a1').find((h) => h.id === second.helper.id)).toMatchObject({
    status: 'stopped',
    stoppedBy: 'turn',
  })
  helpers.turnClosed('turn-2')
  expect(wakes.takeWakes('a1')).toEqual([])

  helpers.turnOpened('turn-3')
  const third = await start(new AbortController(), 'turn-3')
  expect(await helpers.stopHelper('a1', third.helper.id, 'owner')).toMatchObject({
    status: 'stopped',
    stoppedBy: 'owner',
  })
  await expect(helpers.stopHelper('a2', third.helper.id, 'owner')).rejects.toThrow(/no helper/)
  await expect(
    helpers.startHelper({
      db: env.db,
      paths: env.paths,
      agentId: 'a1',
      parentConversationId: third.selected,
      parentTurnId: 'turn-3',
      parentSignal: new AbortController().signal,
      task: '  ',
    }),
  ).rejects.toThrow(/what the helper is to do/)
})
