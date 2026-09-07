import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { createConversationFile } from '../../src/lib/conversation-file.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
let cwd: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'test', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
  cwd = env.paths.teamDir(env.teamId)
})
afterEach(() => env.cleanup())

test('an empty conversation is durable and opens with its exact canonical identity', () => {
  const id = randomUUID()
  const filename = createConversationFile(env.paths, agentId, id, cwd)
  const path = join(env.paths.agentDir(agentId), 'sessions', filename)
  const session = SessionManager.open(path)
  expect(session.getSessionId()).toBe(id)
  expect(session.buildSessionContext().messages).toEqual([])
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(readdirSync(join(env.paths.agentDir(agentId), 'sessions'))).toEqual([filename])
})

test('a repeated publication retains the original transcript instead of replacing it', () => {
  const id = randomUUID()
  const filename = createConversationFile(env.paths, agentId, id, cwd)
  const path = join(env.paths.agentDir(agentId), 'sessions', filename)
  appendFileSync(path, '\n')
  const original = readFileSync(path)
  expect(createConversationFile(env.paths, agentId, id, cwd)).toBe(filename)
  expect(readFileSync(path)).toEqual(original)
})

test('existing corrupt, foreign and symlink files cannot be adopted or overwritten', () => {
  for (const kind of ['corrupt', 'foreign', 'symlink']) {
    const id = randomUUID()
    const path = join(env.paths.agentDir(agentId), 'sessions', `${id}.jsonl`)
    if (kind === 'symlink') symlinkSync(join(env.home, 'outside'), path)
    else
      writeFileSync(
        path,
        kind === 'corrupt' ? 'broken' : JSON.stringify({ type: 'session', id: randomUUID() }),
      )
    expect(() => createConversationFile(env.paths, agentId, id, cwd)).toThrow()
    if (kind === 'corrupt') expect(readFileSync(path, 'utf8')).toBe('broken')
  }
  expect(
    readdirSync(join(env.paths.agentDir(agentId), 'sessions')).some((name) =>
      name.endsWith('.tmp'),
    ),
  ).toBe(false)
  expect(() => createConversationFile(env.paths, '../escape', randomUUID(), cwd)).toThrow()
  expect(() => createConversationFile(env.paths, agentId, '../escape', cwd)).toThrow()
})
