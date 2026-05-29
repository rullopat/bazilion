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
import { Hono } from 'hono'
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

profileGroupsRouter.get('/', (c) => {
  const { db } = getCtx()
  return c.json(profileGroupRepo.list(db))
})

profileGroupsRouter.get('/:id', (c) => {
  const { db } = getCtx()
  const id = c.req.param('id')
  const group = profileGroupRepo.get(db, id)
  if (!group) return c.json({ error: `profile group not found: ${id}` }, 404)
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
  // Distinguish undefined (don't touch) from null (clear) per repo semantics.
  const patch: UpdateProfileGroupPatch = {}
  if (Object.hasOwn(raw, 'name') && typeof raw.name === 'string') {
    patch.name = raw.name
  }
  if (Object.hasOwn(raw, 'userMd')) {
    patch.userMd = raw.userMd === null ? null : typeof raw.userMd === 'string' ? raw.userMd : null
  }
  profileGroupRepo.update(db, id, patch)
  return c.json(profileGroupRepo.get(db, id))
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
  profileGroupRepo.replaceMembers(db, id, cleaned)
  return c.json({ members: profileGroupRepo.members(db, id) })
})

profileGroupsRouter.delete('/:id', (c) => {
  const { db } = getCtx()
  const id = c.req.param('id')
  if (!profileGroupRepo.get(db, id)) {
    return c.json({ error: `profile group not found: ${id}` }, 404)
  }
  profileGroupRepo.remove(db, id)
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
    return c.json({ error: msg }, 500)
  }
})
