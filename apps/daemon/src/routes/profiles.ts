// /api/profiles/* — profile CRUD + per-profile template files.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CreateProfileRequest,
  FileContentResponse,
  ProfileFileName,
  PutFileRequest,
  SkillsMode,
  UpdateProfileRequest,
} from '@bazilion/api-types'
import { PROFILE_FILES } from '@bazilion/api-types'
import { Hono } from 'hono'
import {
  agentRepo,
  createProfile,
  DEFAULT_AGENTS,
  DEFAULT_BOOTSTRAP,
  DEFAULT_HEARTBEAT,
  DEFAULT_IDENTITY,
  DEFAULT_SOUL,
  DEFAULT_TOOLS,
  DEFAULT_USER_MD,
  deleteProfile,
  loadProfile,
  profileRepo,
  updateProfile,
} from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'

export const profilesRouter = new Hono()

profilesRouter.get('/', (c) => {
  const { db } = getCtx()
  const profiles = profileRepo.list(db)
  // Hydrate with the per-profile fields the listing UI needs (agent counts,
  // default-skill list) so callers don't fan out to extra endpoints per row.
  const hydrated = profiles.map((p) => ({
    ...p,
    agentCount: agentRepo.countByProfile(db, p.id),
    defaultSkills: profileRepo.getDefaultSkills(db, p.id),
  }))
  return c.json(hydrated)
})

// /api/profiles/_/templates — built-in defaults for every seeded markdown file.
// Underscore prefix avoids clashing with the `:id` route. Consumed by the
// profile create form (SOUL/IDENTITY/BOOTSTRAP + the now-default-on
// AGENTS/TOOLS/HEARTBEAT) and the profile-group create form (userMd).
profilesRouter.get('/_/templates', (c) => {
  return c.json({
    soul: DEFAULT_SOUL,
    identity: DEFAULT_IDENTITY,
    bootstrap: DEFAULT_BOOTSTRAP,
    agents: DEFAULT_AGENTS,
    tools: DEFAULT_TOOLS,
    heartbeat: DEFAULT_HEARTBEAT,
    userMd: DEFAULT_USER_MD,
  })
})

profilesRouter.post('/', async (c) => {
  const raw = (await c.req.json().catch(() => null)) as
    | (Record<string, unknown> & Partial<CreateProfileRequest>)
    | null
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const id = typeof raw.id === 'string' ? raw.id : ''
  const defaultModel =
    typeof raw.defaultModel === 'string'
      ? raw.defaultModel
      : typeof raw.model === 'string'
        ? raw.model
        : ''
  if (!id || !defaultModel) return c.json({ error: 'id and model are required' }, 400)
  const name = typeof raw.name === 'string' ? raw.name : undefined

  const skillsMode = toSkillsMode(raw.skillsMode) ?? 'selected'
  const defaultSkills = csvToArray(raw.defaultSkills ?? raw.skills)

  // Tri-state per optional file: a non-empty string overrides, `null` skips the
  // file, and omitting it (undefined) lets createProfile write the default.
  // AGENTS/TOOLS are default-on and HEARTBEAT is opt-in, so the UI prefills the
  // editors and passes `null` only when the operator explicitly opts out.
  const templates: {
    soul?: string
    identity?: string
    bootstrap?: string | null
    agents?: string | null
    tools?: string | null
    heartbeat?: string | null
  } = {}
  if (typeof raw.soul === 'string' && raw.soul.length > 0) templates.soul = raw.soul
  if (typeof raw.identity === 'string' && raw.identity.length > 0) templates.identity = raw.identity
  if (raw.skipBootstrap === true || raw.bootstrap === null) templates.bootstrap = null
  else if (typeof raw.bootstrap === 'string' && raw.bootstrap.length > 0)
    templates.bootstrap = raw.bootstrap
  if (raw.agents === null) templates.agents = null
  else if (typeof raw.agents === 'string' && raw.agents.length > 0) templates.agents = raw.agents
  if (raw.tools === null) templates.tools = null
  else if (typeof raw.tools === 'string' && raw.tools.length > 0) templates.tools = raw.tools
  if (raw.heartbeat === null) templates.heartbeat = null
  else if (typeof raw.heartbeat === 'string' && raw.heartbeat.length > 0)
    templates.heartbeat = raw.heartbeat

  const { db, paths } = getCtx()
  try {
    const profile = createProfile(db, paths, {
      id,
      name,
      defaultModel,
      skillsMode,
      defaultSkills,
      ...(Object.keys(templates).length > 0 ? { templates } : {}),
    })
    return c.json(profile, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

profilesRouter.get('/:id', (c) => {
  const { db } = getCtx()
  try {
    return c.json(loadProfile(db, c.req.param('id')))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404)
  }
})

profilesRouter.patch('/:id', async (c) => {
  const raw = (await c.req.json().catch(() => null)) as
    | (UpdateProfileRequest & Record<string, unknown>)
    | null
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)

  const input: UpdateProfileRequest = {}
  if (typeof raw.name === 'string') input.name = raw.name
  if (typeof raw.defaultModel === 'string' && raw.defaultModel.length > 0)
    input.defaultModel = raw.defaultModel
  if (raw.skillsMode === 'all' || raw.skillsMode === 'selected') {
    input.skillsMode = raw.skillsMode
  }
  const rawSkills: unknown = raw.defaultSkills
  if (Array.isArray(rawSkills)) {
    input.defaultSkills = rawSkills.filter((s): s is string => typeof s === 'string')
  } else if (typeof rawSkills === 'string') {
    input.defaultSkills = rawSkills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const { db, paths } = getCtx()
  try {
    return c.json(updateProfile(db, paths, c.req.param('id'), input))
  } catch (err) {
    const msg = (err as Error).message
    return c.json({ error: msg }, msg.startsWith('profile not found') ? 404 : 400)
  }
})

profilesRouter.delete('/:id', (c) => {
  const { db } = getCtx()
  try {
    deleteProfile(db, c.req.param('id'))
    return c.body(null, 204)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

profilesRouter.get('/:id/files/:file', (c) => {
  const { db, paths } = getCtx()
  if (!profileRepo.get(db, c.req.param('id')))
    return c.json({ error: `profile not found: ${c.req.param('id')}` }, 404)
  const path = resolveFilePath(paths.profilesDir, c.req.param('id'), c.req.param('file'))
  if (!path) return c.json({ error: `unsupported file: ${c.req.param('file')}` }, 400)
  if (!existsSync(path)) return c.json({ error: `file not present: ${c.req.param('file')}` }, 404)
  const body: FileContentResponse = { content: readFileSync(path, 'utf8') }
  return c.json(body)
})

profilesRouter.put('/:id/files/:file', async (c) => {
  const body = (await c.req.json().catch(() => null)) as PutFileRequest | null
  if (!body || typeof body.content !== 'string')
    return c.json({ error: 'content is required' }, 400)
  const { db, paths } = getCtx()
  if (!profileRepo.get(db, c.req.param('id')))
    return c.json({ error: `profile not found: ${c.req.param('id')}` }, 404)
  const path = resolveFilePath(paths.profilesDir, c.req.param('id'), c.req.param('file'))
  if (!path) return c.json({ error: `unsupported file: ${c.req.param('file')}` }, 400)
  writeFileSync(path, body.content)
  return c.body(null, 204)
})

function resolveFilePath(profilesDir: string, id: string, file: string): string | null {
  if (!(PROFILE_FILES as readonly string[]).includes(file)) return null
  return join(profilesDir, id, file as ProfileFileName)
}

function csvToArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string')
  if (typeof v === 'string' && v.length > 0) {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return undefined
}

function toSkillsMode(v: unknown): SkillsMode | undefined {
  return v === 'all' || v === 'selected' ? v : undefined
}
