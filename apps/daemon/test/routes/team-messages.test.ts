import type { ListTeamMessagesResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { createProfile, registerTeam, spawnAgent } from '../../src/core/index.ts'
import * as messages from '../../src/core/repos/messages.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import * as webTokens from '../../src/core/repos/webTokens.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let token: string
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: token }),
}))
beforeEach(() => {
  env = makeTestEnv()
  token = webTokens.create(env.db, 'test', { kind: 'bootstrap' }).token
  // The first-run gate opens once a provider has a model.
  providerState.setEnabled(env.db, 'lmstudio', true)
  providerModels.replace(env.db, 'lmstudio', ['test'])
  createProfile(env.db, env.paths, { id: 'member', defaultModel: 'lmstudio:test' })
})
afterEach(() => env.cleanup())

function thread(team: string, query = ''): Promise<Response> {
  return Promise.resolve(
    createApp().request(`/api/teams/${team}/messages${query}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  )
}

test("a Team's thread holds what its members sent and received, newest first, read or not", async () => {
  registerTeam(env.db, { id: 'other' }, env.paths)
  const spawn = (teamId: string) =>
    spawnAgent(env.db, env.paths, { profileId: 'member', teamId }).id
  const [a, b] = [spawn(env.teamId), spawn(env.teamId)]
  const [c, d] = [spawn('other'), spawn('other')]
  const send = (from: string, to: string, text: string) =>
    messages.send(env.db, { from, to, payload: JSON.stringify({ text }) })
  const first = send(a, b, 'draft the post')
  env.db.raw.run('UPDATE messages SET created_at = created_at - 3000 WHERE id = ?', [first.id])
  const second = send(b, a, 'done')
  env.db.raw.run('UPDATE messages SET created_at = created_at - 2000 WHERE id = ?', [second.id])
  const crossing = send(c, a, 'from another team')
  env.db.raw.run('UPDATE messages SET created_at = created_at - 1000 WHERE id = ?', [crossing.id])
  send(d, c, 'not this team')
  messages.markRead(env.db, first.id)

  const response = await thread(env.teamId)
  expect(response.status).toBe(200)
  const body = (await response.json()) as ListTeamMessagesResponse
  expect(body.messages.map((message) => message.id)).toEqual([crossing.id, second.id, first.id])
  expect(body.messages[2]?.readAt).not.toBeNull()
  // Listing the thread reads nothing on the Agents' behalf.
  expect(messages.listInbox(env.db, a, { unreadOnly: true })).toHaveLength(2)

  const newest = (await (await thread(env.teamId, '?limit=1')).json()) as ListTeamMessagesResponse
  expect(newest.messages.map((message) => message.id)).toEqual([crossing.id])
  expect((await thread('missing')).status).toBe(404)
  expect((await createApp().request(`/api/teams/${env.teamId}/messages`)).status).toBe(401)
})
