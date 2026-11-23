import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createProfile, messageRepo, spawnAgent } from '../../src/core/index.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { teamDay } from '../../src/lib/team-day.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'p', defaultModel: 'lmstudio:test' })
})
afterEach(() => env.cleanup())

test('a Team’s day: hand-offs, replies and conversations worked in since a moment, newest first', () => {
  const sally = spawnAgent(env.db, env.paths, { profileId: 'p', name: 'Sally', teamId: env.teamId })
  const reachy = spawnAgent(env.db, env.paths, {
    profileId: 'p',
    name: 'Reachy',
    teamId: env.teamId,
  })
  registerTeam(env.db, { id: 'other', name: 'Other' }, env.paths)
  const stranger = spawnAgent(env.db, env.paths, {
    profileId: 'p',
    name: 'Stranger',
    teamId: 'other',
  })

  const since = Date.now() - 1_000
  const brief = messageRepo.send(env.db, {
    from: sally.id,
    to: reachy.id,
    payload: JSON.stringify({ text: 'Find 20 leads in Krakow.' }),
  })
  messageRepo.send(env.db, {
    from: reachy.id,
    to: sally.id,
    payload: JSON.stringify({ text: 'Here are the first 10.' }),
    replyTo: brief.id,
  })
  // Another Team's own talk is not this Team's day.
  messageRepo.send(env.db, { from: stranger.id, to: stranger.id, payload: '{"text":"x"}' })

  const conversation = conversations.create(env.db, reachy.id, 'c1', 'Krakow leads')
  const sessions = join(env.paths.agentDir(reachy.id), 'sessions')
  mkdirSync(sessions, { recursive: true })
  writeFileSync(join(sessions, `${conversation.id}.jsonl`), '{}\n')
  // A conversation last written yesterday is not today's.
  const old = conversations.create(env.db, sally.id, 'c2', 'Yesterday')
  const oldFile = join(env.paths.agentDir(sally.id), 'sessions', `${old.id}.jsonl`)
  writeFileSync(oldFile, '{}\n')
  utimesSync(oldFile, new Date(since - 86_400_000), new Date(since - 86_400_000))

  const day = teamDay(env.db, env.paths, env.teamId, since)
  expect(day.events.map((event) => [event.kind, event.agentName, event.text])).toEqual(
    expect.arrayContaining([
      ['handoff', 'Sally', 'Find 20 leads in Krakow.'],
      ['reply', 'Reachy', 'Here are the first 10.'],
      ['worked', 'Reachy', 'Krakow leads'],
    ]),
  )
  expect(day.events).toHaveLength(3)
  expect(day.events.find((event) => event.kind === 'handoff')?.otherAgentName).toBe('Reachy')
  const times = day.events.map((event) => event.at)
  expect([...times].sort((a, b) => b - a)).toEqual(times)
})

test('a day busier than what is read says it is incomplete', () => {
  const sally = spawnAgent(env.db, env.paths, { profileId: 'p', name: 'Sally', teamId: env.teamId })
  const since = Date.now() - 1_000
  for (let i = 0; i < 150; i++)
    messageRepo.send(env.db, { from: sally.id, to: sally.id, payload: `{"text":"${i}"}` })
  expect(teamDay(env.db, env.paths, env.teamId, since).truncated).toBe(false)
  for (let i = 0; i < 400; i++)
    messageRepo.send(env.db, { from: sally.id, to: sally.id, payload: `{"text":"${i}"}` })
  // 550 hand-offs today: more than the answer holds, and it says so.
  expect(teamDay(env.db, env.paths, env.teamId, since).truncated).toBe(true)
})
