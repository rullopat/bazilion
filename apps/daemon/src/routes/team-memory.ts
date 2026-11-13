// /api/teams/:id/memory: the Team's shared memory store, the same one every member Agent's
// memory_* tools use.

import { join } from 'node:path'
import type { Context } from 'hono'
import { sanitizeNativeModuleError } from '../lib/native-module-error.ts'
import { qmdBackend } from '../runtime/index.ts'
import { jsonBody, newRouter, onRouteError, routeTeam } from './http.ts'

export const teamMemoryRouter = newRouter()

// qmd's native SQLite diagnostics can contain absolute checkout paths. qmdBackend already
// sanitizes them; repeat it here so no route error can expose one.
teamMemoryRouter.onError((error, c) => {
  const safe = sanitizeNativeModuleError(error, { subject: 'Bazilion memory' })
  if (!(safe instanceof Error)) return c.json({ error: String(safe) }, 500)
  return onRouteError(safe, c)
})

async function openMemory(c: Context) {
  const mem = qmdBackend(join(routeTeam(c).path, 'memory'))
  await mem.init()
  return mem
}

teamMemoryRouter.get('/:id/memory', async (c) => c.json(await (await openMemory(c)).list()))

teamMemoryRouter.get('/:id/memory/search', async (c) => {
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q is required' }, 400)
  const limit = Number.parseInt(c.req.query('limit') ?? '10', 10)
  return c.json(await (await openMemory(c)).search(q, { limit }))
})

// `:key{.+}` matches multi-segment keys (e.g. `notes/2026-04-25.md`); a plain param would only
// capture one segment.
teamMemoryRouter.get('/:id/memory/:key{.+}', async (c) =>
  c.json(await (await openMemory(c)).read(c.req.param('key'))),
)

teamMemoryRouter.put('/:id/memory/:key{.+}', async (c) => {
  const body = await jsonBody<{ content: string }>(c)
  if (typeof body?.content !== 'string') return c.json({ error: 'content is required' }, 400)
  return c.json(await (await openMemory(c)).write(c.req.param('key'), body.content))
})

teamMemoryRouter.delete('/:id/memory/:key{.+}', async (c) => {
  await (await openMemory(c)).remove(c.req.param('key'))
  return c.body(null, 204)
})
