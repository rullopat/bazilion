import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-question-route-'))
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

test('a waiting question is listed for its Agent and answered once over HTTP', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { createProfile, registerTeam, spawnAgent } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { questionRegistry } = await import('../../src/lib/questions.ts')
  const ctx = getCtx()
  ctx.db.raw.run(
    "INSERT INTO provider_state (provider_id, enabled, updated_at) VALUES ('lmstudio', 1, 1)",
  )
  ctx.db.raw.run(
    "INSERT INTO provider_models (provider, model, added_at) VALUES ('lmstudio', 'qa', 1)",
  )
  const team = registerTeam(ctx.db, { id: 'g', name: 'team' }, ctx.paths)
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'lmstudio:qa' })
  const agent = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: team.id })
  const other = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: team.id })
  const app = createApp()
  const auth = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }
  const turn = new AbortController()
  const { question, result } = questionRegistry.ask(
    { agentId: agent.id, conversationId: 'conversation-1' },
    { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
    turn.signal,
  )
  try {
    expect((await app.request(`/api/agents/${agent.id}/questions`)).status).toBe(401)
    const listed = await app.request(`/api/agents/${agent.id}/questions`, { headers: auth })
    expect(listed.headers.get('cache-control')).toBe('no-store')
    expect(await listed.json()).toEqual({ questions: [question] })
    // The Agent may be named by an id prefix, as elsewhere.
    expect(
      await (
        await app.request(`/api/agents/${agent.id.slice(0, 8)}/questions`, { headers: auth })
      ).json(),
    ).toEqual({ questions: [question] })
    const missing = await app.request('/api/agents/no-such-agent/questions', { headers: auth })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'agent not found: no-such-agent' })
    const answer = (body: unknown, agentId = agent.id) =>
      app.request(`/api/agents/${agentId}/questions/${question.id}/answer`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(body),
      })
    expect((await answer({ answer: { kind: 'choice', index: 1 } }, other.id)).status).toBe(404)
    const outOfRange = await answer({ answer: { kind: 'choice', index: 4 } })
    expect(outOfRange.status).toBe(400)
    expect(await outOfRange.json()).toEqual({
      error: 'Choice 5 does not exist; this question has 2 choices',
    })
    expect((await answer({ answer: { kind: 'text', text: 'YAML' } })).status).toBe(200)
    expect(await result).toMatchObject({ kind: 'answer', answer: { kind: 'text', text: 'YAML' } })
    expect((await answer({ answer: { kind: 'skip' } })).status).toBe(404)
    expect(
      await (await app.request(`/api/agents/${agent.id}/questions`, { headers: auth })).json(),
    ).toEqual({ questions: [] })
  } finally {
    turn.abort()
  }
})
