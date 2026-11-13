import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as providerModels from '../../src/core/repos/providerModels.ts'
import * as providerState from '../../src/core/repos/providerState.ts'
import * as results from '../../src/core/repos/results.ts'
import * as webTokens from '../../src/core/repos/webTokens.ts'
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
  createProfile(env.db, env.paths, { id: 'producer', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: env.teamId }).id
})
afterEach(() => env.cleanup())
function publish(toolCallId = 'call') {
  return results.publish(env.db, {
    teamId: env.teamId,
    agentId,
    sessionId: 'session',
    toolCallId,
    name: 'report.html',
    mimeType: 'text/html',
    bytes: Buffer.from('<script>alert(1)</script>'),
  })
}
function request(path: string, method = 'GET') {
  return createApp().request(`/api/results${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  })
}

test('requires authentication and reports unknown results as missing', async () => {
  publish()
  expect((await createApp().request('/api/results')).status).toBe(401)
  expect((await request('/missing')).status).toBe(404)
  expect((await request('/missing/download')).status).toBe(404)
  expect((await request('/missing', 'DELETE')).status).toBe(404)
})

test('lists saved results and downloads active content only as an attachment', async () => {
  const result = publish()
  const listed = await request(`?teamId=${env.teamId}&agentId=${agentId}&limit=1`)
  expect(await listed.json()).toMatchObject({ results: [{ id: result.id }], total: 1 })
  const download = await request(`/${result.id}/download`)
  expect(download.status).toBe(200)
  expect(download.headers.get('content-disposition')).toContain('attachment;')
  expect(download.headers.get('content-type')).toBe('application/octet-stream')
  expect(download.headers.get('cache-control')).toBe('no-store')
  expect(download.headers.get('x-content-type-options')).toBe('nosniff')
  expect(download.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect(await download.text()).toBe('<script>alert(1)</script>')
  expect((await request('?limit=Infinity')).status).toBe(400)
  expect((await request('?offset=-1')).status).toBe(400)
})

test('refuses corrupted bytes; a deleted result is gone', async () => {
  const result = publish()
  env.db.raw.run('UPDATE agent_results SET bytes = ? WHERE id = ?', [
    Buffer.alloc(result.byteLength),
    result.id,
  ])
  expect((await request(`/${result.id}/download`)).status).toBe(409)
  expect((await request(`/${result.id}`, 'DELETE')).status).toBe(200)
  expect((await request(`/${result.id}/download`)).status).toBe(404)
  expect((await request(`/${result.id}`)).status).toBe(404)
  expect(await (await request('')).json()).toMatchObject({ results: [], total: 0 })
})

test('previews allow bounded plain text and verified raster signatures, never active content', async () => {
  const publishFile = (name: string, mimeType: string, bytes: Buffer, toolCallId: string) => {
    const result = results.publish(env.db, {
      teamId: env.teamId,
      agentId,
      sessionId: 'session',
      toolCallId,
      name,
      mimeType,
      bytes,
    })
    return result.id
  }
  const text = publishFile(
    'report.md',
    'text/markdown',
    Buffer.from('<script>fetch("https://outside.invalid")</script>'),
    'text',
  )
  const preview = await request(`/${text}/preview`)
  expect(preview.status).toBe(200)
  expect(preview.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  expect(preview.headers.get('content-security-policy')).toContain("default-src 'none'")
  const html = publishFile('report.html', 'text/html', Buffer.from('<b>active</b>'), 'html')
  expect((await request(`/${html}/preview`)).status).toBe(415)
  const forged = publishFile(
    'fake.png',
    'image/png',
    Buffer.from('<svg onload="alert(1)"/>'),
    'forged',
  )
  expect((await request(`/${forged}/preview`)).status).toBe(415)
  const big = publishFile('large.txt', 'text/plain', Buffer.alloc(256 * 1024 + 1), 'big')
  expect((await request(`/${big}/preview`)).status).toBe(415)
})
