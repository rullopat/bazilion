// /api/profile-groups/* — preconfigured team templates. Each profile group
// holds an ordered list of members that the spawn op replays as a single
// transactional call.

import type {
  CreateProfileGroupRequest,
  ProfileGroupDetail,
  PutProfileGroupMembersRequest,
  ReasoningLevel,
  SpawnProfileGroupRequest,
  SpawnProfileGroupResponse,
  UpdateProfileGroupRequest,
} from '@bazilion/api-types'
import { REASONING_LEVELS } from '@bazilion/api-types'
import { type Context, Hono } from 'hono'
import {
  profileGroupRepo,
  profileRepo,
  SpawnProfileGroupError,
  spawnProfileGroup,
} from '../core/index.ts'
import { validateSlug } from '../core/profile/validate.ts'
import type { MemberInput, UpdateProfileGroupPatch } from '../core/repos/profileGroups.ts'
import { getCtx } from '../lib/ctx.ts'
import { notifyDirectoryDirty } from '../lib/telegram/directory.ts'

export const profileGroupsRouter = new Hono()

profileGroupsRouter.use('*', async (c, next) => {
  c.header('Deprecation', 'true')
  c.header('Sunset', 'Sun, 10 Jan 2027 00:00:00 GMT')
  c.header('Link', '</api/harness-templates>; rel="successor-version"')
  await next()
})

profileGroupsRouter.get('/', (c) => {
  const { db } = getCtx()
  return c.json(profileGroupRepo.list(db))
})

profileGroupsRouter.get('/:id', (c) => {
  const { db } = getCtx()
  const id = c.req.param('id')
  const group = profileGroupRepo.get(db, id)
  if (!group) return c.json({ error: `profile group not found: ${id}` }, 404)
  if (group.revision) c.header('ETag', `"${group.revision}"`)
  const body: ProfileGroupDetail = {
    group,
    members: profileGroupRepo.members(db, id),
  }
  return c.json(body)
})

profileGroupsRouter.post('/', async (c) => {
  const raw = (await c.req.json().catch(() => null)) as
    | (CreateProfileGroupRequest & Record<string, unknown>)
    | null
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!id) return c.json({ error: 'id is required' }, 400)
  try {
    validateSlug(id)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
  const { db } = getCtx()
  if (profileGroupRepo.get(db, id)) {
    return c.json({ error: `profile group already exists: ${id}` }, 409)
  }
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : id
  const userMd = typeof raw.userMd === 'string' ? raw.userMd : null
  try {
    const inserted = profileGroupRepo.insert(db, { id, name, userMd })
    return c.json(inserted, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

profileGroupsRouter.patch('/:id', async (c) => {
  const raw = (await c.req.json().catch(() => null)) as
    | (UpdateProfileGroupRequest & Record<string, unknown>)
    | null
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const { db } = getCtx()
  const id = c.req.param('id')
  if (!profileGroupRepo.get(db, id)) {
    return c.json({ error: `profile group not found: ${id}` }, 404)
  }
  const conflict = expectedRevisionConflict(c, profileGroupRepo.get(db, id)?.revision)
  if (conflict) return conflict
  // Distinguish undefined (don't touch) from null (clear) per repo semantics.
  const patch: UpdateProfileGroupPatch = {}
  if (Object.hasOwn(raw, 'name') && typeof raw.name === 'string') {
    patch.name = raw.name
  }
  if (Object.hasOwn(raw, 'userMd')) {
    patch.userMd = raw.userMd === null ? null : typeof raw.userMd === 'string' ? raw.userMd : null
  }
  try {
    profileGroupRepo.update(db, id, patch)
    return c.json(profileGroupRepo.get(db, id))
  } catch (error) {
    return compatibilityError(c, error)
  }
})

profileGroupsRouter.put('/:id/members', async (c) => {
  const raw = (await c.req.json().catch(() => null)) as
    | (PutProfileGroupMembersRequest & Record<string, unknown>)
    | null
  if (!raw || !Array.isArray(raw.members)) {
    return c.json({ error: 'members array is required' }, 400)
  }
  const { db } = getCtx()
  const id = c.req.param('id')
  if (!profileGroupRepo.get(db, id)) {
    return c.json({ error: `profile group not found: ${id}` }, 404)
  }
  const conflict = expectedRevisionConflict(c, profileGroupRepo.get(db, id)?.revision)
  if (conflict) return conflict
  const cleaned: MemberInput[] = []
  const missingProfiles: string[] = []
  for (let i = 0; i < raw.members.length; i++) {
    const m = raw.members[i] as Record<string, unknown> | undefined
    if (!m || typeof m.profileId !== 'string' || typeof m.agentName !== 'string') {
      return c.json({ error: `member ${i}: profileId and agentName are required strings` }, 400)
    }
    if (!profileRepo.get(db, m.profileId)) {
      missingProfiles.push(m.profileId)
      continue
    }
    const modelOverride =
      m.modelOverride === null ? null : typeof m.modelOverride === 'string' ? m.modelOverride : null
    const reasoningLevel =
      m.reasoningLevel === null
        ? null
        : typeof m.reasoningLevel === 'string' &&
            (REASONING_LEVELS as readonly string[]).includes(m.reasoningLevel)
          ? (m.reasoningLevel as ReasoningLevel)
          : null
    cleaned.push({
      profileId: m.profileId,
      agentName: m.agentName,
      modelOverride,
      reasoningLevel,
    })
  }
  if (missingProfiles.length > 0) {
    return c.json({ error: `missing profiles: ${[...new Set(missingProfiles)].join(', ')}` }, 400)
  }
  try {
    profileGroupRepo.replaceMembers(db, id, cleaned)
    return c.json({ members: profileGroupRepo.members(db, id) })
  } catch (error) {
    return compatibilityError(c, error)
  }
})

profileGroupsRouter.delete('/:id', (c) => {
  const { db } = getCtx()
  const id = c.req.param('id')
  if (!profileGroupRepo.get(db, id)) {
    return c.json({ error: `profile group not found: ${id}` }, 404)
  }
  const conflict = expectedRevisionConflict(c, profileGroupRepo.get(db, id)?.revision)
  if (conflict) return conflict
  try {
    profileGroupRepo.remove(db, id)
  } catch (error) {
    return compatibilityError(c, error)
  }
  return c.body(null, 204)
})

profileGroupsRouter.post('/:id/spawn', async (c) => {
  const raw = (await c.req.json().catch(() => ({}))) as
    | (SpawnProfileGroupRequest & Record<string, unknown>)
    | null
  const body = raw ?? {}
  const groupSlug = typeof body.groupSlug === 'string' ? body.groupSlug : undefined
  const userMd = typeof body.userMd === 'string' ? body.userMd : undefined
  const { db, paths } = getCtx()
  const id = c.req.param('id')
  const conflict = expectedRevisionConflict(c, profileGroupRepo.get(db, id)?.revision)
  if (conflict) return conflict
  try {
    const result = await spawnProfileGroup(db, paths, {
      profileGroupId: id,
      groupSlug,
      userMd,
    })
    // One refresh covers the whole batch of spawned agents.
    notifyDirectoryDirty()
    const response: SpawnProfileGroupResponse = {
      groupSlug: result.groupSlug,
      agents: result.agents,
    }
    if (result.orphanAgentIds.length > 0) response.orphanAgentIds = result.orphanAgentIds
    return c.json(response)
  } catch (err) {
    if (err instanceof SpawnProfileGroupError) {
      // The error carries structured orphan IDs separate from the message.
      return c.json({ error: err.message, orphanAgentIds: err.orphanAgentIds }, 500)
    }
    const msg = (err as Error).message
    if (msg.startsWith('profile group not found')) return c.json({ error: msg }, 404)
    if (msg.startsWith('profile group spawn: missing profiles')) {
      return c.json({ error: msg }, 400)
    }
    return compatibilityError(c, err)
  }
})

function expectedRevisionConflict(
  c: Context,
  currentRevision: number | undefined,
): Response | null {
  const raw = c.req.header('If-Match')
  if (!raw || currentRevision === undefined) return null
  if (raw.trim() === '*') return null
  const match = raw.trim().match(/^(?:W\/)?"?(\d+)"?$/)
  const expected = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN
  if (Number.isInteger(expected) && expected === currentRevision) return null
  return c.json(
    {
      error: `template_revision_conflict: expected ${raw}, current ${currentRevision}`,
      code: 'template_revision_conflict',
      currentRevision,
    },
    409,
  )
}

function compatibilityError(c: Context, error: unknown): Response {
  const message = (error as Error).message
  if (message.startsWith('template_deleted')) {
    return c.json({ error: message, code: 'template_deleted' }, 410)
  }
  if (message.startsWith('migration_required')) {
    return c.json({ error: message, code: 'migration_required' }, 409)
  }
  if (message.startsWith('policy_merge_required')) {
    return c.json({ error: message, code: 'policy_merge_required' }, 409)
  }
  return c.json({ error: message }, 500)
}
