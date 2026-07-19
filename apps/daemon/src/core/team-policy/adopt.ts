import { randomUUID } from 'node:crypto'
import type { ResolvedTeamPolicy, TeamPolicyEdge, TeamPolicyPlacement } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import * as agentRepo from '../repos/agents.ts'
import * as teamPolicyRepo from '../repos/teamPolicies.ts'
import * as teamTemplateRepo from '../repos/teamTemplates.ts'

type RemainingPlacement = Exclude<TeamPolicyPlacement, 'template_snapshot'>

export interface AdoptTeamTemplateInput {
  teamExpectedRevision: number
  templateId: string
  templateExpectedRevision: number
  slotMappings: Array<{ slotId: string; agentId: string }>
  remainingPlacements: Array<{ agentId: string; placement: RemainingPlacement }>
  previewEdges: Omit<TeamPolicyEdge, 'teamId'>[]
}

export function previewTeamPolicyAdoption(
  db: BazilionDb,
  teamId: string,
  input: Omit<AdoptTeamTemplateInput, 'previewEdges'>,
): Omit<TeamPolicyEdge, 'teamId'>[] {
  return resolveAdoptionPlan(db, teamId, { ...input, previewEdges: [] }).resolved
}

function resolveAdoptionPlan(db: BazilionDb, teamId: string, input: AdoptTeamTemplateInput) {
  const teamPolicy = teamPolicyRepo.get(db, teamId)
  if (!teamPolicy) throw new Error(`team_policy_missing: ${teamId}`)
  if (teamPolicy.revision !== input.teamExpectedRevision) {
    throw new Error(
      `team_revision_conflict: expected ${input.teamExpectedRevision}, current ${teamPolicy.revision}`,
    )
  }
  const template = teamTemplateRepo.get(db, input.templateId)
  if (!template) throw new Error(`team template not found: ${input.templateId}`)
  if (template.deletedAt !== null) throw new Error(`template_deleted: ${input.templateId}`)
  if (template.currentRevision !== input.templateExpectedRevision) {
    throw new Error(
      `template_revision_conflict: expected ${input.templateExpectedRevision}, current ${template.currentRevision}`,
    )
  }
  const snapshot = teamTemplateRepo.revision(db, template.id, input.templateExpectedRevision)
  if (!snapshot) throw new Error('template_snapshot_missing')
  const members = agentRepo
    .list(db, { includeArchived: true })
    .filter((agent) => agent.teamId === teamId)
  const memberIds = new Set(members.map((agent) => agent.id))
  const mapping = new Map(input.slotMappings.map((item) => [item.slotId, item.agentId]))
  if (mapping.size !== input.slotMappings.length || mapping.size !== snapshot.slots.length) {
    throw new Error('adoption_mapping_invalid: every active source slot must be mapped once')
  }
  const mappedAgents = new Set(mapping.values())
  if (mappedAgents.size !== mapping.size) {
    throw new Error('adoption_mapping_invalid: mappings must be injective')
  }
  for (const slot of snapshot.slots) {
    const agentId = mapping.get(slot.slotId)
    if (!agentId || !memberIds.has(agentId)) {
      throw new Error(`adoption_mapping_invalid: slot ${slot.slotId} is not mapped to a member`)
    }
  }
  const remainingIds = new Set([...memberIds].filter((id) => !mappedAgents.has(id)))
  if (
    input.remainingPlacements.some(
      (item) => item.placement !== 'isolated' && item.placement !== 'profile_defaults',
    )
  ) {
    throw new Error('adoption_mapping_invalid: unknown placement')
  }
  const placements = new Map(
    input.remainingPlacements.map((item) => [item.agentId, item.placement]),
  )
  if (
    placements.size !== input.remainingPlacements.length ||
    placements.size !== remainingIds.size ||
    [...remainingIds].some((id) => !placements.has(id)) ||
    [...placements].some(([id]) => !remainingIds.has(id))
  ) {
    throw new Error('adoption_mapping_invalid: every remaining Agent needs one placement')
  }
  return {
    template,
    snapshot,
    mapping,
    resolved: resolveAdoptionEdges(db, snapshot.edges, mapping, placements, members),
  }
}

export function adoptTeamTemplate(
  db: BazilionDb,
  teamId: string,
  input: AdoptTeamTemplateInput,
): ResolvedTeamPolicy {
  return db.raw.transaction(() => {
    const { template, snapshot, mapping, resolved } = resolveAdoptionPlan(db, teamId, input)
    if (!sameEdges(resolved, input.previewEdges)) {
      throw new Error('adoption_preview_mismatch: reviewed preview does not match resolved policy')
    }

    db.raw.run('UPDATE team_policies SET baseline_instantiation_id = NULL WHERE team_id = ?', [
      teamId,
    ])
    db.raw.run(
      `DELETE FROM source_slot_bindings WHERE instantiation_id IN
       (SELECT id FROM template_instantiations WHERE team_id = ?)`,
      [teamId],
    )
    db.raw.run('DELETE FROM template_instantiations WHERE team_id = ?', [teamId])
    db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [teamId])
    const instantiationId = randomUUID()
    db.raw.run(
      `INSERT INTO template_instantiations
         (id, team_id, template_id, template_revision, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [instantiationId, teamId, template.id, snapshot.revision, Date.now()],
    )
    for (const [slotId, agentId] of mapping) {
      db.raw.run(
        `INSERT INTO source_slot_bindings (agent_id, instantiation_id, source_slot_id)
         VALUES (?, ?, ?)`,
        [agentId, instantiationId, slotId],
      )
    }
    for (const edge of resolved) {
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
          edge.posture,
        ],
      )
    }
    db.raw.run('UPDATE team_policies SET baseline_instantiation_id = ? WHERE team_id = ?', [
      instantiationId,
      teamId,
    ])
    teamPolicyRepo.bumpRevision(db, teamId)
    const result = teamPolicyRepo.detail(db, teamId)
    if (!result) throw new Error(`team_policy_missing: ${teamId}`)
    return result
  })()
}

function resolveAdoptionEdges(
  db: BazilionDb,
  templateEdges: Array<{
    sourceKind: 'user' | 'outside_team' | 'slot'
    sourceId: string | null
    targetKind: 'user' | 'outside_team' | 'slot'
    targetId: string | null
    posture: 'allow' | 'approval_required'
  }>,
  mapping: ReadonlyMap<string, string>,
  placements: ReadonlyMap<string, RemainingPlacement>,
  members: ReturnType<typeof agentRepo.list>,
): Omit<TeamPolicyEdge, 'teamId'>[] {
  const edgeMap = new Map<string, Omit<TeamPolicyEdge, 'teamId'>>()
  const add = (
    sourceKind: TeamPolicyEdge['sourceKind'],
    sourceId: string | null,
    targetKind: TeamPolicyEdge['targetKind'],
    targetId: string | null,
    posture: TeamPolicyEdge['posture'] = 'allow',
  ) => {
    const edge = { sourceKind, sourceId, targetKind, targetId, posture }
    edgeMap.set(edgeKey(edge), edge)
  }
  for (const edge of templateEdges) {
    add(
      edge.sourceKind === 'slot' ? 'agent' : edge.sourceKind,
      edge.sourceKind === 'slot' ? (mapping.get(edge.sourceId ?? '') ?? null) : null,
      edge.targetKind === 'slot' ? 'agent' : edge.targetKind,
      edge.targetKind === 'slot' ? (mapping.get(edge.targetId ?? '') ?? null) : null,
      edge.posture,
    )
  }
  const mappedIds = new Set(mapping.values())
  const memberById = new Map(members.map((agent) => [agent.id, agent]))
  const requestsPeers = new Set<string>()
  for (const [agentId, placement] of placements) {
    const agent = memberById.get(agentId)
    if (!agent) continue
    if (placement === 'profile_defaults') {
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
        .get(agent.profileId)
      if (defaults?.user_input) add('user', null, 'agent', agentId)
      if (defaults?.user_output) add('agent', agentId, 'user', null)
      if (defaults?.outside_team_input) add('outside_team', null, 'agent', agentId)
      if (defaults?.outside_team_output) add('agent', agentId, 'outside_team', null)
      if (defaults?.peer_default === 'allow_all') requestsPeers.add(agentId)
    }
  }
  for (const agentId of requestsPeers) {
    for (const mappedId of mappedIds) {
      add('agent', agentId, 'agent', mappedId)
      add('agent', mappedId, 'agent', agentId)
    }
  }
  const liveOnly = [...placements.keys()]
  for (let left = 0; left < liveOnly.length; left++) {
    for (let right = left + 1; right < liveOnly.length; right++) {
      const a = liveOnly[left]
      const b = liveOnly[right]
      if (a && b && requestsPeers.has(a) && requestsPeers.has(b)) {
        add('agent', a, 'agent', b)
        add('agent', b, 'agent', a)
      }
    }
  }
  return [...edgeMap.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))
}

function sameEdges(
  actual: Omit<TeamPolicyEdge, 'teamId'>[],
  preview: Omit<TeamPolicyEdge, 'teamId'>[],
): boolean {
  const a = actual.map(edgeKey).sort()
  const b = preview.map(edgeKey).sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function edgeKey(edge: Omit<TeamPolicyEdge, 'teamId'>): string {
  return `${edge.sourceKind}:${edge.sourceId ?? ''}>${edge.targetKind}:${edge.targetId ?? ''}[${edge.posture ?? 'allow'}]`
}
