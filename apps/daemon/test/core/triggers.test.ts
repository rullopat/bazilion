import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let agentId: string

beforeEach(() => {
  env = makeTestEnv()
  profileRepo.insert(env.db, {
    id: 'p',
    name: 'p',
    dir: env.paths.profileDir('p'),
    defaultModel: 'lmstudio:x',
    skillsMode: 'selected',
  })
  const a = agentRepo.insert(env.db, {
    id: 'a1',
    profileId: 'p',
    name: 'A',
    modelOverride: null,
    reasoningLevel: 'medium',
    status: 'idle',
    dir: env.paths.agentDir('a1'),
    groupId: env.groupId,
  })
  agentId = a.id
})
afterEach(() => env.cleanup())

test('insert + get + listForAgent round-trip for interval trigger', () => {
  const t = triggerRepo.insert(env.db, {
    agentId,
    kind: 'interval',
    intervalSec: 60,
    cronExpr: null,
    message: 'tick',
  })
  expect(t.kind).toBe('interval')
  expect(t.intervalSec).toBe(60)
  expect(t.enabled).toBe(true)
  expect(t.lastFiredAt).toBeNull()

  const fetched = triggerRepo.get(env.db, t.id)
  expect(fetched?.message).toBe('tick')

  const list = triggerRepo.listForAgent(env.db, agentId)
  expect(list).toHaveLength(1)
  expect(list[0]?.id).toBe(t.id)
})

test('cron triggers store cronExpr and null intervalSec', () => {
  const t = triggerRepo.insert(env.db, {
    agentId,
    kind: 'cron',
    intervalSec: null,
    cronExpr: '*/5 * * * *',
    message: 'tick',
  })
  expect(t.cronExpr).toBe('*/5 * * * *')
  expect(t.intervalSec).toBeNull()
})

test('enabled=false disables at insert', () => {
  const t = triggerRepo.insert(env.db, {
    agentId,
    kind: 'interval',
    intervalSec: 30,
    cronExpr: null,
    message: 'tick',
    enabled: false,
  })
  expect(t.enabled).toBe(false)
})

test('setEnabled toggles the enabled flag', () => {
  const t = triggerRepo.insert(env.db, {
    agentId,
    kind: 'interval',
    intervalSec: 30,
    cronExpr: null,
    message: 'tick',
  })
  triggerRepo.setEnabled(env.db, t.id, false)
  expect(triggerRepo.get(env.db, t.id)?.enabled).toBe(false)
  triggerRepo.setEnabled(env.db, t.id, true)
  expect(triggerRepo.get(env.db, t.id)?.enabled).toBe(true)
})

test('markFired populates lastFiredAt', () => {
  const t = triggerRepo.insert(env.db, {
    agentId,
    kind: 'interval',
    intervalSec: 30,
    cronExpr: null,
    message: 'tick',
  })
  const when = Date.now() + 10_000
  triggerRepo.markFired(env.db, t.id, when)
  expect(triggerRepo.get(env.db, t.id)?.lastFiredAt).toBe(when)
})

test('remove deletes the trigger', () => {
  const t = triggerRepo.insert(env.db, {
    agentId,
    kind: 'interval',
    intervalSec: 30,
    cronExpr: null,
    message: 'tick',
  })
  triggerRepo.remove(env.db, t.id)
  expect(triggerRepo.get(env.db, t.id)).toBeNull()
})

test('listEnabled filters out disabled rows', () => {
  triggerRepo.insert(env.db, {
    agentId,
    kind: 'interval',
    intervalSec: 30,
    cronExpr: null,
    message: 'on',
  })
  triggerRepo.insert(env.db, {
    agentId,
    kind: 'interval',
    intervalSec: 60,
    cronExpr: null,
    message: 'off',
    enabled: false,
  })
  const enabled = triggerRepo.listEnabled(env.db)
  expect(enabled).toHaveLength(1)
  expect(enabled[0]?.message).toBe('on')
})

test('listEnabled excludes triggers on archived agents', () => {
  const other = agentRepo.insert(env.db, {
    id: 'a2',
    profileId: 'p',
    name: 'B',
    modelOverride: null,
    reasoningLevel: 'medium',
    status: 'idle',
    dir: env.paths.agentDir('a2'),
    groupId: env.groupId,
  })
  triggerRepo.insert(env.db, {
    agentId,
    kind: 'interval',
    intervalSec: 30,
    cronExpr: null,
    message: 'live',
  })
  triggerRepo.insert(env.db, {
    agentId: other.id,
    kind: 'interval',
    intervalSec: 30,
    cronExpr: null,
    message: 'archived',
  })
  agentRepo.archive(env.db, other.id)
  const enabled = triggerRepo.listEnabled(env.db)
  expect(enabled).toHaveLength(1)
  expect(enabled[0]?.message).toBe('live')
})

describe('ON DELETE CASCADE', () => {
  test('deleting the agent removes its triggers', () => {
    triggerRepo.insert(env.db, {
      agentId,
      kind: 'interval',
      intervalSec: 30,
      cronExpr: null,
      message: 'tick',
    })
    expect(triggerRepo.listForAgent(env.db, agentId)).toHaveLength(1)
    agentRepo.remove(env.db, agentId)
    expect(triggerRepo.listForAgent(env.db, agentId)).toHaveLength(0)
  })
})
