import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { projectAttention } from '../../src/core/attention.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import { ExchangeStoppedError, listAgentLoopBreaks } from '../../src/lib/agent-loop-guard.ts'
import { sendAgentMessage } from '../../src/lib/communication.ts'
import {
  activeExchanges,
  endExchangeTurn,
  exchangeSoFar,
  noteExchangeTurn,
  stopExchange,
} from '../../src/lib/exchanges.ts'
import { createDbMessagingHost } from '../../src/lib/messaging-host.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv

beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'p', defaultModel: 'lmstudio:test' })
})

afterEach(() => {
  env.cleanup()
})

function agent(name: string) {
  return spawnAgent(env.db, env.paths, { profileId: 'p', name, teamId: env.teamId })
}

/** A message sent in a turn the message `after` woke, as the scheduler's turns send them. */
async function continueFrom(after: string, from: string, to: string, text: string) {
  return (
    await createDbMessagingHost(env.db, { causalParentMessageId: after }).sendMessage({
      from,
      to,
      payload: JSON.stringify({ text }),
      replyTo: null,
    })
  ).messageId
}

test('an exchange has no length limit: forty steps between three Agents are all delivered', async () => {
  const agents = [agent('a'), agent('b'), agent('c')]
  const first = sendAgentMessage(env.db, {
    from: agents[0]?.id ?? '',
    to: agents[1]?.id ?? '',
    payload: JSON.stringify({ text: 'step 0: start the report' }),
    origin: 'test',
  })
  expect(first).toMatchObject({ causalChainId: first.id, causalHop: 0 })
  let previous = first.id
  for (let step = 1; step < 40; step++) {
    const from = agents[step % 3]?.id ?? ''
    const to = agents[(step + 1) % 3]?.id ?? ''
    previous = await continueFrom(previous, from, to, `step ${step}: here is part ${step}`)
  }
  const exchange = messageRepo.listExchange(env.db, first.id)
  expect(exchange).toHaveLength(40)
  expect(exchange.at(-1)?.causalHop).toBe(39)
  expect(listAgentLoopBreaks(env.db, agents[0]?.id ?? '')).toEqual([])
})

test('a message its sender already sent the same Agent in the exchange is refused and recorded', async () => {
  const a = agent('Mira')
  const b = agent('Quill')
  const c = agent('Dev')
  const ask = sendAgentMessage(env.db, {
    from: a.id,
    to: b.id,
    payload: JSON.stringify({ text: 'Please send the file.' }),
    origin: 'test',
  })
  const cannot = await continueFrom(ask.id, b.id, a.id, "I can't find it.")
  // Another Agent may be told the same, and so may anyone in another exchange.
  await continueFrom(cannot, a.id, c.id, 'Please send the file.')
  sendAgentMessage(env.db, {
    from: a.id,
    to: b.id,
    payload: JSON.stringify({ text: 'Please send the file.' }),
    origin: 'test',
  })

  // The same words to the same Agent in this exchange, whatever the case and punctuation.
  const again = continueFrom(cannot, a.id, b.id, 'please send the file!!')
  await expect(again).rejects.toThrow(ExchangeStoppedError)
  await expect(again).rejects.toThrow(
    'Not delivered: you already sent Quill this same message in this exchange, so you are going round in circles. Do not send it again: tell the user in a few lines where the work stands and what is missing.',
  )
  expect(messageRepo.listExchange(env.db, ask.id)).toHaveLength(3)

  const [stop] = listAgentLoopBreaks(env.db, a.id)
  expect(stop).toMatchObject({
    causalChainId: ask.id,
    fromAgentId: a.id,
    toAgentId: b.id,
    step: 2,
    reason: 'repeated_message',
  })
  const raw = env.db.raw
    .query<Record<string, unknown>, []>('SELECT * FROM agent_loop_break_events')
    .all()
  expect(JSON.stringify(raw)).not.toContain('send the file')

  const item = projectAttention(env.db, { state: 'open', limit: 100 }).items.find(
    (i) => i.kind === 'agent_loop_break',
  )
  expect(item).toMatchObject({
    agentId: a.id,
    title: 'Agents went round in circles',
    diagnostic:
      'Mira sent Quill the same message again, so it was not delivered. Mira was told to say where the work stands in its conversation.',
  })
  expect(JSON.stringify(item)).not.toContain('send the file')
})

test('explicit replies inherit causality while unrelated sends open a fresh chain', () => {
  const a = agent('a')
  const b = agent('b')
  const first = sendAgentMessage(env.db, { from: a.id, to: b.id, payload: 'first', origin: 'test' })
  const reply = sendAgentMessage(env.db, {
    from: b.id,
    to: a.id,
    payload: 'reply',
    replyTo: first.id,
    origin: 'test',
  })
  const separate = sendAgentMessage(env.db, {
    from: b.id,
    to: a.id,
    payload: 'new thread',
    origin: 'test',
  })

  expect(reply).toMatchObject({ causalChainId: first.id, causalHop: 1 })
  expect(separate).toMatchObject({ causalChainId: separate.id, causalHop: 0 })
})

test('a stopped exchange wakes no one and delivers nothing more; Attention stays quiet', async () => {
  const a = agent('a')
  const b = agent('b')
  const first = sendAgentMessage(env.db, {
    from: a.id,
    to: b.id,
    payload: JSON.stringify({ text: 'draft the post' }),
    origin: 'test',
  })
  expect(activeExchanges(env.db, env.paths, env.teamId).map((e) => e.id)).toEqual([first.id])

  expect(stopExchange(env.db, first.id)).toEqual({ stopped: true, cancelled: [], unread: 1 })
  expect(messageRepo.get(env.db, first.id)?.readAt).not.toBeNull()
  expect(activeExchanges(env.db, env.paths, env.teamId)).toEqual([])
  await expect(continueFrom(first.id, b.id, a.id, 'here is the draft')).rejects.toThrow(
    'Not delivered: the user stopped this exchange between Agents.',
  )
  expect(stopExchange(env.db, first.id).stopped).toBe(false)
  expect(listAgentLoopBreaks(env.db, a.id).map((stop) => stop.reason)).toEqual(['stopped'])
  expect(
    projectAttention(env.db, { state: 'open', limit: 100 }).items.filter(
      (i) => i.kind === 'agent_loop_break',
    ),
  ).toEqual([])
})

test('an exchange going on lists its Agents, the turn working on it, and what its turns used', async () => {
  const a = agent('Lead')
  const b = agent('Producer')
  const first = sendAgentMessage(env.db, {
    from: a.id,
    to: b.id,
    payload: JSON.stringify({ text: 'make the demo' }),
    origin: 'test',
  })
  // Producer's turn woke on it: its replies count for the exchange, its next chat does not.
  const sessions = join(env.paths.agentDir(b.id), 'sessions')
  mkdirSync(sessions, { recursive: true })
  const at = new Date(first.createdAt + 1_000).toISOString()
  const line = (entry: unknown) => JSON.stringify(entry)
  const reply = (cost: number) =>
    line({
      type: 'message',
      timestamp: at,
      message: {
        role: 'assistant',
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        usage: { input: 100, output: 20, totalTokens: 120, cost: { total: cost } },
      },
    })
  writeFileSync(
    join(sessions, '11111111-1111-4111-8111-111111111111.jsonl'),
    [
      line({
        type: 'message',
        timestamp: at,
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[[bazilion:inbox-wake]]\n--- from Lead (${a.id}) (message ${first.id}) ---\nmake the demo`,
            },
          ],
        },
      }),
      reply(0.25),
      reply(0.5),
      line({
        type: 'message',
        timestamp: at,
        message: { role: 'user', content: [{ type: 'text', text: 'something else' }] },
      }),
      reply(4),
      '',
    ].join('\n'),
  )
  messageRepo.markRead(env.db, first.id)
  expect(activeExchanges(env.db, env.paths, env.teamId)).toEqual([])

  noteExchangeTurn(b.id, first.id)
  try {
    expect(activeExchanges(env.db, env.paths, env.teamId)).toEqual([
      {
        id: first.id,
        agentIds: [a.id, b.id],
        messages: 1,
        startedAt: first.createdAt,
        lastAt: first.createdAt,
        runningAgentIds: [b.id],
        used: expect.objectContaining({ calls: 2, totalTokens: 240, cost: 0.75 }),
      },
    ])
    // Another Team does not see it.
    expect(activeExchanges(env.db, env.paths, 'another-team')).toEqual([])
  } finally {
    endExchangeTurn(b.id)
  }
})

test('a woken Agent reads the exchange so far, how it began and its latest messages', async () => {
  const a = agent('Sales Director')
  const b = agent('Lead Researcher')
  const first = sendAgentMessage(env.db, {
    from: a.id,
    to: b.id,
    payload: JSON.stringify({ text: 'Find ten leads in Berlin.' }),
    origin: 'test',
  })
  expect(exchangeSoFar(env.db, [first], first.id)).toBeNull()

  let previous = first.id
  for (let step = 1; step <= 12; step++) {
    const [from, to] = step % 2 === 1 ? [b.id, a.id] : [a.id, b.id]
    previous = await continueFrom(previous, from, to, `Round ${step}. ${'detail '.repeat(40)}`)
  }
  const woke = messageRepo.get(env.db, previous)
  if (!woke) throw new Error('missing message')
  const text = exchangeSoFar(env.db, [woke], woke.id) ?? ''
  expect(text).toContain(
    "These messages continue an exchange between Agents that began with Sales Director's message to Lead Researcher. Before them:",
  )
  expect(text).toContain('- Sales Director → Lead Researcher: Find ten leads in Berlin.')
  // The first message, then the latest eight before the one that woke it.
  expect(text).toContain('- (3 more messages)')
  expect(text).toContain('- Lead Researcher → Sales Director: Round 11.')
  expect(text).not.toContain('Round 12.')
  expect(text).not.toContain('Round 3.')
  // Each message shows its first 160 characters.
  expect(
    text
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .every((line) => line.length < 220),
  ).toBe(true)
  expect(text).toContain(
    'Keep this exchange going only while it moves that first request forward. If it is going in circles, or you are each waiting on the other, send no more messages about it, not even a reply: tell the user in a few lines where it stands and what is missing.',
  )
})
