// /api/agents: Agent CRUD, archive and Team moves. Every other /api/agents/:id/* feature has its
// own router (agent-chat, agent-browser, agent-learning, messages, skills, telegram, triggers,
// conversations, user-queue, questions).

import { join } from 'node:path'
import {
  type MoveAgentRequest,
  REASONING_LEVELS,
  type ReasoningLevel,
  type SpawnAgentRequest,
} from '@bazilion/api-types'
import {
  agentRepo,
  archiveAgent,
  deleteAgent,
  loadIdentityFromFile,
  moveAgent,
  resolveAgent,
  spawnAgent,
  unarchiveAgent,
} from '../core/index.ts'
import { runAgentLifecycleMutation } from '../lib/agent-cancel.ts'
import { closeBrowserSession, removeBrowserProfile } from '../lib/browser/pool.ts'
import { getCtx } from '../lib/ctx.ts'
import { notifyDirectoryDirty } from '../lib/telegram/directory.ts'
import { syncAgentTopicIcon } from '../lib/telegram/topic-rename.ts'
import { jsonBody, newRouter, routeAgent } from './http.ts'

export const agentsRouter = newRouter()

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return REASONING_LEVELS.includes(value as ReasoningLevel)
}

agentsRouter.get('/', (c) => {
  const includeArchived = c.req.query('includeArchived') === 'true'
  // Each agent carries its parsed IDENTITY.md (null while it holds placeholders), so the list
  // can render avatars without a request per row.
  const agents = agentRepo.list(getCtx().db, { includeArchived }).map((agent) => ({
    ...agent,
    identity: loadIdentityFromFile(join(agent.dir, 'IDENTITY.md')),
  }))
  return c.json(agents)
})

agentsRouter.post('/', async (c) => {
  const body = await jsonBody<SpawnAgentRequest>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  if (typeof body.profileId !== 'string' || !body.profileId) {
    return c.json({ error: 'profileId is required' }, 400)
  }
  if (body.reasoningLevel !== undefined && !isReasoningLevel(body.reasoningLevel)) {
    return c.json({ error: `invalid reasoningLevel: ${body.reasoningLevel}` }, 400)
  }
  const { db, paths } = getCtx()
  const agent = spawnAgent(db, paths, {
    profileId: body.profileId,
    ...(typeof body.name === 'string' && body.name ? { name: body.name } : {}),
    ...(typeof body.model === 'string' && body.model ? { modelOverride: body.model } : {}),
    ...(body.reasoningLevel ? { reasoningLevel: body.reasoningLevel } : {}),
    ...(typeof body.teamId === 'string' && body.teamId ? { teamId: body.teamId } : {}),
  })
  notifyDirectoryDirty()
  return c.json({ agent }, 201)
})

agentsRouter.get('/:id', (c) => {
  const { db, paths } = getCtx()
  return c.json(resolveAgent(db, paths, c.req.param('id')))
})

agentsRouter.patch('/:id', async (c) => {
  const body = await jsonBody<Record<string, unknown>>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const { id } = routeAgent(c)

  // Validate every field before changing any.
  const { name, telegramMirrorMode, telegramIconEmoji, reasoningLevel, modelOverride } = body
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return c.json(
      { error: typeof name === 'string' ? 'name cannot be empty' : 'name must be a string' },
      400,
    )
  }
  if (
    telegramMirrorMode !== undefined &&
    telegramMirrorMode !== 'minimal' &&
    telegramMirrorMode !== 'verbose'
  ) {
    return c.json({ error: `invalid telegramMirrorMode: ${String(telegramMirrorMode)}` }, 400)
  }
  if (
    telegramIconEmoji !== undefined &&
    telegramIconEmoji !== null &&
    typeof telegramIconEmoji !== 'string'
  ) {
    return c.json({ error: 'telegramIconEmoji must be a string or null' }, 400)
  }
  if (reasoningLevel !== undefined && !isReasoningLevel(reasoningLevel)) {
    return c.json({ error: `invalid reasoningLevel: ${reasoningLevel}` }, 400)
  }
  if (modelOverride !== undefined && modelOverride !== null && typeof modelOverride !== 'string') {
    return c.json({ error: 'modelOverride must be a string or null' }, 400)
  }

  const { db } = getCtx()
  if (typeof name === 'string') agentRepo.setName(db, id, name.trim())
  if (telegramMirrorMode !== undefined) agentRepo.setTelegramMirrorMode(db, id, telegramMirrorMode)
  if (telegramIconEmoji !== undefined) {
    agentRepo.setTelegramIconEmoji(db, id, telegramIconEmoji?.trim() || null)
    // Push the new icon to the live topic (best-effort; no-op when unbound).
    void syncAgentTopicIcon(db, id).catch(() => undefined)
  }
  if (reasoningLevel !== undefined) agentRepo.setReasoningLevel(db, id, reasoningLevel)
  if (modelOverride !== undefined) agentRepo.setModelOverride(db, id, modelOverride || null)
  // The Telegram directory shows agent names.
  if (name !== undefined) notifyDirectoryDirty()
  return c.json(agentRepo.get(db, id))
})

agentsRouter.delete('/:id', async (c) => {
  const { db, paths } = getCtx()
  const { id } = routeAgent(c)
  await runAgentLifecycleMutation(id, () => deleteAgent(db, id))
  notifyDirectoryDirty()
  // The agent's browser and profile go with it.
  await removeBrowserProfile(id, paths).catch((error) =>
    console.warn(`browser: could not remove the profile of deleted agent ${id}:`, error),
  )
  return c.body(null, 204)
})

agentsRouter.post('/:id/archive', async (c) => {
  const { db } = getCtx()
  const { id } = routeAgent(c)
  await runAgentLifecycleMutation(id, () => archiveAgent(db, id))
  notifyDirectoryDirty()
  // An archived agent runs no turns: its browser stops, the profile stays.
  await closeBrowserSession(id)
  return c.body(null, 204)
})

agentsRouter.post('/:id/unarchive', async (c) => {
  const { db } = getCtx()
  const { id } = routeAgent(c)
  await runAgentLifecycleMutation(id, () => unarchiveAgent(db, id))
  notifyDirectoryDirty()
  return c.body(null, 204)
})

agentsRouter.patch('/:id/team', async (c) => {
  const body = await jsonBody<MoveAgentRequest>(c)
  const teamId = body?.teamId
  if (typeof teamId !== 'string' || !teamId) {
    return c.json({ error: 'teamId (string) is required' }, 400)
  }
  const { db, paths } = getCtx()
  const { id } = routeAgent(c)
  await runAgentLifecycleMutation(id, () => moveAgent(db, paths, id, teamId))
  notifyDirectoryDirty()
  return c.json({ agent: resolveAgent(db, paths, id) })
})
