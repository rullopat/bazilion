import { randomUUID } from 'node:crypto'
import type {
  ReasoningLevel,
  TeamTemplate,
  TeamTemplateDetail,
  TeamTemplateEdge,
  TeamTemplateRevision,
  TeamTemplateSlot,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawTemplate {
  id: string
  name: string
  user_md: string | null
  current_revision: number
  deleted_at: number | null
  created_at: number
  updated_at: number
}

interface RawSlot {
  template_id: string
  slot_id: string
  position: number
  profile_id: string
  agent_name: string
  model_override: string | null
  reasoning_level: ReasoningLevel | null
  position_x: number | null
  position_y: number | null
  display_json: string | null
  tombstoned_at: number | null
}

interface RawEdge {
  template_id: string
  source_kind: TeamTemplateEdge['sourceKind']
  source_id: string
  target_kind: TeamTemplateEdge['targetKind']
  target_id: string
  posture: TeamTemplateEdge['posture']
}

export interface CanonicalSlotInput {
  slotId?: string
  /** Request-local reference for a new server-allocated slot. Never persisted. */
  clientKey?: string
  profileId: string
  agentName: string
  modelOverride?: string | null
  reasoningLevel?: ReasoningLevel | null
  layoutPosition?: { x: number; y: number } | null
  display?: Record<string, unknown> | null
}

export interface CanonicalEdgeInput {
  sourceKind: TeamTemplateEdge['sourceKind']
  sourceId?: string | null
  targetKind: TeamTemplateEdge['targetKind']
  targetId?: string | null
  posture?: TeamTemplateEdge['posture']
}

export interface CanonicalDefinitionInput {
  expectedRevision: number
  slots: CanonicalSlotInput[]
  edges: CanonicalEdgeInput[]
  /** Daemon-only workflows may pass UUIDs they just allocated. HTTP callers never set this. */
  allowAllocatedSlotIds?: boolean
}

function toTemplate(row: RawTemplate): TeamTemplate {
  return {
    id: row.id,
    name: row.name,
    userMd: row.user_md,
    currentRevision: row.current_revision,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toSlot(row: RawSlot): TeamTemplateSlot {
  return {
    templateId: row.template_id,
    slotId: row.slot_id,
    position: row.position,
    profileId: row.profile_id,
    agentName: row.agent_name,
    modelOverride: row.model_override,
    reasoningLevel: row.reasoning_level,
    layoutPosition:
      row.position_x === null || row.position_y === null
        ? null
        : { x: row.position_x, y: row.position_y },
    display: row.display_json ? (JSON.parse(row.display_json) as Record<string, unknown>) : null,
    tombstonedAt: row.tombstoned_at,
  }
}

function toEdge(row: RawEdge): TeamTemplateEdge {
  return {
    templateId: row.template_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id || null,
    targetKind: row.target_kind,
    targetId: row.target_id || null,
    posture: row.posture,
  }
}

export function get(db: BazilionDb, id: string): TeamTemplate | null {
  const row = db.raw
    .query<RawTemplate, [string]>('SELECT * FROM team_templates WHERE id = ?')
    .get(id)
  return row ? toTemplate(row) : null
}

export function list(db: BazilionDb): TeamTemplate[] {
  return db.raw
    .query<RawTemplate, []>('SELECT * FROM team_templates ORDER BY created_at ASC')
    .all()
    .map(toTemplate)
}

export function detail(db: BazilionDb, id: string): TeamTemplateDetail | null {
  const template = get(db, id)
  if (!template) return null
  const currentSnapshot = revision(db, id, template.currentRevision)
  if (!currentSnapshot)
    throw new Error(`template_snapshot_missing: ${id}@${template.currentRevision}`)
  return { template, slots: slots(db, id), edges: edges(db, id), currentSnapshot }
}

export function insertCanonical(
  db: BazilionDb,
  input: { id: string; name: string; userMd?: string | null },
): TeamTemplateDetail {
  const now = Date.now()
  db.raw.transaction(() => {
    db.raw.run(
      `INSERT INTO team_templates
         (id, name, user_md, current_revision, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
      [input.id, input.name, input.userMd ?? null, now, now],
    )
    snapshotCurrent(db, input.id, 1, now)
  })()
  return requireDetail(db, input.id)
}

export function insertCanonicalDefinition(
  db: BazilionDb,
  input: {
    id: string
    name: string
    userMd?: string | null
    slots: CanonicalSlotInput[]
    edges: CanonicalEdgeInput[]
  },
): TeamTemplateDetail {
  return db.raw.transaction(() => {
    validateCanonicalDefinition(input.slots, input.edges)
    if (input.slots.some((slot) => !slot.slotId)) {
      throw new Error('invalid_template_definition: initial slots require allocated ids')
    }
    const now = Date.now()
    db.raw.run(
      `INSERT INTO team_templates
         (id, name, user_md, current_revision, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
      [input.id, input.name, input.userMd ?? null, now, now],
    )
    for (let position = 0; position < input.slots.length; position++) {
      const slot = input.slots[position]
      if (!slot?.slotId) continue
      db.raw.run(
        `INSERT INTO team_template_slots
           (template_id, slot_id, position, profile_id, agent_name, model_override,
            reasoning_level, position_x, position_y, display_json, tombstoned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          input.id,
          slot.slotId,
          position,
          slot.profileId,
          slot.agentName,
          slot.modelOverride ?? null,
          slot.reasoningLevel ?? null,
          slot.layoutPosition?.x ?? null,
          slot.layoutPosition?.y ?? null,
          slot.display ? JSON.stringify(slot.display) : null,
        ],
      )
    }
    for (const edge of input.edges) insertTemplateEdge(db, input.id, edge)
    snapshotCurrent(db, input.id, 1, now)
    return requireDetail(db, input.id)
  })()
}

export function updateCanonicalMetadata(
  db: BazilionDb,
  id: string,
  input: { expectedRevision: number; name?: string; userMd?: string | null },
): TeamTemplateDetail {
  return db.raw.transaction(() => {
    const template = requireMutable(db, id)
    requireRevision(template, input.expectedRevision)
    const name = input.name ?? template.name
    const userMd = Object.hasOwn(input, 'userMd') ? (input.userMd ?? null) : template.userMd
    if (name === template.name && userMd === template.userMd) return requireDetail(db, id)
    const now = Date.now()
    const next = template.currentRevision + 1
    db.raw.run(
      `UPDATE team_templates SET name = ?, user_md = ?, current_revision = ?, updated_at = ?
       WHERE id = ?`,
      [name, userMd, next, now, id],
    )
    snapshotCurrent(db, id, next, now)
    return requireDetail(db, id)
  })()
}

export function replaceCanonicalDefinition(
  db: BazilionDb,
  templateId: string,
  input: CanonicalDefinitionInput,
): TeamTemplateDetail {
  return db.raw.transaction(() => {
    const template = requireMutable(db, templateId)
    requireRevision(template, input.expectedRevision)
    const current = slots(db, templateId, { includeTombstoned: true })
    const currentById = new Map(current.map((slot) => [slot.slotId, slot]))
    const activeIds = new Set<string>()
    const resolvedRefs = new Map<string, string>()
    for (const value of input.slots) {
      if (value.slotId && !currentById.has(value.slotId) && !input.allowAllocatedSlotIds) {
        throw new Error(
          `invalid_template_definition: caller cannot allocate slot id ${value.slotId}`,
        )
      }
      if (value.slotId && value.clientKey) {
        throw new Error('invalid_template_definition: slotId and clientKey are mutually exclusive')
      }
      const reference = value.slotId ?? value.clientKey
      if (!reference) continue
      if (resolvedRefs.has(reference)) {
        throw new Error(`invalid_template_definition: duplicate slot reference ${reference}`)
      }
      resolvedRefs.set(reference, value.slotId ?? randomUUID())
    }
    const resolvedEdges = input.edges.map((edge) => ({
      ...edge,
      sourceId:
        edge.sourceKind === 'slot'
          ? (resolvedRefs.get(edge.sourceId ?? '') ?? edge.sourceId)
          : null,
      targetId:
        edge.targetKind === 'slot'
          ? (resolvedRefs.get(edge.targetId ?? '') ?? edge.targetId)
          : null,
    }))
    const resolvedSlots = input.slots.map((slot) => ({
      ...slot,
      slotId: slot.slotId ?? (slot.clientKey ? resolvedRefs.get(slot.clientKey) : randomUUID()),
    }))
    validateCanonicalDefinition(resolvedSlots, resolvedEdges)
    const now = Date.now()
    // Free the partial unique position index before applying an arbitrary reorder.
    db.raw.run(
      `UPDATE team_template_slots SET position = position + 1000000
       WHERE template_id = ? AND tombstoned_at IS NULL`,
      [templateId],
    )
    for (let position = 0; position < resolvedSlots.length; position++) {
      const value = resolvedSlots[position]
      if (!value) continue
      const slotId = value.slotId ?? randomUUID()
      if (activeIds.has(slotId))
        throw new Error(`invalid_template_definition: duplicate slot ${slotId}`)
      activeIds.add(slotId)
      const existing = currentById.get(slotId)
      if (existing?.tombstonedAt !== null && existing) {
        throw new Error(
          `invalid_template_definition: tombstoned slot cannot be re-added: ${slotId}`,
        )
      }
      const coordinates = value.layoutPosition ?? null
      const params = [
        position,
        value.profileId,
        value.agentName,
        value.modelOverride ?? null,
        value.reasoningLevel ?? null,
        coordinates?.x ?? null,
        coordinates?.y ?? null,
        value.display ? JSON.stringify(value.display) : null,
      ]
      if (existing) {
        db.raw.run(
          `UPDATE team_template_slots SET position = ?, profile_id = ?, agent_name = ?,
             model_override = ?, reasoning_level = ?, position_x = ?, position_y = ?, display_json = ?
           WHERE template_id = ? AND slot_id = ?`,
          [...params, templateId, slotId],
        )
      } else {
        db.raw.run(
          `INSERT INTO team_template_slots
             (template_id, slot_id, position, profile_id, agent_name, model_override,
              reasoning_level, position_x, position_y, display_json, tombstoned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [templateId, slotId, ...params],
        )
      }
    }
    for (const old of current) {
      if (old.tombstonedAt === null && !activeIds.has(old.slotId)) {
        db.raw.run(
          'UPDATE team_template_slots SET tombstoned_at = ? WHERE template_id = ? AND slot_id = ?',
          [now, templateId, old.slotId],
        )
      }
    }
    db.raw.run('DELETE FROM team_template_edges WHERE template_id = ?', [templateId])
    for (const edge of resolvedEdges) insertTemplateEdge(db, templateId, edge)
    const next = template.currentRevision + 1
    db.raw.run(`UPDATE team_templates SET current_revision = ?, updated_at = ? WHERE id = ?`, [
      next,
      now,
      templateId,
    ])
    snapshotCurrent(db, templateId, next, now)
    return requireDetail(db, templateId)
  })()
}

export function cloneCanonical(
  db: BazilionDb,
  sourceId: string,
  input: { expectedRevision: number; id: string; name?: string },
): TeamTemplateDetail {
  return db.raw.transaction(() => {
    const source = requireMutable(db, sourceId)
    requireRevision(source, input.expectedRevision)
    const snapshot = revision(db, sourceId, input.expectedRevision)
    if (!snapshot)
      throw new Error(`template_snapshot_missing: ${sourceId}@${input.expectedRevision}`)
    const translated = new Map(snapshot.slots.map((slot) => [slot.slotId, randomUUID()]))
    return insertCanonicalDefinition(db, {
      id: input.id,
      name: input.name ?? `${source.name} copy`,
      userMd: snapshot.userMd,
      slots: snapshot.slots.map((slot) => ({
        slotId: translated.get(slot.slotId),
        profileId: slot.profileId,
        agentName: slot.agentName,
        modelOverride: slot.modelOverride,
        reasoningLevel: slot.reasoningLevel,
        layoutPosition: slot.layoutPosition,
        display: slot.display,
      })),
      edges: snapshot.edges.map((edge) => ({
        sourceKind: edge.sourceKind,
        sourceId: edge.sourceKind === 'slot' ? translated.get(edge.sourceId ?? '') : null,
        targetKind: edge.targetKind,
        targetId: edge.targetKind === 'slot' ? translated.get(edge.targetId ?? '') : null,
      })),
    })
  })()
}

export function removeCanonical(
  db: BazilionDb,
  id: string,
  expectedRevision: number,
): 'deleted' | 'tombstoned' {
  return db.raw.transaction(() => {
    const template = requireMutable(db, id)
    requireRevision(template, expectedRevision)
    const lineage = db.raw
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM template_instantiations WHERE template_id = ?',
      )
      .get(id)?.count
    if ((lineage ?? 0) > 0) {
      const now = Date.now()
      db.raw.run('UPDATE team_templates SET deleted_at = ?, updated_at = ? WHERE id = ?', [
        now,
        now,
        id,
      ])
      return 'tombstoned'
    }
    db.raw.run('DELETE FROM team_templates WHERE id = ?', [id])
    return 'deleted'
  })()
}

export function slots(
  db: BazilionDb,
  templateId: string,
  options: { includeTombstoned?: boolean } = {},
): TeamTemplateSlot[] {
  const where = options.includeTombstoned ? '' : 'AND tombstoned_at IS NULL'
  return db.raw
    .query<RawSlot, [string]>(
      `SELECT * FROM team_template_slots
       WHERE template_id = ? ${where}
       ORDER BY position ASC, slot_id ASC`,
    )
    .all(templateId)
    .map(toSlot)
}

export function edges(db: BazilionDb, templateId: string): TeamTemplateEdge[] {
  return db.raw
    .query<RawEdge, [string]>(
      `SELECT * FROM team_template_edges WHERE template_id = ?
       ORDER BY source_kind, source_id, target_kind, target_id`,
    )
    .all(templateId)
    .map(toEdge)
}

export function revision(
  db: BazilionDb,
  templateId: string,
  revisionNumber: number,
): TeamTemplateRevision | null {
  const header = db.raw
    .query<{ name: string; user_md: string | null; created_at: number }, [string, number]>(
      `SELECT name, user_md, created_at FROM team_template_revisions
       WHERE template_id = ? AND revision = ?`,
    )
    .get(templateId, revisionNumber)
  if (!header) return null
  const revisionSlots = db.raw
    .query<RawSlot, [string, number]>(
      `SELECT template_id, slot_id, position, profile_id, agent_name, model_override,
              reasoning_level, position_x, position_y, display_json, NULL AS tombstoned_at
       FROM team_template_revision_slots
       WHERE template_id = ? AND revision = ? ORDER BY position ASC`,
    )
    .all(templateId, revisionNumber)
    .map(toSlot)
  const revisionEdges = db.raw
    .query<RawEdge, [string, number]>(
      `SELECT template_id, source_kind, source_id, target_kind, target_id, posture
       FROM team_template_revision_edges
       WHERE template_id = ? AND revision = ?
       ORDER BY source_kind, source_id, target_kind, target_id`,
    )
    .all(templateId, revisionNumber)
    .map(toEdge)
  return {
    templateId,
    revision: revisionNumber,
    name: header.name,
    userMd: header.user_md,
    slots: revisionSlots,
    edges: revisionEdges,
    createdAt: header.created_at,
  }
}

function snapshotCurrent(
  db: BazilionDb,
  templateId: string,
  revisionNumber: number,
  now: number,
): void {
  const template = get(db, templateId)
  if (!template) throw new Error(`team template not found: ${templateId}`)
  db.raw.run(
    `INSERT INTO team_template_revisions (template_id, revision, name, user_md, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [templateId, revisionNumber, template.name, template.userMd, now],
  )
  db.raw.run(
    `INSERT INTO team_template_revision_slots
     SELECT template_id, ?, slot_id, position, profile_id, agent_name, model_override,
            reasoning_level, position_x, position_y, display_json
     FROM team_template_slots WHERE template_id = ? AND tombstoned_at IS NULL`,
    [revisionNumber, templateId],
  )
  db.raw.run(
    `INSERT INTO team_template_revision_edges
     SELECT template_id, ?, source_kind, source_id, target_kind, target_id, posture
     FROM team_template_edges WHERE template_id = ?`,
    [revisionNumber, templateId],
  )
}

export function pruneRevision(db: BazilionDb, templateId: string, revisionNumber: number): void {
  const template = get(db, templateId)
  if (!template) throw new Error(`team template not found: ${templateId}`)
  if (template.currentRevision === revisionNumber) {
    throw new Error(`template_revision_in_use: revision ${revisionNumber} is current`)
  }
  const retained = db.raw
    .query<{ count: number }, [string, number]>(
      `SELECT COUNT(*) AS count FROM template_instantiations
       WHERE template_id = ? AND template_revision = ?`,
    )
    .get(templateId, revisionNumber)?.count
  if ((retained ?? 0) > 0) {
    throw new Error(`template_revision_in_use: revision ${revisionNumber} has live lineage`)
  }
  db.raw.run('DELETE FROM team_template_revisions WHERE template_id = ? AND revision = ?', [
    templateId,
    revisionNumber,
  ])
}

export function findReferencingProfile(
  db: BazilionDb,
  profileId: string,
): Array<{ id: string; name: string }> {
  return db.raw
    .query<{ id: string; name: string }, [string, string]>(
      `SELECT DISTINCT t.id, t.name FROM team_templates t
       WHERE EXISTS (
         SELECT 1 FROM team_template_slots s
         WHERE s.template_id = t.id AND s.profile_id = ?
       ) OR EXISTS (
         SELECT 1 FROM team_template_revision_slots s
         WHERE s.template_id = t.id AND s.profile_id = ?
       )`,
    )
    .all(profileId, profileId)
}

function requireDetail(db: BazilionDb, id: string): TeamTemplateDetail {
  const found = detail(db, id)
  if (!found) throw new Error(`team template not found: ${id}`)
  return found
}

function requireMutable(db: BazilionDb, id: string): TeamTemplate {
  const template = get(db, id)
  if (!template) throw new Error(`team template not found: ${id}`)
  if (template.deletedAt !== null) throw new Error(`template_deleted: ${id}`)
  return template
}

function requireRevision(template: TeamTemplate, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1 || expected !== template.currentRevision) {
    throw new Error(
      `template_revision_conflict: expected ${expected}, current ${template.currentRevision}`,
    )
  }
}

function validateCanonicalDefinition(
  definitionSlots: CanonicalSlotInput[],
  definitionEdges: CanonicalEdgeInput[],
): void {
  if (!Array.isArray(definitionSlots) || !Array.isArray(definitionEdges)) {
    throw new Error('invalid_template_definition: slots and edges arrays are required')
  }
  const ids = new Set(definitionSlots.map((slot) => slot.slotId).filter(Boolean) as string[])
  if (ids.size !== definitionSlots.filter((slot) => slot.slotId).length) {
    throw new Error('invalid_template_definition: duplicate slot id')
  }
  const edgeKeys = new Set<string>()
  for (const edge of definitionEdges) {
    if (
      edge.posture !== undefined &&
      edge.posture !== 'allow' &&
      edge.posture !== 'approval_required'
    ) {
      throw new Error(`invalid_template_definition: invalid edge posture ${edge.posture}`)
    }
    for (const endpoint of [
      [edge.sourceKind, edge.sourceId],
      [edge.targetKind, edge.targetId],
    ] as const) {
      const [kind, id] = endpoint
      if (!['user', 'outside_team', 'slot'].includes(kind)) {
        throw new Error(`invalid_template_definition: invalid endpoint kind ${kind}`)
      }
      if ((kind === 'slot') !== (typeof id === 'string' && id.length > 0)) {
        throw new Error('invalid_template_definition: slot endpoints require an id')
      }
      if (kind === 'slot' && !ids.has(id ?? '')) {
        throw new Error(`invalid_template_definition: unknown slot endpoint ${id}`)
      }
    }
    if (edge.sourceKind !== 'slot' && edge.targetKind !== 'slot') {
      throw new Error('invalid_template_definition: boundary-to-boundary edge')
    }
    if (edge.sourceKind === edge.targetKind && edge.sourceId === edge.targetId) {
      throw new Error('invalid_template_definition: self edge')
    }
    const key = `${edge.sourceKind}:${edge.sourceId ?? ''}>${edge.targetKind}:${edge.targetId ?? ''}`
    if (edgeKeys.has(key)) throw new Error(`invalid_template_definition: duplicate edge ${key}`)
    edgeKeys.add(key)
  }
}

function insertTemplateEdge(db: BazilionDb, templateId: string, edge: CanonicalEdgeInput): void {
  db.raw.run(
    `INSERT INTO team_template_edges
       (template_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      templateId,
      edge.sourceKind,
      edge.sourceId ?? '',
      edge.targetKind,
      edge.targetId ?? '',
      edge.posture ?? 'allow',
    ],
  )
}
