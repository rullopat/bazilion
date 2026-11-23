import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConversationListResponse, UsageReport } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import * as webTokens from '../../src/core/repos/webTokens.ts'
import { startConversation } from '../../src/lib/conversation-target.ts'
import { dayOf, shiftDay, usageOfLine, usageReport } from '../../src/lib/usage.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let token: string
let agentId: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: token }),
}))
beforeEach(() => {
  env = makeTestEnv()
  token = webTokens.create(env.db, 'test', { kind: 'bootstrap' }).token
  providerState.setEnabled(env.db, 'lmstudio', true)
  providerModels.replace(env.db, 'lmstudio', ['test'])
  createProfile(env.db, env.paths, { id: 'worker', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'worker', teamId: env.teamId }).id
})
afterEach(() => env.cleanup())

const DAY = 86_400_000
const NOW = Date.parse('2026-11-23T12:00:00Z')

function reply(at: number, provider: string, model: string, tokens: number, cost: number) {
  return JSON.stringify({
    type: 'message',
    id: `m${at}`,
    parentId: null,
    timestamp: new Date(at).toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Fünf Äpfel — ✓' }],
      provider,
      model,
      usage: {
        input: tokens / 2,
        output: tokens / 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: tokens,
        cost: { input: cost / 2, output: cost / 2, cacheRead: 0, cacheWrite: 0, total: cost },
      },
      stopReason: 'stop',
      timestamp: at,
    },
  })
}

function sessionFile(conversationId: string): string {
  return join(env.paths.agentDir(agentId), 'sessions', `${conversationId}.jsonl`)
}

function report(days: number | null, timeZone = 'UTC'): UsageReport {
  return usageReport(env.db, env.paths, { days, timeZone, now: NOW })
}

test('replies, summaries and cache warm-ups are counted; plans and local servers cost nothing', () => {
  const conversation = startConversation(env.db, env.paths, agentId)
  appendFileSync(
    sessionFile(conversation.id),
    [
      reply(NOW - 2 * DAY, 'anthropic', 'claude-x', 1000, 0.5),
      reply(NOW - DAY, 'openai-codex', 'gpt-6.2-sol', 400, 2),
      reply(NOW - DAY, 'lmstudio', 'qwen', 300, 0),
      JSON.stringify({
        type: 'compaction',
        id: 'c1',
        parentId: null,
        timestamp: new Date(NOW).toISOString(),
        summary: 's',
        firstKeptEntryId: 'x',
        tokensBefore: 1,
        usage: { input: 50, output: 50, totalTokens: 100, cost: { total: 0.25 } },
      }),
      JSON.stringify({
        type: 'usage',
        id: 'u1',
        parentId: null,
        timestamp: new Date(NOW).toISOString(),
        kind: 'cache_warm',
        provider: 'openrouter',
        model: 'm',
        usage: { input: 10, totalTokens: 10, cost: { total: 0.01, totalFromProvider: true } },
      }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'hi' } }),
      '',
    ].join('\n'),
  )
  const all = report(null)
  expect(all.totals).toMatchObject({
    calls: 5,
    totalTokens: 1810,
    planTokens: 400,
    // The summary is made with the conversation's latest model (lmstudio here).
    localTokens: 400,
    estimated: true,
  })
  // Only Anthropic and OpenRouter cost money; the summary on lmstudio does not.
  expect(all.totals.cost).toBeCloseTo(0.51)
  expect(all.byModel.map((model) => [model.providerName, model.billing])).toEqual([
    ['Anthropic', 'paid'],
    ['OpenRouter', 'paid'],
    ['ChatGPT', 'plan'],
    ['LM Studio', 'local'],
  ])
  expect(all.byAgent).toHaveLength(1)
  expect(all.byTeam[0]?.teamId).toBe(env.teamId)

  // Two days: yesterday and today, every day listed even without use.
  const two = report(2)
  expect(two.from).toBe('2026-11-22')
  expect(two.byDay.map((day) => [day.day, day.calls])).toEqual([
    ['2026-11-22', 2],
    ['2026-11-23', 2],
  ])
  expect(two.totals.cost).toBeCloseTo(0.01)
})

test('a transcript is read from where the last read stopped; a line being written waits', () => {
  const conversation = startConversation(env.db, env.paths, agentId)
  const file = sessionFile(conversation.id)
  const first = reply(NOW, 'anthropic', 'claude-x', 100, 1)
  // Half of a line, cut inside a multi-byte character.
  const second = reply(NOW, 'anthropic', 'claude-x', 200, 2)
  const bytes = Buffer.from(`${first}\n${second}\n`)
  const cut = bytes.indexOf(Buffer.from('Ä', 'utf8'), Buffer.byteLength(first) + 1) + 1
  appendFileSync(file, bytes.subarray(0, cut))
  expect(report(null).totals.calls).toBe(1)
  appendFileSync(file, bytes.subarray(cut))
  expect(report(null).totals).toMatchObject({ calls: 2, totalTokens: 300, cost: 3 })

  // A replaced file is read again from the start.
  const replacement = `${file}.new`
  writeFileSync(replacement, `${reply(NOW, 'anthropic', 'claude-x', 50, 0.5)}\n`)
  renameSync(replacement, file)
  expect(report(null).totals).toMatchObject({ calls: 1, totalTokens: 50, cost: 0.5 })
})

test('days follow the time zone asked for', () => {
  const late = Date.parse('2026-11-22T23:30:00Z')
  expect(dayOf(late, 'UTC')).toBe('2026-11-22')
  expect(dayOf(late, 'Europe/Rome')).toBe('2026-11-23')
  expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  expect(usageOfLine('not json', { lastModel: null })).toBeNull()
})

test('GET /api/usage and the conversation list carry the totals', async () => {
  const conversation = startConversation(env.db, env.paths, agentId)
  appendFileSync(
    sessionFile(conversation.id),
    `${reply(Date.now(), 'anthropic', 'claude-x', 100, 0.25)}\n`,
  )
  const headers = { authorization: `Bearer ${token}` }
  const app = createApp()
  expect((await app.request('/api/usage')).status).toBe(401)
  expect((await app.request('/api/usage?days=0', { headers })).status).toBe(400)
  expect((await app.request('/api/usage?tz=Mars/Base', { headers })).status).toBe(400)
  expect((await app.request('/api/usage?agent=nope', { headers })).status).toBe(404)
  const response = await app.request('/api/usage?days=7&tz=Europe/Rome', { headers })
  expect(response.status).toBe(200)
  const body = (await response.json()) as UsageReport
  expect(body.byDay).toHaveLength(7)
  expect(body.timeZone).toBe('Europe/Rome')
  expect(body.totals.cost).toBeCloseTo(0.25)

  const list = (await (
    await app.request(`/api/agents/${agentId}/conversations`, { headers })
  ).json()) as ConversationListResponse
  expect(list.usage[conversation.id]).toMatchObject({ calls: 1, totalTokens: 100, cost: 0.25 })

  // A transcript that cannot be read is counted as such, not as zero use.
  const directory = join(env.paths.agentDir(agentId), 'sessions')
  mkdirSync(join(directory, '00000000-0000-4000-8000-000000000000.jsonl'))
  const again = (await (await app.request('/api/usage', { headers })).json()) as UsageReport
  expect(again.unreadable).toBe(1)
})
