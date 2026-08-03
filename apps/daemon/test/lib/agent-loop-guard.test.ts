import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { AgentLoopLimitError, listAgentLoopBreaks } from '../../src/lib/agent-loop-guard.ts'
import { sendAgentMessage } from '../../src/lib/communication.ts'
import { createDbMessagingHost } from '../../src/lib/messaging-host.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let oldLimit: string | undefined
let oldPolicy: string | undefined

beforeEach(() => {
  env = makeTestEnv()
  oldLimit = process.env.BAZILION_AGENT_LOOP_MAX_HOPS
  oldPolicy = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  process.env.BAZILION_AGENT_LOOP_MAX_HOPS = '1'
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'off'
  createProfile(env.db, env.paths, { id: 'p', defaultModel: 'lmstudio:test' })
})

afterEach(() => {
  if (oldLimit === undefined) delete process.env.BAZILION_AGENT_LOOP_MAX_HOPS
  else process.env.BAZILION_AGENT_LOOP_MAX_HOPS = oldLimit
  if (oldPolicy === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = oldPolicy
  env.cleanup()
})

function agent(name: string) {
  return spawnAgent(env.db, env.paths, {
    profileId: 'p',
    name,
    teamId: env.teamId,
  })
}

test('causal ancestry survives omitted reply_to and stops a three-Agent cycle', async () => {
  const a = agent('a')
  const b = agent('b')
  const c = agent('c')

  const first = sendAgentMessage(env.db, {
    from: a.id,
    to: b.id,
    payload: JSON.stringify({ text: 'start' }),
    origin: 'test',
  })
  expect(first.causalChainId).toBe(first.id)
  expect(first.causalHop).toBe(0)

  const secondId = (
    await createDbMessagingHost(env.db, { causalParentMessageId: first.id }).sendMessage({
      from: b.id,
      to: c.id,
      payload: JSON.stringify({ text: 'continue without reply_to' }),
      replyTo: null,
    })
  ).messageId
  const second = env.db.raw
    .query<{ causal_chain_id: string; causal_hop: number }, [string]>(
      'SELECT causal_chain_id, causal_hop FROM messages WHERE id = ?',
    )
    .get(secondId)
  expect(second).toEqual({ causal_chain_id: first.id, causal_hop: 1 })

  await expect(
    Promise.resolve().then(() =>
      createDbMessagingHost(env.db, { causalParentMessageId: secondId }).sendMessage({
        from: c.id,
        to: a.id,
        payload: JSON.stringify({ text: 'would exceed the limit' }),
        replyTo: null,
      }),
    ),
  ).rejects.toThrow(AgentLoopLimitError)

  expect(env.db.raw.query<{ n: number }, []>('SELECT COUNT(*) n FROM messages').get()?.n).toBe(2)
  const breaks = listAgentLoopBreaks(env.db, a.id)
  expect(breaks).toHaveLength(1)
  expect(breaks[0]).toMatchObject({
    causalChainId: first.id,
    fromAgentId: c.id,
    toAgentId: a.id,
    attemptedHop: 2,
    maxHops: 1,
    reason: 'causal_hop_limit_exceeded',
  })
  const raw = env.db.raw
    .query<Record<string, unknown>, []>('SELECT * FROM agent_loop_break_events')
    .get()
  expect(JSON.stringify(raw)).not.toContain('would exceed the limit')
})

test('explicit replies inherit causality while unrelated sends open a fresh chain', () => {
  const a = agent('a')
  const b = agent('b')
  const first = sendAgentMessage(env.db, {
    from: a.id,
    to: b.id,
    payload: 'first',
    origin: 'test',
  })
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
