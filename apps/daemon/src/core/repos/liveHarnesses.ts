import type {
  LiveAgentState,
  LiveEndpointKind,
  LiveHarness,
  LiveHarnessEdge,
  ResolvedGroupHarness,
  SourceSlotBinding,
  TemplateInstantiation,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import * as agentRepo from './agents.ts'

interface RawHarness {
  group_id: string
  revision: number
  membership_mode: LiveHarness['membershipMode']
  baseline_instantiation_id: string | null
  updated_at: number
}

interface RawEdge {
  group_id: string
  source_kind: LiveHarnessEdge['sourceKind']
  source_id: string
  target_kind: LiveHarnessEdge['targetKind']
  target_id: string
  posture: LiveHarnessEdge['posture']
}

export function get(db: BazilionDb, groupId: string): LiveHarness | null {
  const row = db.raw
    .query<RawHarness, [string]>('SELECT * FROM live_harnesses WHERE group_id = ?')
    .get(groupId)
  return row
    ? {
        groupId: row.group_id,
        revision: row.revision,
        membershipMode: row.membership_mode,
        baselineInstantiationId: row.baseline_instantiation_id,
        updatedAt: row.updated_at,
      }
    : null
}

export function edges(db: BazilionDb, groupId: string): LiveHarnessEdge[] {
  return db.raw
    .query<RawEdge, [string]>(
      `SELECT * FROM live_harness_edges WHERE group_id = ?
       ORDER BY source_kind, source_id, target_kind, target_id`,
    )
    .all(groupId)
    .map((row) => ({
      groupId: row.group_id,
      sourceKind: row.source_kind,
      sourceId: row.source_id || null,
      targetKind: row.target_kind,
      targetId: row.target_id || null,
      posture: row.posture,
    }))
}

export function detail(db: BazilionDb, groupId: string): ResolvedGroupHarness | null {
  const harness = get(db, groupId)
  if (!harness) return null
  const allInstantiations = instantiations(db, groupId)
  return {
    harness,
    edges: edges(db, groupId),
    instantiations: allInstantiations,
    bindings: bindings(db, groupId),
    agentState: agentState(db, groupId),
    baseline: allInstantiations.find((item) => item.id === harness.baselineInstantiationId) ?? null,
    members: agentRepo
      .list(db, { includeArchived: true })
      .filter((agent) => agent.groupId === groupId),
  }
}

export function replacePolicy(
  db: BazilionDb,
  groupId: string,
  input: { expectedRevision: number; edges: Omit<LiveHarnessEdge, 'groupId'>[] },
): ResolvedGroupHarness {
  return db.raw.transaction(() => {
    const harness = requireHarness(db, groupId)
    requireRevision(harness, input.expectedRevision)
    validateEdges(db, groupId, input.edges)
    db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ?', [groupId])
    for (const edge of input.edges) {
      db.raw.run(
        `INSERT INTO live_harness_edges
           (group_id, source_kind, source_id, target_kind, target_id, posture)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          groupId,
          edge.sourceKind,
          edge.sourceId ?? '',
          edge.targetKind,
          edge.targetId ?? '',
          edge.posture ?? 'allow',
        ],
      )
    }
    bumpExplicit(db, groupId)
    return requireDetail(db, groupId)
  })()
}

export function bumpExplicit(db: BazilionDb, groupId: string): LiveHarness {
  db.raw.run(
    `UPDATE live_harnesses SET revision = revision + 1, membership_mode = 'explicit',
       updated_at = ? WHERE group_id = ?`,
    [Date.now(), groupId],
  )
  return requireHarness(db, groupId)
}

export function insertAgentState(db: BazilionDb, groupId: string, agentId: string): void {
  db.raw.run(
    `INSERT INTO live_agent_state (agent_id, group_id, position_x, position_y, display_json)
     VALUES (?, ?, NULL, NULL, NULL)`,
    [agentId, groupId],
  )
}

export function addPlacementEdges(
  db: BazilionDb,
  groupId: string,
  agentId: string,
  placement: 'isolated' | 'open' | 'profile_defaults',
  profileId: string,
): void {
  for (const edge of placementEdgesPreview(db, groupId, agentId, placement, profileId)) {
    insertLiveEdge(db, groupId, edge.sourceKind, edge.sourceId, edge.targetKind, edge.targetId)
  }
}

export function placementEdgesPreview(
  db: BazilionDb,
  groupId: string,
  agentId: string,
  placement: 'isolated' | 'open' | 'profile_defaults',
  profileId: string,
): Array<Omit<LiveHarnessEdge, 'groupId'>> {
  if (placement === 'isolated') return []
  const edges = new Map<string, Omit<LiveHarnessEdge, 'groupId'>>()
  const add = (
    sourceKind: LiveEndpointKind,
    sourceId: string | null,
    targetKind: LiveEndpointKind,
    targetId: string | null,
    posture: LiveHarnessEdge['posture'] = 'allow',
  ) => {
    const edge = { sourceKind, sourceId, targetKind, targetId, posture }
    edges.set(`${sourceKind}:${sourceId ?? ''}>${targetKind}:${targetId ?? ''}`, edge)
  }
  const peers = db.raw
    .query<{ id: string }, [string, string]>(
      'SELECT id FROM agents WHERE group_id = ? AND id <> ? ORDER BY id',
    )
    .all(groupId, agentId)
    .map((row) => row.id)
  if (placement === 'open') {
    for (const peerId of peers) {
      add('agent', agentId, 'agent', peerId)
      add('agent', peerId, 'agent', agentId)
    }
    for (const [sourceKind, sourceId, targetKind, targetId] of [
      ['user', null, 'agent', agentId],
      ['agent', agentId, 'user', null],
      ['outside_group', null, 'agent', agentId],
      ['agent', agentId, 'outside_group', null],
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
        outside_group_input: number
        outside_group_output: number
        peer_default: string
      },
      [string]
    >('SELECT * FROM profile_communication_defaults WHERE profile_id = ?')
    .get(profileId)
  if (!defaults) return []
  if (defaults.user_input) add('user', null, 'agent', agentId)
  if (defaults.user_output) add('agent', agentId, 'user', null)
  if (defaults.outside_group_input) {
    add('outside_group', null, 'agent', agentId)
  }
  if (defaults.outside_group_output) {
    add('agent', agentId, 'outside_group', null)
  }
  if (defaults.peer_default === 'allow_all') {
    for (const peerId of peers) {
      add('agent', agentId, 'agent', peerId)
      add('agent', peerId, 'agent', agentId)
    }
  }
  return [...edges.values()]
}

export function requireCompatibilityOpen(db: BazilionDb, groupId: string): LiveHarness {
  const harness = get(db, groupId)
  if (!harness) throw new Error(`group_policy_missing: ${groupId}`)
  if (harness.membershipMode !== 'compatibility_open') {
    throw new Error(`placement_required: group ${groupId} has explicit membership policy`)
  }
  if (!hasExactOpenTopology(db, groupId)) {
    throw new Error(`group_policy_invalid: group ${groupId} is not exact Open Team`)
  }
  return harness
}

export function hasExactOpenTopology(db: BazilionDb, groupId: string): boolean {
  const agentIds = db.raw
    .query<{ id: string }, [string]>('SELECT id FROM agents WHERE group_id = ? ORDER BY id')
    .all(groupId)
    .map((row) => row.id)
  const expected = new Set<string>()
  for (const source of agentIds) {
    for (const target of agentIds) {
      if (source !== target) expected.add(`agent:${source}>agent:${target}[allow]`)
    }
    expected.add(`user:>agent:${source}[allow]`)
    expected.add(`agent:${source}>user:[allow]`)
    expected.add(`outside_group:>agent:${source}[allow]`)
    expected.add(`agent:${source}>outside_group:[allow]`)
  }
  const actual = new Set(
    edges(db, groupId).map(
      (edge) =>
        `${edge.sourceKind}:${edge.sourceId ?? ''}>${edge.targetKind}:${edge.targetId ?? ''}[${edge.posture}]`,
    ),
  )
  return expected.size === actual.size && [...expected].every((key) => actual.has(key))
}

/** Rebuild exact Open Team from agents.group_id and optionally bump the aggregate once. */
export function regenerateExactOpen(
  db: BazilionDb,
  groupId: string,
  options: { bump?: boolean } = {},
): LiveHarness {
  const current = get(db, groupId)
  if (!current) throw new Error(`group_policy_missing: ${groupId}`)
  if (current.membershipMode !== 'compatibility_open') {
    throw new Error(`placement_required: group ${groupId} has explicit membership policy`)
  }
  db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ?', [groupId])
  db.raw.run(
    `DELETE FROM live_agent_state
     WHERE group_id = ? AND agent_id NOT IN (SELECT id FROM agents WHERE group_id = ?)`,
    [groupId, groupId],
  )
  db.raw.run(
    `INSERT INTO live_agent_state (agent_id, group_id, position_x, position_y, display_json)
     SELECT a.id, a.group_id, NULL, NULL, NULL FROM agents a
     WHERE a.group_id = ? AND NOT EXISTS (
       SELECT 1 FROM live_agent_state s WHERE s.agent_id = a.id
     )`,
    [groupId],
  )
  db.raw.run(
    `INSERT INTO live_harness_edges
       (group_id, source_kind, source_id, target_kind, target_id)
     SELECT a.group_id, 'agent', a.id, 'agent', b.id
     FROM agents a JOIN agents b ON b.group_id = a.group_id AND b.id <> a.id
     WHERE a.group_id = ?`,
    [groupId],
  )
  for (const [sourceKind, targetKind] of [
    ['user', 'agent'],
    ['agent', 'user'],
    ['outside_group', 'agent'],
    ['agent', 'outside_group'],
  ] as const) {
    const sourceId = sourceKind === 'agent' ? 'id' : "''"
    const targetId = targetKind === 'agent' ? 'id' : "''"
    db.raw.run(
      `INSERT INTO live_harness_edges
         (group_id, source_kind, source_id, target_kind, target_id)
       SELECT group_id, '${sourceKind}', ${sourceId}, '${targetKind}', ${targetId}
       FROM agents WHERE group_id = ?`,
      [groupId],
    )
  }
  if (options.bump !== false) {
    db.raw.run(
      'UPDATE live_harnesses SET revision = revision + 1, updated_at = ? WHERE group_id = ?',
      [Date.now(), groupId],
    )
  }
  return get(db, groupId) ?? current
}

export function edgeCount(db: BazilionDb, groupId: string): number {
  return (
    db.raw
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM live_harness_edges WHERE group_id = ?',
      )
      .get(groupId)?.count ?? 0
  )
}

export function instantiations(db: BazilionDb, groupId: string): TemplateInstantiation[] {
  return db.raw
    .query<
      {
        id: string
        group_id: string
        template_id: string
        template_revision: number
        created_at: number
      },
      [string]
    >(
      `SELECT * FROM template_instantiations WHERE group_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(groupId)
    .map((row) => ({
      id: row.id,
      groupId: row.group_id,
      templateId: row.template_id,
      templateRevision: row.template_revision,
      createdAt: row.created_at,
    }))
}

export function bindings(db: BazilionDb, groupId: string): SourceSlotBinding[] {
  return db.raw
    .query<{ agent_id: string; instantiation_id: string; source_slot_id: string }, [string]>(
      `SELECT b.* FROM source_slot_bindings b
       JOIN template_instantiations i ON i.id = b.instantiation_id
       WHERE i.group_id = ? ORDER BY b.agent_id ASC`,
    )
    .all(groupId)
    .map((row) => ({
      agentId: row.agent_id,
      instantiationId: row.instantiation_id,
      sourceSlotId: row.source_slot_id,
    }))
}

export function agentState(db: BazilionDb, groupId: string): LiveAgentState[] {
  return db.raw
    .query<
      {
        agent_id: string
        group_id: string
        position_x: number | null
        position_y: number | null
        display_json: string | null
      },
      [string]
    >('SELECT * FROM live_agent_state WHERE group_id = ? ORDER BY agent_id ASC')
    .all(groupId)
    .map((row) => ({
      agentId: row.agent_id,
      groupId: row.group_id,
      position:
        row.position_x === null || row.position_y === null
          ? null
          : { x: row.position_x, y: row.position_y },
      display: row.display_json ? (JSON.parse(row.display_json) as Record<string, unknown>) : null,
    }))
}

function requireHarness(db: BazilionDb, groupId: string): LiveHarness {
  const harness = get(db, groupId)
  if (!harness) throw new Error(`group_policy_missing: ${groupId}`)
  return harness
}

function requireDetail(db: BazilionDb, groupId: string): ResolvedGroupHarness {
  const found = detail(db, groupId)
  if (!found) throw new Error(`group_policy_missing: ${groupId}`)
  return found
}

function requireRevision(harness: LiveHarness, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1 || expected !== harness.revision) {
    throw new Error(`group_revision_conflict: expected ${expected}, current ${harness.revision}`)
  }
}

function validateEdges(
  db: BazilionDb,
  groupId: string,
  policyEdges: Omit<LiveHarnessEdge, 'groupId'>[],
): void {
  const members = new Set(
    db.raw
      .query<{ id: string }, [string]>('SELECT id FROM agents WHERE group_id = ?')
      .all(groupId)
      .map((row) => row.id),
  )
  const keys = new Set<string>()
  for (const edge of policyEdges) {
    if (edge.posture !== 'allow' && edge.posture !== 'approval_required') {
      throw new Error(`group_policy_invalid: invalid edge posture ${edge.posture}`)
    }
    for (const [kind, id] of [
      [edge.sourceKind, edge.sourceId],
      [edge.targetKind, edge.targetId],
    ] as const) {
      if (!['user', 'outside_group', 'agent'].includes(kind)) {
        throw new Error(`group_policy_invalid: invalid endpoint kind ${kind}`)
      }
      if ((kind === 'agent') !== (typeof id === 'string' && id.length > 0)) {
        throw new Error('group_policy_invalid: Agent endpoints require an id')
      }
      if (kind === 'agent' && !members.has(id ?? '')) {
        throw new Error(`member_not_in_group: ${id}`)
      }
    }
    if (edge.sourceKind !== 'agent' && edge.targetKind !== 'agent') {
      throw new Error('group_policy_invalid: boundary-to-boundary edge')
    }
    if (edge.sourceKind === edge.targetKind && edge.sourceId === edge.targetId) {
      throw new Error('group_policy_invalid: self edge')
    }
    const key = `${edge.sourceKind}:${edge.sourceId ?? ''}>${edge.targetKind}:${edge.targetId ?? ''}`
    if (keys.has(key)) throw new Error(`group_policy_invalid: duplicate edge ${key}`)
    keys.add(key)
  }
}

function insertLiveEdge(
  db: BazilionDb,
  groupId: string,
  sourceKind: LiveHarnessEdge['sourceKind'],
  sourceId: string | null,
  targetKind: LiveHarnessEdge['targetKind'],
  targetId: string | null,
): void {
  db.raw.run(
    `INSERT OR IGNORE INTO live_harness_edges
       (group_id, source_kind, source_id, target_kind, target_id)
     VALUES (?, ?, ?, ?, ?)`,
    [groupId, sourceKind, sourceId ?? '', targetKind, targetId ?? ''],
  )
}
