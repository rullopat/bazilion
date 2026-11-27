import { afterEach, beforeEach, expect, test } from 'vitest'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import { agentTiming, createScheduleHost, parseScheduleTime } from '../../src/lib/schedule-host.ts'
import { scheduleTools } from '../../src/runtime/tools/schedule.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  profileRepo.insert(env.db, {
    id: 'p',
    name: 'p',
    defaultModel: 'lmstudio:x',
    skillsMode: 'selected',
  })
  for (const id of ['a1', 'a2']) {
    agentRepo.insert(env.db, {
      id,
      profileId: 'p',
      name: id,
      modelOverride: null,
      reasoningLevel: 'medium',
      status: 'idle',
      teamId: env.teamId,
    })
  }
})
afterEach(() => env.cleanup())

test('times are read on the daemon clock, and a time the clock skips is refused', () => {
  expect(parseScheduleTime('2026-11-28 09:00')).toBe(new Date(2026, 10, 28, 9, 0).getTime())
  expect(parseScheduleTime('2026-11-28T09:00:30')).toBe(new Date(2026, 10, 28, 9, 0, 30).getTime())
  expect(parseScheduleTime('2026-11-28T09:00:00Z')).toBe(Date.UTC(2026, 10, 28, 9))
  expect(parseScheduleTime('2026-11-28T09:00+02:00')).toBe(Date.UTC(2026, 10, 28, 7))
  expect(() => parseScheduleTime('2026-02-30 09:00')).toThrow(/not a time on this computer/)
  expect(() => parseScheduleTime('Friday at nine')).toThrow(/YYYY-MM-DD HH:MM/)
})

test('exactly one timing; in_minutes counts from now', () => {
  const now = Date.UTC(2026, 10, 27, 12)
  expect(agentTiming({ message: 'm', inMinutes: 120 }, now)).toEqual({
    kind: 'once',
    runAt: now + 120 * 60_000,
  })
  expect(agentTiming({ message: 'm', everyMinutes: 30 }, now)).toEqual({
    kind: 'interval',
    intervalSec: 1800,
  })
  expect(agentTiming({ message: 'm', cron: '0 8 * * 1-5' }, now)).toEqual({
    kind: 'cron',
    cronExpr: '0 8 * * 1-5',
  })
  expect(() => agentTiming({ message: 'm' }, now)).toThrow(/exactly one/)
  expect(() => agentTiming({ message: 'm', inMinutes: 5, cron: '* * * * *' }, now)).toThrow(
    /exactly one/,
  )
  expect(() => agentTiming({ message: 'm', inMinutes: 0 }, now)).toThrow(/more than 0/)
  expect(() => agentTiming({ message: 'm', at: '2020-01-01 09:00' }, now)).toThrow(/past/)
})

test("an Agent adds schedules in its conversation, sees the user's, and removes only its own", async () => {
  const host = createScheduleHost({ db: env.db, agentId: 'a1', conversationId: 'conv-1' })
  const owners = triggerRepo.insert(env.db, {
    agentId: 'a1',
    kind: 'cron',
    cronExpr: '0 9 * * *',
    message: 'morning summary',
  })
  const someoneElse = triggerRepo.insert(env.db, {
    agentId: 'a2',
    kind: 'interval',
    intervalSec: 60,
    message: 'not yours',
    setBy: 'agent',
  })
  const added = await host.add({ message: '  check the deploy  ', inMinutes: 120 })
  expect(added.trigger).toMatchObject({
    agentId: 'a1',
    kind: 'once',
    message: 'check the deploy',
    conversationId: 'conv-1',
    setBy: 'agent',
  })
  expect(added.here).toBe(true)
  expect(added.nextRunAt).toBe(added.trigger.runAt)

  const listed = await host.list()
  expect(listed.map((entry) => entry.trigger.id)).toEqual([owners.id, added.trigger.id])

  await expect(host.remove(owners.id)).rejects.toThrow(/the user set this schedule/)
  await expect(host.remove(someoneElse.id)).rejects.toThrow(/you have no schedule/)
  await host.remove(added.trigger.id)
  expect(triggerRepo.get(env.db, added.trigger.id)).toBeNull()
  expect(triggerRepo.get(env.db, owners.id)).not.toBeNull()
})

test('the tools tell the Agent the time and zone, and who set each schedule', async () => {
  const host = createScheduleHost({ db: env.db, agentId: 'a1', conversationId: 'conv-1' })
  triggerRepo.insert(env.db, { agentId: 'a1', kind: 'cron', cronExpr: '0 9 * * *', message: 'm' })
  const tools = scheduleTools(host, () => new Date(2026, 10, 27, 14, 5))
  const byName = new Map(tools.map((tool) => [tool.def.name, tool]))
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  expect(byName.get('schedule_add')?.def.description).toContain(`it is now 2026-11-27 14:05`)
  expect(byName.get('schedule_add')?.def.description).toContain(`(${zone})`)
  const added = await byName.get('schedule_add')?.invoke({ message: 'later', every_minutes: 30 })
  expect(added).toMatch(
    /^Set schedule .*: every 30 min\. It runs next .* It runs in this conversation\.$/,
  )
  const list = String(await byName.get('schedule_list')?.invoke({}))
  expect(list).toContain('cron "0 9 * * *"  set by the user')
  expect(list).toContain('every 30 min  set by you')
  expect(list).toContain("runs in the user's current conversation with you")
})
