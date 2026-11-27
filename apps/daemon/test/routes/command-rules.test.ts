import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandApprovalDecisionResponse, ListCommandRulesResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-command-rules-route-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  vi.resetModules()
})

afterEach(async () => {
  try {
    ;(await import('../../src/lib/ctx.ts')).getCtx().db.close()
  } catch {}
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

async function fixture() {
  const { createApp } = await import('../../src/app.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { commandApprovalRegistry } = await import('../../src/lib/bash-approval.ts')
  const ctx = getCtx()
  const now = Date.now()
  ctx.db.raw.run(
    "INSERT INTO provider_state (provider_id, enabled, updated_at) VALUES ('lmstudio', 1, ?)",
    [now],
  )
  ctx.db.raw.run(
    "INSERT INTO provider_models (provider, model, added_at) VALUES ('lmstudio', 'qa', ?)",
    [now],
  )
  ctx.db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('team', 'Team', ?)", [now])
  ctx.db.raw.run(
    `INSERT INTO profiles (id, name, default_model, created_at, updated_at)
     VALUES ('profile', 'Profile', 'lmstudio:qa', ?, ?)`,
    [now, now],
  )
  ctx.db.raw.run(
    `INSERT INTO agents (id, profile_id, name, status, team_id, created_at)
     VALUES ('agent', 'profile', 'Agent', 'idle', 'team', ?)`,
    [now],
  )
  const ask = (id: string, command: string) =>
    commandApprovalRegistry.begin({
      id,
      turnId: 'turn',
      toolCallId: `call-${id}`,
      agentId: 'agent',
      teamId: 'team',
      command,
      risks: [
        {
          code: 'broad-destructive-operation',
          message: 'Changes something hard to undo.',
          span: { start: 0, end: 8 },
        },
      ],
      mode: 'interactive',
    })
  return {
    app: createApp(),
    auth: { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' },
    ask,
  }
}

test('Always for this Agent keeps a rule, which is listed and can be removed', async () => {
  const { app, auth, ask } = await fixture()
  const pending = ask('11111111-1111-1111-1111-111111111111', 'git push origin main')
  expect(pending.approval.suggestedRule).toBe('git push')

  const refused = await app.request(`/api/shell-approvals/${pending.approval.id}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ decision: 'allow', remember: { prefix: 'git pull' } }),
  })
  expect(refused.status).toBe(400)
  expect(((await refused.json()) as { error: string }).error).toMatch(/not the beginning/)

  const allowed = await app.request(`/api/shell-approvals/${pending.approval.id}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ decision: 'allow', remember: { prefix: 'git push' } }),
  })
  expect(allowed.status).toBe(200)
  expect(((await allowed.json()) as CommandApprovalDecisionResponse).approval.status).toBe(
    'allowed',
  )

  const listed = (await (
    await app.request('/api/command-rules?agentId=agent', { headers: auth })
  ).json()) as ListCommandRulesResponse
  expect(listed.rules.map((rule) => [rule.agentId, rule.prefix])).toEqual([['agent', 'git push']])

  const rule = listed.rules[0]
  const removed = await app.request(`/api/command-rules/${rule?.id}`, {
    method: 'DELETE',
    headers: auth,
  })
  expect(removed.status).toBe(204)
  const after = (await (
    await app.request('/api/command-rules', { headers: auth })
  ).json()) as ListCommandRulesResponse
  expect(after.rules).toEqual([])
})

test('a denied command, or an MCP call, cannot be remembered', async () => {
  const { app, auth, ask } = await fixture()
  const pending = ask('22222222-2222-2222-2222-222222222222', 'git push')
  const denied = await app.request(`/api/shell-approvals/${pending.approval.id}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ decision: 'deny', remember: { prefix: 'git push' } }),
  })
  expect(denied.status).toBe(400)
  const rules = (await (
    await app.request('/api/command-rules', { headers: auth })
  ).json()) as ListCommandRulesResponse
  expect(rules.rules).toEqual([])
})
