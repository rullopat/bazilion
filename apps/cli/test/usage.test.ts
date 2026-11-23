import {
  formatCost,
  formatTokens,
  type UsageReport,
  type UsageTotals,
  usageSummary,
} from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { totalsLines, usageHeadline } from '../src/commands/usage.ts'

const totals = (patch: Partial<UsageTotals>): UsageTotals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  cost: 0,
  estimated: false,
  planTokens: 0,
  localTokens: 0,
  ...patch,
})

test('money and tokens read short', () => {
  expect(formatCost(0)).toBe('$0.00')
  expect(formatCost(0.004)).toBe('<$0.01')
  expect(formatCost(12.345)).toBe('$12.35')
  expect(formatCost(1234.5)).toBe('$1,235')
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(12_499)).toBe('12k')
  expect(formatTokens(1_250)).toBe('1.3k')
  expect(formatTokens(3_400_000)).toBe('3.4M')
  expect(usageSummary(totals({ cost: 0.42, totalTokens: 12_000 }))).toBe('$0.42 · 12k tokens')
  expect(usageSummary(totals({ totalTokens: 15_000, planTokens: 15_000 }))).toBe(
    '15k tokens, on a plan',
  )
  expect(usageSummary(totals({ totalTokens: 3_100, localTokens: 3_100 }))).toBe(
    '3.1k tokens, local',
  )
})

test('the CLI says which period it counted and how the tokens were paid for', () => {
  const report = {
    days: 7,
    from: '2026-11-17',
    to: '2026-11-23',
    timeZone: 'Europe/Rome',
  } as UsageReport
  expect(usageHeadline(report)).toBe(
    'Usage over the last 7 days (2026-11-17 to 2026-11-23), Europe/Rome',
  )
  expect(usageHeadline({ ...report, days: null })).toBe('Usage over everything saved, Europe/Rome')
  expect(
    totalsLines(
      totals({ calls: 3, cost: 1.5, estimated: true, totalTokens: 9000, planTokens: 2000 }),
    ),
  ).toEqual([
    'Spent       $1.50 (estimated from catalog prices)',
    'Tokens      9.0k in 3 model calls',
    'On a plan   2.0k tokens',
  ])
})
