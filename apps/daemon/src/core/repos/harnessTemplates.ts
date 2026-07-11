import { randomUUID } from 'node:crypto'
import type {
  HarnessTemplate,
  HarnessTemplateEdge,
  HarnessTemplateRevision,
  HarnessTemplateSlot,
  ReasoningLevel,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawTemplate {
  id: string
  name: string
  user_md: string | null
  current_revision: number
  compatibility_managed: number
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
  source_kind: HarnessTemplateEdge['sourceKind']
  source_id: string
  target_kind: HarnessTemplateEdge['targetKind']
  target_id: string
}

export interface CompatibilityMemberInput {
  profileId: string
  agentName: string
  modelOverride: string | null
  reasoningLevel: ReasoningLevel | null
}

function toTemplate(row: RawTemplate): HarnessTemplate {
  return {
    id: row.id,
    name: row.name,
    userMd: row.user_md,
    currentRevision: row.current_revision,
    compatibilityManaged: row.compatibility_managed === 1,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toSlot(row: RawSlot): HarnessTemplateSlot {
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

function toEdge(row: RawEdge): HarnessTemplateEdge {
  return {
    templateId: row.template_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id || null,
    targetKind: row.target_kind,
    targetId: row.target_id || null,
  }
}

export function get(db: BazilionDb, id: string): HarnessTemplate | null {
  const row = db.raw
    .query<RawTemplate, [string]>('SELECT * FROM harness_templates WHERE id = ?')
    .get(id)
  return row ? toTemplate(row) : null
}

export function list(db: BazilionDb): HarnessTemplate[] {
  return db.raw
    .query<RawTemplate, []>('SELECT * FROM harness_templates ORDER BY created_at ASC')
    .all()
    .map(toTemplate)
}

export function slots(
  db: BazilionDb,
  templateId: string,
  options: { includeTombstoned?: boolean } = {},
): HarnessTemplateSlot[] {
  const where = options.includeTombstoned ? '' : 'AND tombstoned_at IS NULL'
  return db.raw
    .query<RawSlot, [string]>(
      `SELECT * FROM harness_template_slots
       WHERE template_id = ? ${where}
       ORDER BY position ASC, slot_id ASC`,
    )
    .all(templateId)
    .map(toSlot)
}

export function edges(db: BazilionDb, templateId: string): HarnessTemplateEdge[] {
  return db.raw
    .query<RawEdge, [string]>(
      `SELECT * FROM harness_template_edges WHERE template_id = ?
       ORDER BY source_kind, source_id, target_kind, target_id`,
    )
    .all(templateId)
    .map(toEdge)
}

export function revision(
  db: BazilionDb,
  templateId: string,
  revisionNumber: number,
): HarnessTemplateRevision | null {
  const header = db.raw
    .query<{ name: string; user_md: string | null; created_at: number }, [string, number]>(
      `SELECT name, user_md, created_at FROM harness_template_revisions
       WHERE template_id = ? AND revision = ?`,
    )
    .get(templateId, revisionNumber)
  if (!header) return null
  const revisionSlots = db.raw
    .query<RawSlot, [string, number]>(
      `SELECT template_id, slot_id, position, profile_id, agent_name, model_override,
              reasoning_level, position_x, position_y, display_json, NULL AS tombstoned_at
       FROM harness_template_revision_slots
       WHERE template_id = ? AND revision = ? ORDER BY position ASC`,
    )
    .all(templateId, revisionNumber)
    .map(toSlot)
  const revisionEdges = db.raw
    .query<RawEdge, [string, number]>(
      `SELECT template_id, source_kind, source_id, target_kind, target_id
       FROM harness_template_revision_edges
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

export function insertCompatibility(
  db: BazilionDb,
  input: { id: string; name: string; userMd: string | null },
): HarnessTemplate {
  const now = Date.now()
  db.raw.run(
    `INSERT INTO harness_templates
       (id, name, user_md, current_revision, compatibility_managed, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, 1, 1, NULL, ?, ?)`,
    [input.id, input.name, input.userMd, now, now],
  )
  db.raw.run(
    `INSERT INTO harness_template_revisions (template_id, revision, name, user_md, created_at)
     VALUES (?, 1, ?, ?, ?)`,
    [input.id, input.name, input.userMd, now],
  )
  const created = get(db, input.id)
  if (!created) throw new Error(`team template vanished after insert: ${input.id}`)
  return created
}

export function updateCompatibilityMetadata(
  db: BazilionDb,
  id: string,
  patch: { name?: string; userMd?: string | null },
): void {
  db.raw.transaction(() => {
    const template = requireCompatible(db, id)
    const sets: string[] = []
    const params: unknown[] = []
    if (Object.hasOwn(patch, 'name')) {
      sets.push('name = ?')
      params.push(patch.name)
    }
    if (Object.hasOwn(patch, 'userMd')) {
      sets.push('user_md = ?')
      params.push(patch.userMd ?? null)
    }
    if (sets.length === 0) return
    const now = Date.now()
    sets.push('updated_at = ?')
    params.push(now, template.id)
    db.raw.run(`UPDATE harness_templates SET ${sets.join(', ')} WHERE id = ?`, params)
    const nextRevision = template.currentRevision + 1
    snapshotCurrent(db, template.id, nextRevision, now)
    db.raw.run('UPDATE harness_templates SET current_revision = ? WHERE id = ?', [
      nextRevision,
      template.id,
    ])
  })()
}

export function replaceCompatibilityMembers(
  db: BazilionDb,
  templateId: string,
  members: CompatibilityMemberInput[],
): number {
  return db.raw.transaction(() => {
    const template = requireCompatible(db, templateId)
    const old = slots(db, templateId)
    const now = Date.now()

    for (let position = 0; position < members.length; position++) {
      const member = members[position]
      if (!member) continue
      const existing = old[position]
      if (existing) {
        db.raw.run(
          `UPDATE harness_template_slots SET position = ?, profile_id = ?, agent_name = ?,
             model_override = ?, reasoning_level = ?
           WHERE template_id = ? AND slot_id = ?`,
          [
            position,
            member.profileId,
            member.agentName,
            member.modelOverride,
            member.reasoningLevel,
            templateId,
            existing.slotId,
          ],
        )
      } else {
        db.raw.run(
          `INSERT INTO harness_template_slots
             (template_id, slot_id, position, profile_id, agent_name, model_override,
              reasoning_level, position_x, position_y, display_json, tombstoned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
          [
            templateId,
            randomUUID(),
            position,
            member.profileId,
            member.agentName,
            member.modelOverride,
            member.reasoningLevel,
          ],
        )
      }
    }
    for (let position = members.length; position < old.length; position++) {
      const removed = old[position]
      if (removed) {
        db.raw.run(
          `UPDATE harness_template_slots SET tombstoned_at = ?
           WHERE template_id = ? AND slot_id = ?`,
          [now, templateId, removed.slotId],
        )
      }
    }

    regenerateExactOpenEdges(db, templateId)
    const nextRevision = template.currentRevision + 1
    snapshotCurrent(db, templateId, nextRevision, now)
    db.raw.run(`UPDATE harness_templates SET current_revision = ?, updated_at = ? WHERE id = ?`, [
      nextRevision,
      now,
      templateId,
    ])
    return nextRevision
  })()
}

export function regenerateExactOpenEdges(db: BazilionDb, templateId: string): void {
  db.raw.run('DELETE FROM harness_template_edges WHERE template_id = ?', [templateId])
  db.raw.run(
    `INSERT INTO harness_template_edges
     SELECT a.template_id, 'slot', a.slot_id, 'slot', b.slot_id
     FROM harness_template_slots a JOIN harness_template_slots b
       ON b.template_id = a.template_id AND b.slot_id <> a.slot_id
     WHERE a.template_id = ? AND a.tombstoned_at IS NULL AND b.tombstoned_at IS NULL`,
    [templateId],
  )
  for (const [sourceKind, targetKind] of [
    ['user', 'slot'],
    ['slot', 'user'],
    ['outside_group', 'slot'],
    ['slot', 'outside_group'],
  ] as const) {
    const sourceId = sourceKind === 'slot' ? 'slot_id' : "''"
    const targetId = targetKind === 'slot' ? 'slot_id' : "''"
    db.raw.run(
      `INSERT INTO harness_template_edges
       SELECT template_id, '${sourceKind}', ${sourceId}, '${targetKind}', ${targetId}
       FROM harness_template_slots WHERE template_id = ? AND tombstoned_at IS NULL`,
      [templateId],
    )
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
    `INSERT INTO harness_template_revisions (template_id, revision, name, user_md, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [templateId, revisionNumber, template.name, template.userMd, now],
  )
  db.raw.run(
    `INSERT INTO harness_template_revision_slots
     SELECT template_id, ?, slot_id, position, profile_id, agent_name, model_override,
            reasoning_level, position_x, position_y, display_json
     FROM harness_template_slots WHERE template_id = ? AND tombstoned_at IS NULL`,
    [revisionNumber, templateId],
  )
  db.raw.run(
    `INSERT INTO harness_template_revision_edges
     SELECT template_id, ?, source_kind, source_id, target_kind, target_id
     FROM harness_template_edges WHERE template_id = ?`,
    [revisionNumber, templateId],
  )
}

export function removeCompatibility(db: BazilionDb, id: string): 'deleted' | 'tombstoned' {
  requireCompatible(db, id)
  const lineage = db.raw
    .query<{ count: number }, [string]>(
      'SELECT COUNT(*) AS count FROM template_instantiations WHERE template_id = ?',
    )
    .get(id)?.count
  if ((lineage ?? 0) > 0) {
    db.raw.run('UPDATE harness_templates SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      Date.now(),
      Date.now(),
      id,
    ])
    return 'tombstoned'
  }
  db.raw.run('DELETE FROM harness_templates WHERE id = ?', [id])
  return 'deleted'
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
  db.raw.run('DELETE FROM harness_template_revisions WHERE template_id = ? AND revision = ?', [
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
      `SELECT DISTINCT t.id, t.name FROM harness_templates t
       WHERE EXISTS (
         SELECT 1 FROM harness_template_slots s
         WHERE s.template_id = t.id AND s.profile_id = ?
       ) OR EXISTS (
         SELECT 1 FROM harness_template_revision_slots s
         WHERE s.template_id = t.id AND s.profile_id = ?
       )`,
    )
    .all(profileId, profileId)
}

function requireCompatible(db: BazilionDb, id: string): HarnessTemplate {
  const template = get(db, id)
  if (!template) throw new Error(`profile group not found: ${id}`)
  if (template.deletedAt !== null) throw new Error(`template_deleted: ${id}`)
  if (!template.compatibilityManaged) throw new Error(`migration_required: ${id}`)
  if (!hasExactOpenTopology(db, id)) {
    throw new Error(`migration_required: ${id} no longer has exact Open Team policy`)
  }
  return template
}

export function hasExactOpenTopology(db: BazilionDb, templateId: string): boolean {
  const activeSlots = slots(db, templateId).map((slot) => slot.slotId)
  const expected = new Set<string>()
  for (const source of activeSlots) {
    for (const target of activeSlots) {
      if (source !== target) expected.add(`slot:${source}>slot:${target}`)
    }
    expected.add(`user:>slot:${source}`)
    expected.add(`slot:${source}>user:`)
    expected.add(`outside_group:>slot:${source}`)
    expected.add(`slot:${source}>outside_group:`)
  }
  const actual = new Set(
    edges(db, templateId).map(
      (edge) =>
        `${edge.sourceKind}:${edge.sourceId ?? ''}>${edge.targetKind}:${edge.targetId ?? ''}`,
    ),
  )
  return expected.size === actual.size && [...expected].every((key) => actual.has(key))
}
