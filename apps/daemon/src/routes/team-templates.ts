import { randomUUID } from 'node:crypto'
import type { ReasoningLevel } from '@bazilion/api-types'
import { REASONING_LEVELS } from '@bazilion/api-types'
import { type Context, Hono } from 'hono'
import {
  previewTeamTemplateSpawn,
  profileRepo,
  SpawnTeamTemplateError,
  spawnTeamTemplate,
  teamTemplateRepo,
} from '../core/index.ts'
import { validateSlug } from '../core/profile/validate.ts'
import type {
  CanonicalDefinitionInput,
  CanonicalEdgeInput,
  CanonicalSlotInput,
} from '../core/repos/teamTemplates.ts'
import { getCtx } from '../lib/ctx.ts'

export const teamTemplatesRouter = new Hono()

teamTemplatesRouter.get('/', (c) => {
  const { db } = getCtx()
  return c.json(
    teamTemplateRepo.list(db).map((template) => ({
      ...template,
      slotCount: teamTemplateRepo.slots(db, template.id).length,
    })),
  )
})

teamTemplatesRouter.post('/import', async (c) => {
  const raw = await jsonObject(c)
  if (!raw || !Array.isArray(raw.slots) || !Array.isArray(raw.edges)) {
    return c.json({ error: 'id, name, slots, and edges are required' }, 400)
  }
  const id = stringValue(raw.id)
  const name = stringValue(raw.name)
  if (!id || !name) return c.json({ error: 'id and name are required' }, 400)
  try {
    validateSlug(id)
    const { db } = getCtx()
    if (teamTemplateRepo.get(db, id)) {
      return c.json({ error: `team template already exists: ${id}` }, 409)
    }
    const keyToSlot = new Map<string, string>()
    const slots = raw.slots.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`invalid_template_import: slot ${index} must be an object`)
      }
      const slot = value as Record<string, unknown>
      const clientKey = stringValue(slot.clientKey)
      if (!clientKey || keyToSlot.has(clientKey)) {
        throw new Error(`invalid_template_import: slot ${index} clientKey is missing or duplicate`)
      }
      const parsed = parseSlot(slot, index)
      if (!profileRepo.get(db, parsed.profileId)) {
        throw new Error(`profile not found: ${parsed.profileId}`)
      }
      const slotId = randomUUID()
      keyToSlot.set(clientKey, slotId)
      return { ...parsed, slotId }
    })
    const edges = raw.edges.map((value, index) => {
      const parsed = parseEdge(value, index)
      const translate = (kind: CanonicalEdgeInput['sourceKind'], clientKey: string | null) => {
        if (kind !== 'slot') return null
        const slotId = keyToSlot.get(clientKey ?? '')
        if (!slotId)
          throw new Error(`invalid_template_import: edge ${index} references an unknown slot`)
        return slotId
      }
      return {
        ...parsed,
        sourceId: translate(parsed.sourceKind, parsed.sourceId ?? null),
        targetId: translate(parsed.targetKind, parsed.targetId ?? null),
      }
    })
    return c.json(
      teamTemplateRepo.insertCanonicalDefinition(db, {
        id,
        name,
        userMd: nullableString(raw.userMd),
        slots,
        edges,
      }),
      201,
    )
  } catch (error) {
    return canonicalError(c, error)
  }
})

teamTemplatesRouter.get('/:id', (c) => {
  const { db } = getCtx()
  const detail = teamTemplateRepo.detail(db, c.req.param('id'))
  if (!detail) return c.json({ error: 'team template not found' }, 404)
  c.header('ETag', `"${detail.template.currentRevision}"`)
  return c.json(detail)
})

teamTemplatesRouter.post('/', async (c) => {
  const raw = await jsonObject(c)
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const id = stringValue(raw.id)
  const name = stringValue(raw.name)
  if (!id || !name) return c.json({ error: 'id and name are required' }, 400)
  try {
    validateSlug(id)
    const { db } = getCtx()
    if (teamTemplateRepo.get(db, id)) {
      return c.json({ error: `team template already exists: ${id}` }, 409)
    }
    return c.json(
      teamTemplateRepo.insertCanonical(db, {
        id,
        name,
        userMd: nullableString(raw.userMd),
      }),
      201,
    )
  } catch (error) {
    return canonicalError(c, error)
  }
})

teamTemplatesRouter.patch('/:id', async (c) => {
  const raw = await jsonObject(c)
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const expectedRevision = positiveInteger(raw.expectedRevision)
  if (!expectedRevision) return c.json({ error: 'expectedRevision is required' }, 400)
  const input: { expectedRevision: number; name?: string; userMd?: string | null } = {
    expectedRevision,
  }
  if (Object.hasOwn(raw, 'name')) {
    const name = stringValue(raw.name)
    if (!name) return c.json({ error: 'name must be a non-empty string' }, 400)
    input.name = name
  }
  if (Object.hasOwn(raw, 'userMd')) input.userMd = nullableString(raw.userMd)
  try {
    return c.json(teamTemplateRepo.updateCanonicalMetadata(getCtx().db, c.req.param('id'), input))
  } catch (error) {
    return canonicalError(c, error)
  }
})

teamTemplatesRouter.put('/:id/definition', async (c) => {
  const raw = await jsonObject(c)
  if (!raw || !Array.isArray(raw.slots) || !Array.isArray(raw.edges)) {
    return c.json({ error: 'expectedRevision, slots, and edges are required' }, 400)
  }
  const expectedRevision = positiveInteger(raw.expectedRevision)
  if (!expectedRevision) return c.json({ error: 'expectedRevision is required' }, 400)
  const { db } = getCtx()
  try {
    const slots = raw.slots.map((value, index) => parseSlot(value, index))
    for (const slot of slots) {
      if (!profileRepo.get(db, slot.profileId)) {
        return c.json({ error: `profile not found: ${slot.profileId}` }, 400)
      }
    }
    const input: CanonicalDefinitionInput = {
      expectedRevision,
      slots,
      edges: raw.edges.map((value, index) => parseEdge(value, index)),
    }
    return c.json(teamTemplateRepo.replaceCanonicalDefinition(db, c.req.param('id'), input))
  } catch (error) {
    return canonicalError(c, error)
  }
})

teamTemplatesRouter.post('/:id/clone', async (c) => {
  const raw = await jsonObject(c)
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const expectedRevision = positiveInteger(raw.templateExpectedRevision)
  const id = stringValue(raw.id)
  if (!expectedRevision || !id) {
    return c.json({ error: 'templateExpectedRevision and id are required' }, 400)
  }
  try {
    validateSlug(id)
    const { db } = getCtx()
    if (teamTemplateRepo.get(db, id)) {
      return c.json({ error: `team template already exists: ${id}` }, 409)
    }
    return c.json(
      teamTemplateRepo.cloneCanonical(db, c.req.param('id'), {
        expectedRevision,
        id,
        name: stringValue(raw.name) || undefined,
      }),
      201,
    )
  } catch (error) {
    return canonicalError(c, error)
  }
})

teamTemplatesRouter.post('/:id/spawn', async (c) => {
  const raw = await jsonObject(c)
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const templateExpectedRevision = positiveInteger(raw.templateExpectedRevision)
  const teamId = stringValue(raw.teamId)
  const teamExpectedRevision = positiveInteger(raw.teamExpectedRevision) ?? undefined
  const mode = raw.mode === 'append' ? 'append' : raw.mode === 'initialize' ? 'initialize' : null
  if (!templateExpectedRevision || !teamId || !mode) {
    return c.json({ error: 'templateExpectedRevision, teamId, and mode are required' }, 400)
  }
  try {
    return c.json(
      await spawnTeamTemplate(getCtx().db, getCtx().paths, {
        templateId: c.req.param('id'),
        templateExpectedRevision,
        teamId,
        teamExpectedRevision,
        mode,
        userMd: typeof raw.userMd === 'string' ? raw.userMd : undefined,
      }),
      201,
    )
  } catch (error) {
    return canonicalError(c, error instanceof SpawnTeamTemplateError ? error.cause : error)
  }
})

teamTemplatesRouter.post('/:id/spawn/preview', async (c) => {
  const raw = await jsonObject(c)
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const templateExpectedRevision = positiveInteger(raw.templateExpectedRevision)
  const teamId = stringValue(raw.teamId)
  const teamExpectedRevision = positiveInteger(raw.teamExpectedRevision) ?? undefined
  const mode = raw.mode === 'append' ? 'append' : raw.mode === 'initialize' ? 'initialize' : null
  if (!templateExpectedRevision || !teamId || !mode) {
    return c.json({ error: 'templateExpectedRevision, teamId, and mode are required' }, 400)
  }
  try {
    return c.json(
      previewTeamTemplateSpawn(getCtx().db, getCtx().paths, {
        templateId: c.req.param('id'),
        templateExpectedRevision,
        teamId,
        teamExpectedRevision,
        mode,
        userMd: typeof raw.userMd === 'string' ? raw.userMd : undefined,
      }),
    )
  } catch (error) {
    return canonicalError(c, error)
  }
})

teamTemplatesRouter.delete('/:id', (c) => {
  const expectedRevision = positiveInteger(c.req.query('expectedRevision'))
  if (!expectedRevision) return c.json({ error: 'expectedRevision is required' }, 400)
  try {
    teamTemplateRepo.removeCanonical(getCtx().db, c.req.param('id'), expectedRevision)
    return c.body(null, 204)
  } catch (error) {
    return canonicalError(c, error)
  }
})

async function jsonObject(c: Context): Promise<Record<string, unknown> | null> {
  const value = (await c.req.json().catch(() => null)) as unknown
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseSlot(value: unknown, index: number): CanonicalSlotInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid_template_definition: slot ${index} must be an object`)
  }
  const slot = value as Record<string, unknown>
  const profileId = stringValue(slot.profileId)
  const agentName = stringValue(slot.agentName)
  if (!profileId || !agentName) {
    throw new Error(`invalid_template_definition: slot ${index} requires profileId and agentName`)
  }
  const reasoning = slot.reasoningLevel
  if (
    reasoning !== undefined &&
    reasoning !== null &&
    (typeof reasoning !== 'string' || !REASONING_LEVELS.includes(reasoning as ReasoningLevel))
  ) {
    throw new Error(`invalid_template_definition: slot ${index} reasoningLevel is invalid`)
  }
  const result: CanonicalSlotInput = {
    profileId,
    agentName,
    modelOverride: typeof slot.modelOverride === 'string' ? slot.modelOverride : null,
    reasoningLevel: (reasoning as ReasoningLevel | null | undefined) ?? null,
  }
  if (Object.hasOwn(slot, 'layoutPosition')) {
    if (slot.layoutPosition === null) result.layoutPosition = null
    else if (
      slot.layoutPosition &&
      typeof slot.layoutPosition === 'object' &&
      !Array.isArray(slot.layoutPosition) &&
      typeof (slot.layoutPosition as Record<string, unknown>).x === 'number' &&
      Number.isFinite((slot.layoutPosition as Record<string, unknown>).x) &&
      typeof (slot.layoutPosition as Record<string, unknown>).y === 'number' &&
      Number.isFinite((slot.layoutPosition as Record<string, unknown>).y)
    ) {
      result.layoutPosition = {
        x: (slot.layoutPosition as { x: number }).x,
        y: (slot.layoutPosition as { y: number }).y,
      }
    } else {
      throw new Error(`invalid_template_definition: slot ${index} layoutPosition is invalid`)
    }
  }
  if (Object.hasOwn(slot, 'display')) {
    if (slot.display === null) result.display = null
    else if (slot.display && typeof slot.display === 'object' && !Array.isArray(slot.display)) {
      result.display = slot.display as Record<string, unknown>
    } else {
      throw new Error(`invalid_template_definition: slot ${index} display is invalid`)
    }
  }
  const slotId = stringValue(slot.slotId)
  if (slotId) result.slotId = slotId
  const clientKey = stringValue(slot.clientKey)
  if (clientKey) result.clientKey = clientKey
  return result
}

function parseEdge(value: unknown, index: number): CanonicalEdgeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid_template_definition: edge ${index} must be an object`)
  }
  const edge = value as Record<string, unknown>
  return {
    sourceKind: edge.sourceKind as CanonicalEdgeInput['sourceKind'],
    sourceId: stringValue(edge.sourceId) || null,
    targetKind: edge.targetKind as CanonicalEdgeInput['targetKind'],
    targetId: stringValue(edge.targetId) || null,
    posture: edge.posture === 'approval_required' ? 'approval_required' : 'allow',
  }
}

function canonicalError(c: Context, error: unknown): Response {
  const message = (error as Error).message
  if (message.startsWith('team template not found')) return c.json({ error: message }, 404)
  if (message.startsWith('template_deleted')) {
    return c.json({ error: message, code: 'template_deleted' }, 410)
  }
  if (message.startsWith('template_revision_conflict')) {
    const currentRevision = Number.parseInt(message.match(/current (\d+)/)?.[1] ?? '', 10)
    return c.json({ error: message, code: 'template_revision_conflict', currentRevision }, 409)
  }
  if (message.startsWith('team_revision_conflict')) {
    const currentRevision = Number.parseInt(message.match(/current (\d+)/)?.[1] ?? '', 10)
    return c.json({ error: message, code: 'team_revision_conflict', currentRevision }, 409)
  }
  if (
    message.startsWith('team_revision_required') ||
    message.startsWith('initialize_required') ||
    message.startsWith('baseline_replacement_required') ||
    message.startsWith('team_not_empty')
  ) {
    return c.json({ error: message, code: message.split(':')[0] }, 409)
  }
  if (message.startsWith('invalid_template_definition') || message.includes('constraint')) {
    return c.json({ error: message, code: 'invalid_template_definition' }, 400)
  }
  return c.json({ error: message }, 400)
}
