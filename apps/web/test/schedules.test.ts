// Schedules in words, and the presets that make them.
import { expect, test } from 'vitest'
import {
  describeCron,
  describeInterval,
  describeSchedule,
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
