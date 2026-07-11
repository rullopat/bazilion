import type { ReasoningLevel } from '@bazilion/api-types'
import { REASONING_LEVELS } from '@bazilion/api-types'
import { type Context, Hono } from 'hono'
import {
  harnessTemplateRepo,
  profileRepo,
  SpawnHarnessTemplateError,
  spawnHarnessTemplate,
} from '../core/index.ts'
import { validateSlug } from '../core/profile/validate.ts'
import type {
  CanonicalDefinitionInput,
  CanonicalEdgeInput,
  CanonicalSlotInput,
} from '../core/repos/harnessTemplates.ts'
import { getCtx } from '../lib/ctx.ts'

export const harnessTemplatesRouter = new Hono()

harnessTemplatesRouter.get('/', (c) => {
  const { db } = getCtx()
  return c.json(
    harnessTemplateRepo.list(db).map((template) => ({
      ...template,
      slotCount: harnessTemplateRepo.slots(db, template.id).length,
    })),
  )
})

harnessTemplatesRouter.get('/:id', (c) => {
  const { db } = getCtx()
  const detail = harnessTemplateRepo.detail(db, c.req.param('id'))
  if (!detail) return c.json({ error: 'team template not found' }, 404)
  c.header('ETag', `"${detail.template.currentRevision}"`)
  return c.json(detail)
})

harnessTemplatesRouter.post('/', async (c) => {
  const raw = await jsonObject(c)
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const id = stringValue(raw.id)
  const name = stringValue(raw.name)
  if (!id || !name) return c.json({ error: 'id and name are required' }, 400)
  try {
    validateSlug(id)
    const { db } = getCtx()
    if (harnessTemplateRepo.get(db, id)) {
      return c.json({ error: `team template already exists: ${id}` }, 409)
    }
    return c.json(
      harnessTemplateRepo.insertCanonical(db, {
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

harnessTemplatesRouter.patch('/:id', async (c) => {
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
    return c.json(
      harnessTemplateRepo.updateCanonicalMetadata(getCtx().db, c.req.param('id'), input),
    )
  } catch (error) {
    return canonicalError(c, error)
  }
})

harnessTemplatesRouter.put('/:id/definition', async (c) => {
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
    return c.json(harnessTemplateRepo.replaceCanonicalDefinition(db, c.req.param('id'), input))
  } catch (error) {
    return canonicalError(c, error)
  }
})

harnessTemplatesRouter.post('/:id/clone', async (c) => {
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
    if (harnessTemplateRepo.get(db, id)) {
      return c.json({ error: `team template already exists: ${id}` }, 409)
    }
    return c.json(
      harnessTemplateRepo.cloneCanonical(db, c.req.param('id'), {
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

harnessTemplatesRouter.post('/:id/spawn', async (c) => {
  const raw = await jsonObject(c)
  if (!raw) return c.json({ error: 'invalid JSON body' }, 400)
  const templateExpectedRevision = positiveInteger(raw.templateExpectedRevision)
  const groupId = stringValue(raw.groupId)
  const groupExpectedRevision = positiveInteger(raw.groupExpectedRevision) ?? undefined
  const mode = raw.mode === 'append' ? 'append' : raw.mode === 'initialize' ? 'initialize' : null
  if (!templateExpectedRevision || !groupId || !mode) {
    return c.json({ error: 'templateExpectedRevision, groupId, and mode are required' }, 400)
  }
  try {
    return c.json(
      await spawnHarnessTemplate(getCtx().db, getCtx().paths, {
        templateId: c.req.param('id'),
        templateExpectedRevision,
        groupId,
        groupExpectedRevision,
        mode,
        userMd: typeof raw.userMd === 'string' ? raw.userMd : undefined,
      }),
      201,
    )
  } catch (error) {
    return canonicalError(c, error instanceof SpawnHarnessTemplateError ? error.cause : error)
  }
})

harnessTemplatesRouter.delete('/:id', (c) => {
  const expectedRevision = positiveInteger(c.req.query('expectedRevision'))
  if (!expectedRevision) return c.json({ error: 'expectedRevision is required' }, 400)
  try {
    harnessTemplateRepo.removeCanonical(getCtx().db, c.req.param('id'), expectedRevision)
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
  if (message.startsWith('group_revision_conflict')) {
    const currentRevision = Number.parseInt(message.match(/current (\d+)/)?.[1] ?? '', 10)
    return c.json({ error: message, code: 'group_revision_conflict', currentRevision }, 409)
  }
  if (
    message.startsWith('group_revision_required') ||
    message.startsWith('initialize_required') ||
    message.startsWith('baseline_replacement_required') ||
    message.startsWith('group_not_empty')
  ) {
    return c.json({ error: message, code: message.split(':')[0] }, 409)
  }
  if (message.startsWith('invalid_template_definition') || message.includes('constraint')) {
    return c.json({ error: message, code: 'invalid_template_definition' }, 400)
  }
  return c.json({ error: message }, 400)
}
