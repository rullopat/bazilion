// Schedules in words, and the presets that make them.
import { expect, test } from 'vitest'
import {
  describeCron,
  describeInterval,
  describeSchedule,
  draftOf,
  EMPTY_SCHEDULE,
  scheduleRequest,
} from '../src/lib/schedules.ts'

test('common schedules read as words; the rest stay as cron', () => {
  expect(describeInterval(300)).toBe('Every 5 minutes')
  expect(describeInterval(60)).toBe('Every minute')
  expect(describeInterval(7200)).toBe('Every 2 hours')
  expect(describeInterval(90)).toBe('Every 90 seconds')
  expect(describeCron('0 9 * * 1-5')).toBe('Weekdays at 09:00')
  expect(describeCron('30 18 * * *')).toBe('Every day at 18:30')
  expect(describeCron('0 10 * * 1')).toBe('Every Monday at 10:00')
  expect(describeCron('0 10 * * 7')).toBe('Every Sunday at 10:00')
  expect(describeCron('0 * * * *')).toBe('Every hour')
  expect(describeCron('15 * * * *')).toBe('Every hour at :15')
  expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes')
  expect(describeCron('0 9 1 * *')).toBeNull()
  expect(describeCron('*/15 9-17 * * 1-5')).toBeNull()
  expect(describeSchedule({ kind: 'cron', cronExpr: '0 9 1 * *' })).toEqual({
    text: '0 9 1 * *',
    raw: true,
  })
})

test('a preset becomes the request the daemon takes', () => {
  const draft = { ...EMPTY_SCHEDULE, message: '  Morning check  ' }
  expect(scheduleRequest(draft)).toEqual({
    request: { kind: 'cron', cronExpr: '0 9 * * 1-5', message: 'Morning check' },
    problem: null,
    field: null,
  })
  expect(scheduleRequest({ ...draft, repeat: 'weekly', day: '0', time: '18:30' }).request).toEqual({
    kind: 'cron',
    cronExpr: '30 18 * * 0',
    message: 'Morning check',
  })
  expect(scheduleRequest({ ...draft, repeat: 'minutes', minutes: '15' }).request).toEqual({
    kind: 'interval',
    intervalSec: 900,
    message: 'Morning check',
  })
  expect(
    scheduleRequest({ ...draft, repeat: 'cron', cron: ' */5  * * * * ' }).request?.cronExpr,
  ).toBe('*/5 * * * *')
  expect(scheduleRequest({ ...draft, message: ' ' }).problem).toBe(
    'Write the message the Agent gets.',
  )
  expect(scheduleRequest({ ...draft, repeat: 'minutes', minutes: '0' }).problem).toBe(
    'Give a whole number of minutes.',
  )
  expect(scheduleRequest({ ...draft, repeat: 'cron', cron: '0 9 * *' }).problem).toMatch(
    /five fields/,
  )
})

test('a one-time schedule needs a time to come, and an existing schedule opens as its preset', () => {
  const now = new Date(2026, 10, 27, 12, 0).getTime()
  const draft = { ...EMPTY_SCHEDULE, repeat: 'once' as const, message: 'Renew the domain' }
  expect(scheduleRequest({ ...draft, at: '2026-11-28T09:00' }, now).request).toEqual({
    kind: 'once',
    runAt: new Date(2026, 10, 28, 9, 0).getTime(),
    message: 'Renew the domain',
  })
  expect(scheduleRequest({ ...draft, at: '2026-11-27T11:00' }, now).problem).toBe(
    'Give a time that has not passed yet.',
  )
  expect(scheduleRequest({ ...draft, at: '' }, now).field).toBe('at')
  expect(describeSchedule({ kind: 'once', runAt: now })).toEqual({ text: 'Once', raw: false })
  expect(describeSchedule({ kind: 'once', runAt: now }, () => 'Fri 28 Nov, 09:00').text).toBe(
    'Once, Fri 28 Nov, 09:00',
  )

  const trigger = {
    id: 't',
    agentId: 'a',
    intervalSec: null,
    cronExpr: null,
    runAt: null,
    message: 'm',
    enabled: true,
    lastFiredAt: null,
    createdAt: 0,
    conversationId: null,
    setBy: 'owner' as const,
  }
  expect(draftOf({ ...trigger, kind: 'cron', cronExpr: '0 9 * * 1-5' })).toMatchObject({
    repeat: 'weekdays',
    time: '09:00',
    message: 'm',
  })
  expect(draftOf({ ...trigger, kind: 'cron', cronExpr: '30 18 * * 0' })).toMatchObject({
    repeat: 'weekly',
    day: '0',
    time: '18:30',
  })
  expect(draftOf({ ...trigger, kind: 'cron', cronExpr: '*/15 9-17 * * 1-5' })).toMatchObject({
    repeat: 'cron',
    cron: '*/15 9-17 * * 1-5',
  })
  expect(draftOf({ ...trigger, kind: 'interval', intervalSec: 1800 })).toMatchObject({
    repeat: 'minutes',
    minutes: '30',
  })
  expect(
    draftOf({ ...trigger, kind: 'once', runAt: new Date(2026, 10, 28, 9, 5).getTime() }),
  ).toMatchObject({ repeat: 'once', at: '2026-11-28T09:05' })
})
