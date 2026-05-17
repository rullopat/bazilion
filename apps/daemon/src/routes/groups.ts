// /api/groups/* — group registry, per-group USER.md, per-group shared
// memory. Memory is keyed by the group slug because the qmd index lives at
// `<group.path>/memory/` and is shared by every agent in the group.

import { join } from 'node:path'
import type { RegisterGroupRequest, SetGroupUserMdRequest } from '@bazilion/api-types'
import { Hono } from 'hono'
import { deleteGroup, groupRepo, registerGroup } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import { qmdBackend } from '../runtime/index.ts'

// 12 KB cap matches OpenClaw's bootstrapMaxChars default — enough for a rich
// USER.md, small enough that it can't silently blow out the system prompt.
const USER_MD_MAX_BYTES = 12_000

export const groupsRouter = new Hono()

groupsRouter.get('/', (c) => {
  const { db, paths } = getCtx()
  return c.json(groupRepo.list(db, paths))
})

groupsRouter.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as RegisterGroupRequest | null
  if (!body || typeof body.id !== 'string') {
    return c.json({ error: 'id is required' }, 400)
  }
  const { db, paths } = getCtx()
  try {
    const g = registerGroup(db, { id: body.id, name: body.name, link: body.link }, paths)
    return c.json(g, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

groupsRouter.get('/:id', (c) => {
  const { db, paths } = getCtx()
  const g = groupRepo.get(db, c.req.param('id'), paths)
  if (!g) return c.json({ error: `group not found: ${c.req.param('id')}` }, 404)
  return c.json(g)
})

groupsRouter.delete('/:id', (c) => {
  const { db, paths } = getCtx()
  try {
    deleteGroup(db, paths, c.req.param('id'))
    return c.body(null, 204)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

groupsRouter.put('/:id/user-md', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SetGroupUserMdRequest | null
  if (!body || typeof body.userMd !== 'string') {
    return c.json({ error: 'userMd (string) is required' }, 400)
  }
  if (Buffer.byteLength(body.userMd, 'utf8') > USER_MD_MAX_BYTES) {
    return c.json({ error: `userMd exceeds ${USER_MD_MAX_BYTES}-byte cap` }, 413)
  }
  const { db, paths } = getCtx()
  const g = groupRepo.get(db, c.req.param('id'), paths)
  if (!g) return c.json({ error: `group not found: ${c.req.param('id')}` }, 404)
  groupRepo.setUserMd(db, c.req.param('id'), body.userMd)
  return c.json(groupRepo.get(db, c.req.param('id'), paths))
})

// ─── Memory (per-group, shared across all member agents) ──────────────────

async function openMemory(rawId: string) {
  const { db, paths } = getCtx()
  const group = groupRepo.get(db, rawId, paths)
  if (!group) throw new Error(`group not found: ${rawId}`)
  const mem = qmdBackend(join(group.path, 'memory'))
  await mem.init()
  return { mem, group }
}

groupsRouter.get('/:id/memory', async (c) => {
  try {
    const { mem } = await openMemory(c.req.param('id'))
    return c.json(await mem.list())
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404)
  }
})

groupsRouter.get('/:id/memory/search', async (c) => {
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q is required' }, 400)
  const limit = Number.parseInt(c.req.query('limit') ?? '10', 10)
  try {
    const { mem } = await openMemory(c.req.param('id'))
    return c.json(await mem.search(q, { limit }))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404)
  }
})

// `:key{.+}` matches multi-segment paths so memory keys with slashes (e.g.
// `notes/2026-04-25.md`) survive the routing layer. Without the regex Hono
// would only capture a single segment.
groupsRouter.get('/:id/memory/:key{.+}', async (c) => {
  try {
    const { mem } = await openMemory(c.req.param('id'))
    return c.json(await mem.read(c.req.param('key')))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404)
  }
})

groupsRouter.put('/:id/memory/:key{.+}', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { content?: string } | null
  if (!body || typeof body.content !== 'string')
    return c.json({ error: 'content is required' }, 400)
  try {
    const { mem } = await openMemory(c.req.param('id'))
    return c.json(await mem.write(c.req.param('key'), body.content))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})

groupsRouter.delete('/:id/memory/:key{.+}', async (c) => {
  try {
    const { mem } = await openMemory(c.req.param('id'))
    await mem.remove(c.req.param('key'))
    return c.body(null, 204)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})
