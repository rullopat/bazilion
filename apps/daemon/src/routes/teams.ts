// /api/teams/* — team registry, per-team USER.md, per-team shared
// memory. Memory is keyed by the team slug because the qmd index lives at
// `<team.path>/memory/` and is shared by every agent in the team.

import { join } from 'node:path'
import type {
  RegisterTeamRequest,
  SetTeamTopicFormatRequest,
  SetTeamUserMdRequest,
} from '@bazilion/api-types'
import { type Context, Hono } from 'hono'
import {
  adoptTeamTemplate,
  deleteTeam,
  diffTeamPolicy,
  previewTeamPolicyAdoption,
  registerTeam,
  saveTeamPolicyAsTemplate,
  teamPolicyRepo,
  teamRepo,
  updateTeamPolicySource,
} from '../core/index.ts'
import { validateSlug } from '../core/profile/validate.ts'
import { getCtx } from '../lib/ctx.ts'
import { sanitizeNativeModuleError } from '../lib/native-module-error.ts'
import { validateTopicNameFormat } from '../lib/telegram/naming.ts'
import { syncGroupTopicNames } from '../lib/telegram/topic-rename.ts'
import { qmdBackend } from '../runtime/index.ts'

// 12 KB cap — enough for a rich USER.md, small enough that it can't silently
// blow out the system prompt.
const USER_MD_MAX_BYTES = 12_000

export const teamsRouter = new Hono()

teamsRouter.get('/', (c) => {
  const { db, paths } = getCtx()
  return c.json(teamRepo.list(db, paths))
})

teamsRouter.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as RegisterTeamRequest | null
  if (!body || typeof body.id !== 'string') {
    return c.json({ error: 'id is required' }, 400)
  }
  const { db, paths } = getCtx()
  try {
    const g = registerTeam(db, { id: body.id, name: body.name, link: body.link }, paths)
    return c.json(g, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

teamsRouter.get('/:id', (c) => {
  const { db, paths } = getCtx()
  const g = teamRepo.get(db, c.req.param('id'), paths)
  if (!g) return c.json({ error: `team not found: ${c.req.param('id')}` }, 404)
  return c.json(g)
})

teamsRouter.get('/:id/policy', (c) => {
  const detail = teamPolicyRepo.detail(getCtx().db, c.req.param('id'))
  if (!detail) return c.json({ error: `team not found: ${c.req.param('id')}` }, 404)
  c.header('ETag', `"${detail.teamPolicy.revision}"`)
  return c.json(detail)
})

teamsRouter.get('/:id/policy/blocks', (c) => {
  const { db } = getCtx()
  const teamId = c.req.param('id')
  const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 100)
  const cursor = c.req.query('cursor')
  const separator = cursor?.indexOf(':') ?? -1
  const cursorTime = separator > 0 ? Number(cursor?.slice(0, separator)) : Number.MAX_SAFE_INTEGER
  const cursorId = separator > 0 ? (cursor?.slice(separator + 1) ?? '') : '\uffff'
  if (cursor && (!Number.isSafeInteger(cursorTime) || !cursorId))
    return c.json({ error: 'invalid cursor' }, 400)
  const reasonCode = c.req.query('reasonCode')
  const source = c.req.query('source')
  const target = c.req.query('target')
  const channel = c.req.query('channel')
  const origin = c.req.query('origin')
  const from = optionalTimestamp(c.req.query('from'))
  const to = optionalTimestamp(c.req.query('to'))
  if (from === 'invalid' || to === 'invalid') return c.json({ error: 'invalid time filter' }, 400)
  const filters = [
    '(source_team_id = ? OR target_team_id = ?)',
    "(? = '' OR reason_code = ?)",
    "(? = '' OR source_id = ? OR source_kind = ?)",
    "(? = '' OR target_id = ? OR target_kind = ?)",
    "(? = '' OR channel = ?)",
    "(? = '' OR origin = ?)",
    '(? = 0 OR created_at >= ?)',
    '(? = 0 OR created_at <= ?)',
    "(? = '' OR created_at < ? OR (created_at = ? AND id < ?))",
  ]
  const params: Array<string | number> = [
    teamId,
    teamId,
    reasonCode ?? '',
    reasonCode ?? '',
    source ?? '',
    source ?? '',
    source ?? '',
    target ?? '',
    target ?? '',
    target ?? '',
    channel ?? '',
    channel ?? '',
    origin ?? '',
    origin ?? '',
    from ?? 0,
    from ?? 0,
    to ?? 0,
    to ?? 0,
    cursor ?? '',
    cursorTime,
    cursorTime,
    cursorId,
    limit + 1,
  ]
  const rows = db.raw
    .query<Record<string, unknown>, Array<string | number>>(
      `SELECT id, attempt_kind, attempt_id, operation, source_kind, source_id, target_kind,
            target_id, source_team_id, target_team_id, channel, origin, reason_code, reason,
            policy_refs_json, component_outcomes_json, matched_edge_ids_json,
            required_edge_ids_json, created_at
       FROM team_policy_block_events
      WHERE ${filters.join(' AND ')}
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...params)
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

function optionalTimestamp(value: string | undefined): number | null | 'invalid' {
  if (value === undefined || value === '') return null
  const numeric = Number(value)
  if (Number.isSafeInteger(numeric) && numeric >= 0) return numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 'invalid'
}

teamsRouter.put('/:id/policy', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || !Number.isInteger(body.expectedRevision) || !Array.isArray(body.edges)) {
    return c.json({ error: 'expectedRevision and edges are required' }, 400)
  }
  try {
    const edges = body.edges.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`team_policy_invalid: edge ${index} must be an object`)
      }
      const edge = value as Record<string, unknown>
      return {
        sourceKind: edge.sourceKind as 'user' | 'outside_team' | 'agent',
        sourceId: typeof edge.sourceId === 'string' && edge.sourceId ? edge.sourceId : null,
        targetKind: edge.targetKind as 'user' | 'outside_team' | 'agent',
        targetId: typeof edge.targetId === 'string' && edge.targetId ? edge.targetId : null,
        posture: (edge.posture === 'approval_required' ? 'approval_required' : 'allow') as
          | 'allow'
          | 'approval_required',
      }
    })
    return c.json(
      teamPolicyRepo.replacePolicy(getCtx().db, c.req.param('id'), {
        expectedRevision: body.expectedRevision as number,
        edges,
      }),
    )
  } catch (error) {
    return teamPolicyError(c, error)
  }
})

teamsRouter.get('/:id/policy/diff', (c) => {
  try {
    return c.json(diffTeamPolicy(getCtx().db, c.req.param('id')))
  } catch (error) {
    return teamPolicyError(c, error)
  }
})

teamsRouter.post('/:id/policy/adopt-template', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (
    !body ||
    !Number.isInteger(body.teamExpectedRevision) ||
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
      adoptTeamTemplate(getCtx().db, c.req.param('id'), {
        teamExpectedRevision: body.teamExpectedRevision as number,
        templateId: body.templateId,
        templateExpectedRevision: body.templateExpectedRevision as number,
        slotMappings: body.slotMappings as Array<{ slotId: string; agentId: string }>,
        remainingPlacements: body.remainingPlacements as Array<{
          agentId: string
          placement: 'isolated' | 'profile_defaults'
        }>,
        previewEdges: body.previewEdges as Array<{
          sourceKind: 'user' | 'outside_team' | 'agent'
          sourceId: string | null
          targetKind: 'user' | 'outside_team' | 'agent'
          targetId: string | null
          posture: 'allow' | 'approval_required'
        }>,
      }),
    )
  } catch (error) {
    return teamPolicyError(c, error)
  }
})

teamsRouter.post('/:id/policy/adopt-template/preview', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (
    !body ||
    !Number.isInteger(body.teamExpectedRevision) ||
    typeof body.templateId !== 'string' ||
    !Number.isInteger(body.templateExpectedRevision) ||
    !Array.isArray(body.slotMappings) ||
    !Array.isArray(body.remainingPlacements)
  ) {
    return c.json({ error: 'invalid adoption preview request' }, 400)
  }
  try {
    return c.json({
      edges: previewTeamPolicyAdoption(getCtx().db, c.req.param('id'), {
        teamExpectedRevision: body.teamExpectedRevision as number,
        templateId: body.templateId,
        templateExpectedRevision: body.templateExpectedRevision as number,
        slotMappings: body.slotMappings as Array<{ slotId: string; agentId: string }>,
        remainingPlacements: body.remainingPlacements as Array<{
          agentId: string
          placement: 'isolated' | 'profile_defaults'
        }>,
      }),
    })
  } catch (error) {
    return teamPolicyError(c, error)
  }
})

teamsRouter.post('/:id/policy/save-as-template', async (c) => {
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
      saveTeamPolicyAsTemplate(getCtx().db, getCtx().paths, c.req.param('id'), {
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
    return teamPolicyError(c, error)
  }
})

teamsRouter.post('/:id/policy/update-source', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (
    !body ||
    !Number.isInteger(body.teamExpectedRevision) ||
    !Number.isInteger(body.templateExpectedRevision) ||
    !Array.isArray(body.includeAgentIds) ||
    body.includeAgentIds.some((id) => typeof id !== 'string')
  ) {
    return c.json({ error: 'invalid source update request' }, 400)
  }
  try {
    return c.json(
      updateTeamPolicySource(getCtx().db, c.req.param('id'), {
        teamExpectedRevision: body.teamExpectedRevision as number,
        templateExpectedRevision: body.templateExpectedRevision as number,
        includeAgentIds: body.includeAgentIds as string[],
      }),
    )
  } catch (error) {
    return teamPolicyError(c, error)
  }
})

teamsRouter.delete('/:id', (c) => {
  const { db, paths } = getCtx()
  try {
    const rawRevision = c.req.query('expectedTeamPolicyRevision')
    const expectedTeamPolicyRevision = rawRevision ? Number.parseInt(rawRevision, 10) : undefined
    if (
      !rawRevision ||
      !Number.isInteger(expectedTeamPolicyRevision) ||
      (expectedTeamPolicyRevision ?? 0) < 1
    ) {
      return c.json({ error: 'expectedTeamPolicyRevision must be a positive integer' }, 400)
    }
    deleteTeam(db, paths, c.req.param('id'), expectedTeamPolicyRevision as number)
    return c.body(null, 204)
  } catch (err) {
    const message = (err as Error).message
    return c.json(
      {
        error: message,
        ...(message.startsWith('placement_required')
          ? { code: 'revision_required' }
          : message.startsWith('team_revision_conflict')
            ? { code: 'team_revision_conflict' }
            : message.startsWith('team_policy_invalid')
              ? { code: 'team_policy_invalid' }
              : {}),
      },
      message.startsWith('placement_required') ||
        message.startsWith('team_policy_invalid') ||
        message.startsWith('team_revision_conflict')
        ? 409
        : 400,
    )
  }
})

teamsRouter.put('/:id/user-md', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SetTeamUserMdRequest | null
  if (!body || typeof body.userMd !== 'string') {
    return c.json({ error: 'userMd (string) is required' }, 400)
  }
  if (Buffer.byteLength(body.userMd, 'utf8') > USER_MD_MAX_BYTES) {
    return c.json({ error: `userMd exceeds ${USER_MD_MAX_BYTES}-byte cap` }, 413)
  }
  const { db, paths } = getCtx()
  const g = teamRepo.get(db, c.req.param('id'), paths)
  if (!g) return c.json({ error: `team not found: ${c.req.param('id')}` }, 404)
  teamRepo.setUserMd(db, c.req.param('id'), body.userMd)
  return c.json(teamRepo.get(db, c.req.param('id'), paths))
})

teamsRouter.put('/:id/topic-format', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SetTeamTopicFormatRequest | null
  if (!body || (body.format !== null && typeof body.format !== 'string')) {
    return c.json({ error: 'format (string or null) is required' }, 400)
  }
  const { db, paths } = getCtx()
  const id = c.req.param('id')
  if (!teamRepo.get(db, id, paths)) {
    return c.json({ error: `team not found: ${id}` }, 404)
  }
  // Empty / whitespace-only string clears the template.
  const format = body.format && body.format.trim().length > 0 ? body.format : null
  if (format !== null) {
    const err = validateTopicNameFormat(format)
    if (err) return c.json({ error: err }, 400)
  }
  teamRepo.setTelegramTopicNameFormat(db, id, format)
  // Re-render existing topics in the background; no-op when the bot isn't running.
  void syncGroupTopicNames(db, paths, id).catch((e) =>
    console.warn('telegram: topic-name sync after format change failed:', e),
  )
  return c.json(teamRepo.get(db, id, paths))
})

// ─── Memory (per-team, shared across all member agents) ──────────────────

class TeamMemoryNotFoundError extends Error {}

async function openMemory(rawId: string) {
  const { db, paths } = getCtx()
  const team = teamRepo.get(db, rawId, paths)
  if (!team) throw new TeamMemoryNotFoundError(`team not found: ${rawId}`)
  const mem = qmdBackend(join(team.path, 'memory'))
  await mem.init()
  return { mem, team }
}

function teamMemoryError(c: Context, error: unknown): Response {
  // qmd's native SQLite diagnostics can contain absolute checkout paths.
  // qmdBackend already applies this boundary; repeat it here so route-level
  // substitutions and future backends cannot accidentally expose one.
  const safe = sanitizeNativeModuleError(error, { subject: 'Bazilion memory' })
  const message = safe instanceof Error ? safe.message : String(safe)
  if (safe instanceof TeamMemoryNotFoundError || message.startsWith('memory entry not found:')) {
    return c.json({ error: message }, 404)
  }
  return c.json({ error: message }, 500)
}

teamsRouter.get('/:id/memory', async (c) => {
  try {
    const { mem } = await openMemory(c.req.param('id'))
    return c.json(await mem.list())
  } catch (err) {
    return teamMemoryError(c, err)
  }
})

teamsRouter.get('/:id/memory/search', async (c) => {
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'q is required' }, 400)
  const limit = Number.parseInt(c.req.query('limit') ?? '10', 10)
  try {
    const { mem } = await openMemory(c.req.param('id'))
    return c.json(await mem.search(q, { limit }))
  } catch (err) {
    return teamMemoryError(c, err)
  }
})

// `:key{.+}` matches multi-segment paths so memory keys with slashes (e.g.
// `notes/2026-04-25.md`) survive the routing layer. Without the regex Hono
// would only capture a single segment.
teamsRouter.get('/:id/memory/:key{.+}', async (c) => {
  try {
    const { mem } = await openMemory(c.req.param('id'))
    return c.json(await mem.read(c.req.param('key')))
  } catch (err) {
    return teamMemoryError(c, err)
  }
})

teamsRouter.put('/:id/memory/:key{.+}', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { content?: string } | null
  if (!body || typeof body.content !== 'string')
    return c.json({ error: 'content is required' }, 400)
  try {
    const { mem } = await openMemory(c.req.param('id'))
    return c.json(await mem.write(c.req.param('key'), body.content))
  } catch (err) {
    return teamMemoryError(c, err)
  }
})

teamsRouter.delete('/:id/memory/:key{.+}', async (c) => {
  try {
    const { mem } = await openMemory(c.req.param('id'))
    await mem.remove(c.req.param('key'))
    return c.body(null, 204)
  } catch (err) {
    return teamMemoryError(c, err)
  }
})

function teamPolicyError(c: Context, error: unknown): Response {
  const message = (error as Error).message
  if (message.startsWith('team_policy_missing')) return c.json({ error: message }, 404)
  if (message.startsWith('team_revision_conflict')) {
    const currentRevision = Number.parseInt(message.match(/current (\d+)/)?.[1] ?? '', 10)
    return c.json({ error: message, code: 'team_revision_conflict', currentRevision }, 409)
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
  return c.json({ error: message, code: 'team_policy_invalid' }, 400)
}
