// /api/groups/* — group registry, per-group USER.md, per-group shared
// memory. Memory is keyed by the group slug because the qmd index lives at
// `<group.path>/memory/` and is shared by every agent in the group.

import { join } from 'node:path'
import type {
  RegisterGroupRequest,
  SetGroupTopicFormatRequest,
  SetGroupUserMdRequest,
} from '@bazilion/api-types'
import { type Context, Hono } from 'hono'
import {
  adoptHarnessTemplate,
  deleteGroup,
  diffHarness,
  groupRepo,
  liveHarnessRepo,
  previewHarnessAdoption,
  registerGroup,
  saveHarnessAsTemplate,
  updateHarnessSource,
} from '../core/index.ts'
import { validateSlug } from '../core/profile/validate.ts'
import { getCtx } from '../lib/ctx.ts'
import { validateTopicNameFormat } from '../lib/telegram/naming.ts'
import { syncGroupTopicNames } from '../lib/telegram/topic-rename.ts'
import { qmdBackend } from '../runtime/index.ts'

// 12 KB cap — enough for a rich USER.md, small enough that it can't silently
// blow out the system prompt.
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

groupsRouter.get('/:id/harness', (c) => {
  const detail = liveHarnessRepo.detail(getCtx().db, c.req.param('id'))
  if (!detail) return c.json({ error: `group not found: ${c.req.param('id')}` }, 404)
  c.header('ETag', `"${detail.harness.revision}"`)
  return c.json(detail)
})

groupsRouter.get('/:id/harness/blocks', (c) => {
  const { db } = getCtx()
  const groupId = c.req.param('id')
  const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 100)
  const cursor = c.req.query('cursor')
  const separator = cursor?.indexOf(':') ?? -1
  const cursorTime = separator > 0 ? Number(cursor?.slice(0, separator)) : Number.MAX_SAFE_INTEGER
  const cursorId = separator > 0 ? (cursor?.slice(separator + 1) ?? '') : '\uffff'
  if (cursor && (!Number.isSafeInteger(cursorTime) || !cursorId))
    return c.json({ error: 'invalid cursor' }, 400)
  const reasonCode = c.req.query('reasonCode')
  const rows = db.raw
    .query<
      Record<string, unknown>,
      [string, string, string, string, string, number, number, string, number]
    >(
      `SELECT id, attempt_kind, attempt_id, operation, source_kind, source_id, target_kind,
            target_id, source_group_id, target_group_id, channel, origin, reason_code, reason,
            policy_refs_json, component_outcomes_json, matched_edge_ids_json,
            required_edge_ids_json, created_at
       FROM harness_block_events
      WHERE (source_group_id = ? OR target_group_id = ?)
        AND (? = '' OR reason_code = ?)
        AND (? = '' OR created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(
      groupId,
      groupId,
      reasonCode ?? '',
      reasonCode ?? '',
      cursor ?? '',
      cursorTime,
      cursorTime,
      cursorId,
      limit + 1,
    )
  const page = rows.slice(0, limit).map((row) => ({
    ...row,
    policyRefs: JSON.parse(String(row.policy_refs_json)),
    componentOutcomes: JSON.parse(String(row.component_outcomes_json)),
    matchedEdgeIds: JSON.parse(String(row.matched_edge_ids_json)),
    requiredEdgeIds: JSON.parse(String(row.required_edge_ids_json)),
    policy_refs_json: undefined,
    component_outcomes_json: undefined,
    matched_edge_ids_json: undefined,
    required_edge_ids_json: undefined,
  }))
  const last = page.at(-1) as { created_at?: number; id?: string } | undefined
  return c.json({
    blocks: page,
    nextCursor: rows.length > limit && last ? `${last.created_at}:${last.id}` : null,
  })
})

groupsRouter.put('/:id/harness/policy', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || !Number.isInteger(body.expectedRevision) || !Array.isArray(body.edges)) {
    return c.json({ error: 'expectedRevision and edges are required' }, 400)
  }
  try {
    const edges = body.edges.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`group_policy_invalid: edge ${index} must be an object`)
      }
      const edge = value as Record<string, unknown>
      return {
        sourceKind: edge.sourceKind as 'user' | 'outside_group' | 'agent',
        sourceId: typeof edge.sourceId === 'string' && edge.sourceId ? edge.sourceId : null,
        targetKind: edge.targetKind as 'user' | 'outside_group' | 'agent',
        targetId: typeof edge.targetId === 'string' && edge.targetId ? edge.targetId : null,
      }
    })
    return c.json(
      liveHarnessRepo.replacePolicy(getCtx().db, c.req.param('id'), {
        expectedRevision: body.expectedRevision as number,
        edges,
      }),
    )
  } catch (error) {
    return groupHarnessError(c, error)
  }
})

groupsRouter.get('/:id/harness/diff', (c) => {
  try {
    return c.json(diffHarness(getCtx().db, c.req.param('id')))
  } catch (error) {
    return groupHarnessError(c, error)
  }
})

groupsRouter.post('/:id/harness/adopt-template', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (
    !body ||
    !Number.isInteger(body.groupExpectedRevision) ||
    typeof body.templateId !== 'string' ||
    !Number.isInteger(body.templateExpectedRevision) ||
    !Array.isArray(body.slotMappings) ||
    !Array.isArray(body.remainingPlacements) ||
    !Array.isArray(body.previewEdges)
  ) {
    return c.json({ error: 'invalid adoption request' }, 400)
  }
  try {
    return c.json(
      adoptHarnessTemplate(getCtx().db, c.req.param('id'), {
        groupExpectedRevision: body.groupExpectedRevision as number,
        templateId: body.templateId,
        templateExpectedRevision: body.templateExpectedRevision as number,
        slotMappings: body.slotMappings as Array<{ slotId: string; agentId: string }>,
        remainingPlacements: body.remainingPlacements as Array<{
          agentId: string
          placement: 'isolated' | 'open' | 'profile_defaults'
        }>,
        previewEdges: body.previewEdges as Array<{
          sourceKind: 'user' | 'outside_group' | 'agent'
          sourceId: string | null
          targetKind: 'user' | 'outside_group' | 'agent'
          targetId: string | null
        }>,
      }),
    )
  } catch (error) {
    return groupHarnessError(c, error)
  }
})

groupsRouter.post('/:id/harness/adopt-template/preview', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (
    !body ||
    !Number.isInteger(body.groupExpectedRevision) ||
    typeof body.templateId !== 'string' ||
    !Number.isInteger(body.templateExpectedRevision) ||
    !Array.isArray(body.slotMappings) ||
    !Array.isArray(body.remainingPlacements)
  ) {
    return c.json({ error: 'invalid adoption preview request' }, 400)
  }
  try {
    return c.json({
      edges: previewHarnessAdoption(getCtx().db, c.req.param('id'), {
        groupExpectedRevision: body.groupExpectedRevision as number,
        templateId: body.templateId,
        templateExpectedRevision: body.templateExpectedRevision as number,
        slotMappings: body.slotMappings as Array<{ slotId: string; agentId: string }>,
        remainingPlacements: body.remainingPlacements as Array<{
          agentId: string
          placement: 'isolated' | 'open' | 'profile_defaults'
        }>,
      }),
    })
  } catch (error) {
    return groupHarnessError(c, error)
  }
})

groupsRouter.post('/:id/harness/save-as-template', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  const expectedRevision = body?.expectedRevision
  const templateId = typeof body?.id === 'string' ? body.id.trim() : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!body || !Number.isInteger(expectedRevision) || !templateId || !name) {
    return c.json({ error: 'expectedRevision, id, and name are required' }, 400)
  }
  try {
    validateSlug(templateId)
    return c.json(
      saveHarnessAsTemplate(getCtx().db, getCtx().paths, c.req.param('id'), {
        expectedRevision: expectedRevision as number,
        id: templateId,
        name,
        ...(Object.hasOwn(body, 'userMd')
          ? { userMd: typeof body.userMd === 'string' ? body.userMd : null }
          : {}),
      }),
      201,
    )
  } catch (error) {
    return groupHarnessError(c, error)
  }
})

groupsRouter.post('/:id/harness/update-source', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (
    !body ||
    !Number.isInteger(body.groupExpectedRevision) ||
    !Number.isInteger(body.templateExpectedRevision) ||
    !Array.isArray(body.includeAgentIds) ||
    body.includeAgentIds.some((id) => typeof id !== 'string')
  ) {
    return c.json({ error: 'invalid source update request' }, 400)
  }
  try {
    return c.json(
      updateHarnessSource(getCtx().db, c.req.param('id'), {
        groupExpectedRevision: body.groupExpectedRevision as number,
        templateExpectedRevision: body.templateExpectedRevision as number,
        includeAgentIds: body.includeAgentIds as string[],
      }),
    )
  } catch (error) {
    return groupHarnessError(c, error)
  }
})

groupsRouter.delete('/:id', (c) => {
  const { db, paths } = getCtx()
  try {
    const rawRevision = c.req.query('expectedHarnessRevision')
    const expectedHarnessRevision = rawRevision ? Number.parseInt(rawRevision, 10) : undefined
    if (
      rawRevision &&
      (!Number.isInteger(expectedHarnessRevision) || (expectedHarnessRevision ?? 0) < 1)
    ) {
      return c.json({ error: 'expectedHarnessRevision must be a positive integer' }, 400)
    }
    deleteGroup(db, paths, c.req.param('id'), expectedHarnessRevision)
    return c.body(null, 204)
  } catch (err) {
    const message = (err as Error).message
    return c.json(
      {
        error: message,
        ...(message.startsWith('placement_required')
          ? { code: 'revision_required' }
          : message.startsWith('group_revision_conflict')
            ? { code: 'group_revision_conflict' }
            : message.startsWith('group_policy_invalid')
              ? { code: 'group_policy_invalid' }
              : {}),
      },
      message.startsWith('placement_required') ||
        message.startsWith('group_policy_invalid') ||
        message.startsWith('group_revision_conflict')
        ? 409
        : 400,
    )
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

groupsRouter.put('/:id/topic-format', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SetGroupTopicFormatRequest | null
  if (!body || (body.format !== null && typeof body.format !== 'string')) {
    return c.json({ error: 'format (string or null) is required' }, 400)
  }
  const { db, paths } = getCtx()
  const id = c.req.param('id')
  if (!groupRepo.get(db, id, paths)) {
    return c.json({ error: `group not found: ${id}` }, 404)
  }
  // Empty / whitespace-only string clears the template.
  const format = body.format && body.format.trim().length > 0 ? body.format : null
  if (format !== null) {
    const err = validateTopicNameFormat(format)
    if (err) return c.json({ error: err }, 400)
  }
  groupRepo.setTelegramTopicNameFormat(db, id, format)
  // Re-render existing topics in the background; no-op when the bot isn't running.
  void syncGroupTopicNames(db, paths, id).catch((e) =>
    console.warn('telegram: topic-name sync after format change failed:', e),
  )
  return c.json(groupRepo.get(db, id, paths))
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

function groupHarnessError(c: Context, error: unknown): Response {
  const message = (error as Error).message
  if (message.startsWith('group_policy_missing')) return c.json({ error: message }, 404)
  if (message.startsWith('group_revision_conflict')) {
    const currentRevision = Number.parseInt(message.match(/current (\d+)/)?.[1] ?? '', 10)
    return c.json({ error: message, code: 'group_revision_conflict', currentRevision }, 409)
  }
  if (message.startsWith('member_not_in_group')) {
    return c.json({ error: message, code: 'member_not_in_group' }, 400)
  }
  if (message.startsWith('template_deleted')) {
    return c.json({ error: message, code: 'template_deleted' }, 410)
  }
  if (message.startsWith('template_revision_conflict')) {
    return c.json({ error: message, code: 'template_revision_conflict' }, 409)
  }
  if (
    message.startsWith('adoption_mapping_invalid') ||
    message.startsWith('adoption_preview_mismatch')
  ) {
    return c.json({ error: message, code: message.split(':')[0] }, 400)
  }
  if (message.startsWith('source_diverged')) {
    return c.json({ error: message, code: 'source_diverged' }, 409)
  }
  return c.json({ error: message, code: 'group_policy_invalid' }, 400)
}
