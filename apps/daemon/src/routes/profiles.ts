// /api/profiles: Agent templates (profiles) and their template files.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type CreateProfileRequest,
  type FileContentResponse,
  PROFILE_FILES,
  type ProfileFileName,
  type ProfileSummary,
  type ProfileTemplates,
  type PutFileRequest,
  type SkillsMode,
  type UpdateProfileRequest,
} from '@bazilion/api-types'
import type { Context } from 'hono'
import {
  agentRepo,
  createProfile,
  DEFAULT_AGENTS,
  DEFAULT_BOOTSTRAP,
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
import { jsonBody, newRouter } from './http.ts'

export const profilesRouter = newRouter()

profilesRouter.get('/', (c) => {
  const { db } = getCtx()
  // Each profile carries what the list shows (agent count, default skills), so the UI needs no
  // request per row.
  const profiles = profileRepo.list(db).map(
    (p): ProfileSummary => ({
      ...p,
      agentCount: agentRepo.countByProfile(db, p.id),
      defaultSkills: profileRepo.getDefaultSkills(db, p.id),
    }),
  )
  return c.json(profiles)
})

// Built-in defaults for every seeded markdown file; the underscore keeps it clear of `/:id`.
// Read by the profile and Team Template create forms.
profilesRouter.get('/_/templates', (c) =>
  c.json({
    soul: DEFAULT_SOUL,
    identity: DEFAULT_IDENTITY,
    bootstrap: DEFAULT_BOOTSTRAP,
    agents: DEFAULT_AGENTS,
    tools: DEFAULT_TOOLS,
    userMd: DEFAULT_USER_MD,
  } satisfies ProfileTemplates),
)

function toSkillsMode(v: unknown): SkillsMode | undefined {
  return v === 'all' || v === 'selected' ? v : undefined
}

function stringList(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined
}

profilesRouter.post('/', async (c) => {
  const body = await jsonBody<CreateProfileRequest>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const { id, defaultModel } = body
  if (typeof id !== 'string' || !id || typeof defaultModel !== 'string' || !defaultModel) {
    return c.json({ error: 'id and defaultModel are required' }, 400)
  }

  // Per optional file: a non-empty string overrides, `null` skips the file, and omitting it lets
  // createProfile write the default. AGENTS/TOOLS are default-on, so the UI prefills the editors
  // and passes `null` only when the operator opts out.
  const templates: {
    soul?: string
    identity?: string
    bootstrap?: string | null
    agents?: string | null
    tools?: string | null
  } = {}
  if (typeof body.soul === 'string' && body.soul) templates.soul = body.soul
  if (typeof body.identity === 'string' && body.identity) templates.identity = body.identity
  for (const key of ['bootstrap', 'agents', 'tools'] as const) {
    const value = body[key]
    if (value === null) templates[key] = null
    else if (typeof value === 'string' && value) templates[key] = value
  }

  const { db, paths } = getCtx()
  const profile = createProfile(db, paths, {
    id,
    name: typeof body.name === 'string' ? body.name : undefined,
    defaultModel,
    skillsMode: toSkillsMode(body.skillsMode) ?? 'selected',
    defaultSkills: stringList(body.defaultSkills),
    ...(Object.keys(templates).length > 0 ? { templates } : {}),
  })
  return c.json(profile, 201)
})

profilesRouter.get('/:id', (c) => c.json(loadProfile(getCtx().db, c.req.param('id'))))

profilesRouter.patch('/:id', async (c) => {
  const body = await jsonBody<UpdateProfileRequest>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const input: UpdateProfileRequest = {}
  if (typeof body.name === 'string') input.name = body.name
  if (typeof body.defaultModel === 'string' && body.defaultModel) {
    input.defaultModel = body.defaultModel
  }
  const skillsMode = toSkillsMode(body.skillsMode)
  if (skillsMode) input.skillsMode = skillsMode
  const defaultSkills = stringList(body.defaultSkills)
  if (defaultSkills) input.defaultSkills = defaultSkills
  return c.json(updateProfile(getCtx().db, c.req.param('id'), input))
})

profilesRouter.delete('/:id', (c) => {
  deleteProfile(getCtx().db, c.req.param('id'))
  return c.body(null, 204)
})

/** The template file `:file` of the existing profile `:id`, or an error response. */
function profileFile(c: Context): string | Response {
  const { db, paths } = getCtx()
  const id = c.req.param('id') ?? ''
  const file = c.req.param('file') ?? ''
  if (!profileRepo.get(db, id)) return c.json({ error: `profile not found: ${id}` }, 404)
  if (!(PROFILE_FILES as readonly string[]).includes(file)) {
    return c.json({ error: `unsupported file: ${file}` }, 400)
  }
  return join(paths.profilesDir, id, file as ProfileFileName)
}

profilesRouter.get('/:id/files/:file', (c) => {
  const path = profileFile(c)
  if (typeof path !== 'string') return path
  if (!existsSync(path)) return c.json({ error: `file not present: ${c.req.param('file')}` }, 404)
  return c.json({ content: readFileSync(path, 'utf8') } satisfies FileContentResponse)
})

profilesRouter.put('/:id/files/:file', async (c) => {
  const body = await jsonBody<PutFileRequest>(c)
  if (typeof body?.content !== 'string') return c.json({ error: 'content is required' }, 400)
  const path = profileFile(c)
  if (typeof path !== 'string') return path
  writeFileSync(path, body.content)
  return c.body(null, 204)
})
