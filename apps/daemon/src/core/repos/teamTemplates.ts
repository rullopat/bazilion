import {
  OUTSIDE_TEAM,
  REASONING_LEVELS,
  type ReasoningLevel,
  type TeamPolicyMode,
  type TeamTemplate,
  type TeamTemplateEdge,
  type TeamTemplateEndpoint,
  type TeamTemplateSlot,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import * as profileRepo from './profiles.ts'

/** A template body with a missing name, an unknown profile or a malformed slot or edge. */
class InvalidTeamTemplateError extends DomainError {
  constructor(message: string) {
    super(400, message)
  }
}

interface RawTemplate {
  id: string
  name: string
  user_md: string | null
  policy_mode: TeamPolicyMode
  created_at: number
  updated_at: number
}

interface RawSlot {
  profile_id: string
  agent_name: string
  model_override: string | null
  reasoning_level: ReasoningLevel | null
  layout_x: number | null
  layout_y: number | null
}

type TemplateBody = Pick<TeamTemplate, 'name' | 'userMd' | 'policyMode' | 'slots' | 'edges'>

function endpoint(value: string): TeamTemplateEndpoint {
  return value === OUTSIDE_TEAM ? OUTSIDE_TEAM : Number(value)
}

function toTemplate(db: BazilionDb, row: RawTemplate): TeamTemplate {
  const slots = db.raw
    .query<RawSlot, [string]>(
      'SELECT * FROM team_template_slots WHERE template_id = ? ORDER BY position',
    )
    .all(row.id)
    .map(
      (slot): TeamTemplateSlot => ({
        profileId: slot.profile_id,
        agentName: slot.agent_name,
        modelOverride: slot.model_override,
        reasoningLevel: slot.reasoning_level,
        layoutPosition:
          slot.layout_x === null || slot.layout_y === null
            ? null
            : { x: slot.layout_x, y: slot.layout_y },
      }),
    )
  const edges = db.raw
    .query<{ source: string; target: string }, [string]>(
      'SELECT source, target FROM team_template_edges WHERE template_id = ? ORDER BY source, target',
    )
    .all(row.id)
    .map((edge) => ({ from: endpoint(edge.source), to: endpoint(edge.target) }))
  return {
    id: row.id,
    name: row.name,
    userMd: row.user_md,
    policyMode: row.policy_mode,
    slots,
    edges,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function get(db: BazilionDb, id: string): TeamTemplate | null {
  const row = db.raw
    .query<RawTemplate, [string]>('SELECT * FROM team_templates WHERE id = ?')
    .get(id)
  return row ? toTemplate(db, row) : null
}

export function list(db: BazilionDb): TeamTemplate[] {
  return db.raw
    .query<RawTemplate, []>('SELECT * FROM team_templates ORDER BY created_at, id')
    .all()
    .map((row) => toTemplate(db, row))
}

/** Create from an untrusted request body (`id`, `name`, optional roster, edges, mode, USER.md). */
export function create(db: BazilionDb, id: string, raw: unknown): TeamTemplate {
  return db.raw.transaction(() => {
    if (get(db, id)) throw new InvalidTeamTemplateError(`team template already exists: ${id}`)
    const body = parseBody(db, raw)
    const now = Date.now()
    db.raw.run(
      `INSERT INTO team_templates (id, name, user_md, policy_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, body.name, body.userMd, body.policyMode, now, now],
    )
    writeRoster(db, id, body)
    return requireTemplate(db, id)
  })()
}

/** Replace a template's whole definition from an untrusted request body. Last write wins. */
export function replace(db: BazilionDb, id: string, raw: unknown): TeamTemplate {
  return db.raw.transaction(() => {
    if (!get(db, id)) throw new DomainError(404, `team template not found: ${id}`)
    const body = parseBody(db, raw)
    db.raw.run(
      'UPDATE team_templates SET name = ?, user_md = ?, policy_mode = ?, updated_at = ? WHERE id = ?',
      [body.name, body.userMd, body.policyMode, Date.now(), id],
    )
    writeRoster(db, id, body)
    return requireTemplate(db, id)
  })()
}

export function remove(db: BazilionDb, id: string): boolean {
  return db.raw.run('DELETE FROM team_templates WHERE id = ?', [id]).changes > 0
}

export function findReferencingProfile(
  db: BazilionDb,
  profileId: string,
): Array<{ id: string; name: string }> {
  return db.raw
    .query<{ id: string; name: string }, [string]>(
      `SELECT DISTINCT t.id, t.name FROM team_templates t
       JOIN team_template_slots s ON s.template_id = t.id
       WHERE s.profile_id = ?`,
    )
    .all(profileId)
}

function requireTemplate(db: BazilionDb, id: string): TeamTemplate {
  const template = get(db, id)
  if (!template) throw new DomainError(404, `team template not found: ${id}`)
  return template
}

function writeRoster(db: BazilionDb, id: string, body: TemplateBody): void {
  db.raw.run('DELETE FROM team_template_slots WHERE template_id = ?', [id])
  db.raw.run('DELETE FROM team_template_edges WHERE template_id = ?', [id])
  body.slots.forEach((slot, position) => {
    db.raw.run(
      `INSERT INTO team_template_slots
         (template_id, position, profile_id, agent_name, model_override, reasoning_level,
          layout_x, layout_y)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        position,
        slot.profileId,
        slot.agentName,
        slot.modelOverride,
        slot.reasoningLevel,
        slot.layoutPosition?.x ?? null,
        slot.layoutPosition?.y ?? null,
      ],
    )
  })
  for (const edge of body.edges) {
    db.raw.run(
      'INSERT OR IGNORE INTO team_template_edges (template_id, source, target) VALUES (?, ?, ?)',
      [id, String(edge.from), String(edge.to)],
    )
  }
}

function parseBody(db: BazilionDb, raw: unknown): TemplateBody {
  if (!isRecord(raw)) throw new InvalidTeamTemplateError('template body must be an object')
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) throw new InvalidTeamTemplateError('name is required')
  if (raw.userMd !== undefined && raw.userMd !== null && typeof raw.userMd !== 'string') {
    throw new InvalidTeamTemplateError('userMd must be a string or null')
  }
  const policyMode = raw.policyMode ?? 'open'
  if (policyMode !== 'open' && policyMode !== 'restricted') {
    throw new InvalidTeamTemplateError('policyMode must be open or restricted')
  }
  const slots = arrayField(raw.slots, 'slots').map((value, index) => parseSlot(db, value, index))
  const edges = arrayField(raw.edges, 'edges').map((value, index) => {
    if (!isRecord(value)) throw new InvalidTeamTemplateError(`edge ${index} must be an object`)
    const edge = {
      from: parseEndpoint(value.from, slots.length),
      to: parseEndpoint(value.to, slots.length),
    }
    if (edge.from === null || edge.to === null) {
      throw new InvalidTeamTemplateError(
        `edge ${index}: endpoints are slot positions (0-${slots.length - 1}) or "${OUTSIDE_TEAM}"`,
      )
    }
    if (edge.from === edge.to) {
      throw new InvalidTeamTemplateError(`edge ${index} must join two different endpoints`)
    }
    return edge as TeamTemplateEdge
  })
  return { name, userMd: raw.userMd ?? null, policyMode, slots, edges }
}

function parseSlot(db: BazilionDb, value: unknown, index: number): TeamTemplateSlot {
  if (!isRecord(value)) throw new InvalidTeamTemplateError(`slot ${index} must be an object`)
  const profileId = typeof value.profileId === 'string' ? value.profileId.trim() : ''
  const agentName = typeof value.agentName === 'string' ? value.agentName.trim() : ''
  if (!profileId || !agentName) {
    throw new InvalidTeamTemplateError(`slot ${index} needs profileId and agentName`)
  }
  if (!profileRepo.get(db, profileId)) {
    throw new InvalidTeamTemplateError(`slot ${index}: profile not found: ${profileId}`)
  }
  const modelOverride = value.modelOverride ?? null
  if (modelOverride !== null && typeof modelOverride !== 'string') {
    throw new InvalidTeamTemplateError(`slot ${index}: modelOverride must be a string`)
  }
  const reasoningLevel = value.reasoningLevel ?? null
  if (reasoningLevel !== null && !REASONING_LEVELS.includes(reasoningLevel as ReasoningLevel)) {
    throw new InvalidTeamTemplateError(`slot ${index}: invalid reasoningLevel`)
  }
  const layout = value.layoutPosition ?? null
  if (
    layout !== null &&
    !(isRecord(layout) && Number.isFinite(layout.x) && Number.isFinite(layout.y))
  ) {
    throw new InvalidTeamTemplateError(`slot ${index}: layoutPosition must be {x, y}`)
  }
  return {
    profileId,
    agentName,
    modelOverride: modelOverride || null,
    reasoningLevel: reasoningLevel as ReasoningLevel | null,
    layoutPosition: layout ? { x: layout.x as number, y: layout.y as number } : null,
  }
}

function parseEndpoint(value: unknown, slotCount: number): TeamTemplateEndpoint | null {
  if (value === OUTSIDE_TEAM) return OUTSIDE_TEAM
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < slotCount
    ? (value as number)
    : null
}

function arrayField(value: unknown, field: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new InvalidTeamTemplateError(`${field} must be an array`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
