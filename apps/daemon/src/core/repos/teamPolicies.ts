import type {
  LiveEndpointKind,
  ResolvedTeamPolicy,
  SourceSlotBinding,
  TeamAgentState,
  TeamPolicy,
  TeamPolicyEdge,
  TemplateInstantiation,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import * as agentRepo from './agents.ts'

interface RawTeamPolicy {
  team_id: string
  revision: number
  baseline_instantiation_id: string | null
  updated_at: number
}

interface RawEdge {
  team_id: string
  source_kind: TeamPolicyEdge['sourceKind']
  source_id: string
  target_kind: TeamPolicyEdge['targetKind']
  target_id: string
  posture: TeamPolicyEdge['posture']
}

export function get(db: BazilionDb, teamId: string): TeamPolicy | null {
  const row = db.raw
    .query<RawTeamPolicy, [string]>('SELECT * FROM team_policies WHERE team_id = ?')
    .get(teamId)
  return row
    ? {
        teamId: row.team_id,
        revision: row.revision,
        baselineInstantiationId: row.baseline_instantiation_id,
        updatedAt: row.updated_at,
      }
    : null
}

export function edges(db: BazilionDb, teamId: string): TeamPolicyEdge[] {
  return db.raw
    .query<RawEdge, [string]>(
      `SELECT * FROM team_policy_edges WHERE team_id = ?
       ORDER BY source_kind, source_id, target_kind, target_id`,
    )
    .all(teamId)
    .map((row) => ({
      teamId: row.team_id,
      sourceKind: row.source_kind,
      sourceId: row.source_id || null,
      targetKind: row.target_kind,
      targetId: row.target_id || null,
      posture: row.posture,
    }))
}

export function detail(db: BazilionDb, teamId: string): ResolvedTeamPolicy | null {
  const teamPolicy = get(db, teamId)
  if (!teamPolicy) return null
  const allInstantiations = instantiations(db, teamId)
  return {
    teamPolicy,
    edges: edges(db, teamId),
    instantiations: allInstantiations,
    bindings: bindings(db, teamId),
    agentState: agentState(db, teamId),
    baseline:
      allInstantiations.find((item) => item.id === teamPolicy.baselineInstantiationId) ?? null,
    members: agentRepo
      .list(db, { includeArchived: true })
      .filter((agent) => agent.teamId === teamId),
  }
}

export function replacePolicy(
  db: BazilionDb,
  teamId: string,
  input: { expectedRevision: number; edges: Omit<TeamPolicyEdge, 'teamId'>[] },
): ResolvedTeamPolicy {
  return db.raw.transaction(() => {
    const teamPolicy = requireTeamPolicy(db, teamId)
    requireRevision(teamPolicy, input.expectedRevision)
    validateEdges(db, teamId, input.edges)
    db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [teamId])
    for (const edge of input.edges) {
      db.raw.run(
        `INSERT INTO team_policy_edges
           (team_id, source_kind, source_id, target_kind, target_id, posture)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          teamId,
          edge.sourceKind,
          edge.sourceId ?? '',
          edge.targetKind,
          edge.targetId ?? '',
          edge.posture ?? 'allow',
        ],
      )
    }
    bumpRevision(db, teamId)
    return requireDetail(db, teamId)
  })()
}

export function bumpRevision(db: BazilionDb, teamId: string): TeamPolicy {
  db.raw.run(`UPDATE team_policies SET revision = revision + 1, updated_at = ? WHERE team_id = ?`, [
    Date.now(),
    teamId,
  ])
  return requireTeamPolicy(db, teamId)
}

export function insertAgentState(db: BazilionDb, teamId: string, agentId: string): void {
  db.raw.run(
    `INSERT INTO team_agent_state (agent_id, team_id, position_x, position_y, display_json)
     VALUES (?, ?, NULL, NULL, NULL)`,
    [agentId, teamId],
  )
}

export function addPlacementEdges(
  db: BazilionDb,
  teamId: string,
  agentId: string,
  placement: 'isolated' | 'open' | 'profile_defaults',
  profileId: string,
): void {
  for (const edge of placementEdgesPreview(db, teamId, agentId, placement, profileId)) {
    insertLiveEdge(db, teamId, edge.sourceKind, edge.sourceId, edge.targetKind, edge.targetId)
  }
}

export function placementEdgesPreview(
  db: BazilionDb,
  teamId: string,
  agentId: string,
  placement: 'isolated' | 'open' | 'profile_defaults',
  profileId: string,
): Array<Omit<TeamPolicyEdge, 'teamId'>> {
  if (placement === 'isolated') return []
  const edges = new Map<string, Omit<TeamPolicyEdge, 'teamId'>>()
  const add = (
    sourceKind: LiveEndpointKind,
    sourceId: string | null,
    targetKind: LiveEndpointKind,
    targetId: string | null,
    posture: TeamPolicyEdge['posture'] = 'allow',
  ) => {
    const edge = { sourceKind, sourceId, targetKind, targetId, posture }
    edges.set(`${sourceKind}:${sourceId ?? ''}>${targetKind}:${targetId ?? ''}`, edge)
  }
  const peers = db.raw
    .query<{ id: string }, [string, string]>(
      'SELECT id FROM agents WHERE team_id = ? AND id <> ? ORDER BY id',
    )
    .all(teamId, agentId)
    .map((row) => row.id)
  if (placement === 'open') {
    for (const peerId of peers) {
      add('agent', agentId, 'agent', peerId)
      add('agent', peerId, 'agent', agentId)
    }
    for (const [sourceKind, sourceId, targetKind, targetId] of [
      ['user', null, 'agent', agentId],
      ['agent', agentId, 'user', null],
      ['outside_team', null, 'agent', agentId],
      ['agent', agentId, 'outside_team', null],
    ] as const) {
      add(sourceKind, sourceId, targetKind, targetId)
    }
    return [...edges.values()]
  }
  const defaults = db.raw
    .query<
      {
        user_input: number
        user_output: number
        outside_team_input: number
        outside_team_output: number
        peer_default: string
      },
      [string]
    >('SELECT * FROM profile_communication_defaults WHERE profile_id = ?')
    .get(profileId)
  if (!defaults) return []
  if (defaults.user_input) add('user', null, 'agent', agentId)
  if (defaults.user_output) add('agent', agentId, 'user', null)
  if (defaults.outside_team_input) {
    add('outside_team', null, 'agent', agentId)
  }
  if (defaults.outside_team_output) {
    add('agent', agentId, 'outside_team', null)
  }
  if (defaults.peer_default === 'allow_all') {
    for (const peerId of peers) {
      add('agent', agentId, 'agent', peerId)
      add('agent', peerId, 'agent', agentId)
    }
  }
  return [...edges.values()]
}

export function edgeCount(db: BazilionDb, teamId: string): number {
  return (
    db.raw
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM team_policy_edges WHERE team_id = ?',
      )
      .get(teamId)?.count ?? 0
  )
}

export function instantiations(db: BazilionDb, teamId: string): TemplateInstantiation[] {
  return db.raw
    .query<
      {
        id: string
        team_id: string
        template_id: string
        template_revision: number
        created_at: number
      },
      [string]
    >(
      `SELECT * FROM template_instantiations WHERE team_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(teamId)
    .map((row) => ({
      id: row.id,
      teamId: row.team_id,
      templateId: row.template_id,
      templateRevision: row.template_revision,
      createdAt: row.created_at,
    }))
}

export function bindings(db: BazilionDb, teamId: string): SourceSlotBinding[] {
  return db.raw
    .query<{ agent_id: string; instantiation_id: string; source_slot_id: string }, [string]>(
      `SELECT b.* FROM source_slot_bindings b
       JOIN template_instantiations i ON i.id = b.instantiation_id
       WHERE i.team_id = ? ORDER BY b.agent_id ASC`,
    )
    .all(teamId)
    .map((row) => ({
      agentId: row.agent_id,
      instantiationId: row.instantiation_id,
      sourceSlotId: row.source_slot_id,
    }))
}

export function agentState(db: BazilionDb, teamId: string): TeamAgentState[] {
  return db.raw
    .query<
      {
        agent_id: string
        team_id: string
        position_x: number | null
        position_y: number | null
        display_json: string | null
      },
      [string]
    >('SELECT * FROM team_agent_state WHERE team_id = ? ORDER BY agent_id ASC')
    .all(teamId)
    .map((row) => ({
      agentId: row.agent_id,
      teamId: row.team_id,
      position:
        row.position_x === null || row.position_y === null
          ? null
          : { x: row.position_x, y: row.position_y },
      display: row.display_json ? (JSON.parse(row.display_json) as Record<string, unknown>) : null,
    }))
}

function requireTeamPolicy(db: BazilionDb, teamId: string): TeamPolicy {
  const teamPolicy = get(db, teamId)
  if (!teamPolicy) throw new Error(`team_policy_missing: ${teamId}`)
  return teamPolicy
}

function requireDetail(db: BazilionDb, teamId: string): ResolvedTeamPolicy {
  const found = detail(db, teamId)
  if (!found) throw new Error(`team_policy_missing: ${teamId}`)
  return found
}

function requireRevision(teamPolicy: TeamPolicy, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1 || expected !== teamPolicy.revision) {
    throw new Error(`team_revision_conflict: expected ${expected}, current ${teamPolicy.revision}`)
  }
}

function validateEdges(
  db: BazilionDb,
  teamId: string,
  policyEdges: Omit<TeamPolicyEdge, 'teamId'>[],
): void {
  const members = new Set(
    db.raw
      .query<{ id: string }, [string]>('SELECT id FROM agents WHERE team_id = ?')
      .all(teamId)
      .map((row) => row.id),
  )
  const keys = new Set<string>()
  for (const edge of policyEdges) {
    if (edge.posture !== 'allow' && edge.posture !== 'approval_required') {
      throw new Error(`team_policy_invalid: invalid edge posture ${edge.posture}`)
    }
    for (const [kind, id] of [
      [edge.sourceKind, edge.sourceId],
      [edge.targetKind, edge.targetId],
    ] as const) {
      if (!['user', 'outside_team', 'agent'].includes(kind)) {
        throw new Error(`team_policy_invalid: invalid endpoint kind ${kind}`)
      }
      if ((kind === 'agent') !== (typeof id === 'string' && id.length > 0)) {
        throw new Error('team_policy_invalid: Agent endpoints require an id')
      }
      if (kind === 'agent' && !members.has(id ?? '')) {
        throw new Error(`member_not_in_group: ${id}`)
      }
    }
    if (edge.sourceKind !== 'agent' && edge.targetKind !== 'agent') {
      throw new Error('team_policy_invalid: boundary-to-boundary edge')
    }
    if (edge.sourceKind === edge.targetKind && edge.sourceId === edge.targetId) {
      throw new Error('team_policy_invalid: self edge')
    }
    const key = `${edge.sourceKind}:${edge.sourceId ?? ''}>${edge.targetKind}:${edge.targetId ?? ''}`
    if (keys.has(key)) throw new Error(`team_policy_invalid: duplicate edge ${key}`)
    keys.add(key)
  }
}

function insertLiveEdge(
  db: BazilionDb,
  teamId: string,
  sourceKind: TeamPolicyEdge['sourceKind'],
  sourceId: string | null,
  targetKind: TeamPolicyEdge['targetKind'],
  targetId: string | null,
): void {
  db.raw.run(
    `INSERT OR IGNORE INTO team_policy_edges
       (team_id, source_kind, source_id, target_kind, target_id)
     VALUES (?, ?, ?, ?, ?)`,
    [teamId, sourceKind, sourceId ?? '', targetKind, targetId ?? ''],
  )
}
