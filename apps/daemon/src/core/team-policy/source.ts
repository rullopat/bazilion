import { randomUUID } from 'node:crypto'
import type { TeamPolicyEdge, TeamTemplateDetail } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import * as teamPolicyRepo from '../repos/teamPolicies.ts'
import * as teamRepo from '../repos/teams.ts'
import * as teamTemplateRepo from '../repos/teamTemplates.ts'

export interface TeamPolicyDiff {
  teamId: string
  liveRevision: number
  baseline: {
    instantiationId: string
    templateId: string
    templateRevision: number
    snapshot: ReturnType<typeof teamTemplateRepo.revision>
  } | null
  currentSource: TeamTemplateDetail | null
  liveEdges: TeamPolicyEdge[]
  sourceDiverged: boolean
  comparison: {
    baselineEdges: TeamPolicyEdge[]
    addedSinceBaseline: TeamPolicyEdge[]
    removedSinceBaseline: TeamPolicyEdge[]
    currentSourceAddedSlotIds: string[]
    currentSourceRemovedSlotIds: string[]
  }
}

export function diffTeamPolicy(db: BazilionDb, teamId: string): TeamPolicyDiff {
  const detail = teamPolicyRepo.detail(db, teamId)
  if (!detail) throw new Error(`team_policy_missing: ${teamId}`)
  const baseline = detail.baseline
  const source = baseline ? teamTemplateRepo.detail(db, baseline.templateId) : null
  const baselineSnapshot = baseline
    ? teamTemplateRepo.revision(db, baseline.templateId, baseline.templateRevision)
    : null
  const bindingBySlot = new Map(
    detail.bindings
      .filter((binding) => binding.instantiationId === baseline?.id)
      .map((binding) => [binding.sourceSlotId, binding.agentId]),
  )
  const baselineEdges: TeamPolicyEdge[] = (baselineSnapshot?.edges ?? []).flatMap((edge) => {
    const sourceId = edge.sourceKind === 'slot' ? bindingBySlot.get(edge.sourceId ?? '') : null
    const targetId = edge.targetKind === 'slot' ? bindingBySlot.get(edge.targetId ?? '') : null
    if ((edge.sourceKind === 'slot' && !sourceId) || (edge.targetKind === 'slot' && !targetId)) {
      return []
    }
    return [
      {
        teamId,
        sourceKind: edge.sourceKind === 'slot' ? 'agent' : edge.sourceKind,
        sourceId: sourceId ?? null,
        targetKind: edge.targetKind === 'slot' ? 'agent' : edge.targetKind,
        targetId: targetId ?? null,
        posture: edge.posture,
      },
    ]
  })
  const liveEdges = detail.edges
  const baselineKeys = new Set(baselineEdges.map(liveEdgeKey))
  const liveKeys = new Set(liveEdges.map(liveEdgeKey))
  const baselineSlotIds = new Set(baselineSnapshot?.slots.map((slot) => slot.slotId) ?? [])
  const currentSlotIds = new Set(source?.slots.map((slot) => slot.slotId) ?? [])
  return {
    teamId,
    liveRevision: detail.teamPolicy.revision,
    baseline: baseline
      ? {
          instantiationId: baseline.id,
          templateId: baseline.templateId,
          templateRevision: baseline.templateRevision,
          snapshot: baselineSnapshot,
        }
      : null,
    currentSource: source,
    liveEdges,
    sourceDiverged: !!baseline && source?.template.currentRevision !== baseline.templateRevision,
    comparison: {
      baselineEdges,
      addedSinceBaseline: liveEdges.filter((edge) => !baselineKeys.has(liveEdgeKey(edge))),
      removedSinceBaseline: baselineEdges.filter((edge) => !liveKeys.has(liveEdgeKey(edge))),
      currentSourceAddedSlotIds: [...currentSlotIds].filter((id) => !baselineSlotIds.has(id)),
      currentSourceRemovedSlotIds: [...baselineSlotIds].filter((id) => !currentSlotIds.has(id)),
    },
  }
}

export function saveTeamPolicyAsTemplate(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  input: { expectedRevision: number; id: string; name: string; userMd?: string | null },
): TeamTemplateDetail {
  return db.raw.transaction(() => {
    const teamPolicy = teamPolicyRepo.get(db, teamId)
    if (!teamPolicy) throw new Error(`team_policy_missing: ${teamId}`)
    if (teamPolicy.revision !== input.expectedRevision) {
      throw new Error(
        `team_revision_conflict: expected ${input.expectedRevision}, current ${teamPolicy.revision}`,
      )
    }
    if (teamTemplateRepo.get(db, input.id)) {
      throw new Error(`team template already exists: ${input.id}`)
    }
    const team = teamRepo.get(db, teamId, paths)
    if (!team) throw new Error(`team not found: ${teamId}`)
    const members = agentRepo
      .list(db, { includeArchived: true })
      .filter((agent) => agent.teamId === teamId)
    const slotByAgent = new Map(members.map((agent) => [agent.id, randomUUID()]))
    const stateByAgent = new Map(
      teamPolicyRepo.agentState(db, teamId).map((state) => [state.agentId, state]),
    )
    return teamTemplateRepo.insertCanonicalDefinition(db, {
      id: input.id,
      name: input.name,
      userMd: Object.hasOwn(input, 'userMd') ? input.userMd : team.userMd,
      slots: members.map((agent) => ({
        slotId: slotByAgent.get(agent.id),
        profileId: agent.profileId,
        agentName: agent.name,
        modelOverride: agent.modelOverride,
        reasoningLevel: agent.reasoningLevel,
        layoutPosition: stateByAgent.get(agent.id)?.position ?? null,
        display: stateByAgent.get(agent.id)?.display ?? null,
      })),
      edges: teamPolicyRepo.edges(db, teamId).map((edge) => ({
        sourceKind: edge.sourceKind === 'agent' ? 'slot' : edge.sourceKind,
        sourceId: edge.sourceKind === 'agent' ? slotByAgent.get(edge.sourceId ?? '') : null,
        targetKind: edge.targetKind === 'agent' ? 'slot' : edge.targetKind,
        targetId: edge.targetKind === 'agent' ? slotByAgent.get(edge.targetId ?? '') : null,
        posture: edge.posture,
      })),
    })
  })()
}

function liveEdgeKey(edge: TeamPolicyEdge): string {
  return `${edge.sourceKind}:${edge.sourceId ?? ''}>${edge.targetKind}:${edge.targetId ?? ''}[${edge.posture}]`
}

export function updateTeamPolicySource(
  db: BazilionDb,
  teamId: string,
  input: {
    teamExpectedRevision: number
    templateExpectedRevision: number
    includeAgentIds: string[]
  },
): {
  template: TeamTemplateDetail
  team: NonNullable<ReturnType<typeof teamPolicyRepo.detail>>
} {
  return db.raw.transaction(() => {
    const teamPolicy = teamPolicyRepo.get(db, teamId)
    if (!teamPolicy) throw new Error(`team_policy_missing: ${teamId}`)
    if (teamPolicy.revision !== input.teamExpectedRevision) {
      throw new Error(
        `team_revision_conflict: expected ${input.teamExpectedRevision}, current ${teamPolicy.revision}`,
      )
    }
    if (!teamPolicy.baselineInstantiationId) throw new Error('baseline_missing: Team has no source')
    const baseline = teamPolicyRepo
      .instantiations(db, teamId)
      .find((item) => item.id === teamPolicy.baselineInstantiationId)
    if (!baseline) throw new Error('baseline_missing: retained baseline does not exist')
    const source = teamTemplateRepo.get(db, baseline.templateId)
    if (!source) throw new Error(`team template not found: ${baseline.templateId}`)
    if (source.deletedAt !== null) throw new Error(`template_deleted: ${source.id}`)
    if (source.currentRevision !== baseline.templateRevision) {
      throw new Error(
        `source_diverged: retained ${baseline.templateRevision}, current ${source.currentRevision}`,
      )
    }
    if (source.currentRevision !== input.templateExpectedRevision) {
      throw new Error(
        `template_revision_conflict: expected ${input.templateExpectedRevision}, current ${source.currentRevision}`,
      )
    }
    const include = new Set(input.includeAgentIds)
    if (include.size !== input.includeAgentIds.length) {
      throw new Error('source_update_invalid: duplicate included Agent')
    }
    const members = agentRepo
      .list(db, { includeArchived: true })
      .filter((agent) => agent.teamId === teamId)
    const memberById = new Map(members.map((agent) => [agent.id, agent]))
    for (const id of include) {
      if (!memberById.has(id)) throw new Error(`member_not_in_group: ${id}`)
    }
    const bindings = teamPolicyRepo.bindings(db, teamId)
    const previous = teamTemplateRepo.revision(db, source.id, source.currentRevision)
    if (!previous) throw new Error('template_snapshot_missing')
    const slotPosition = new Map(previous.slots.map((slot) => [slot.slotId, slot.position]))
    const baselineBindings = bindings
      .filter((binding) => binding.instantiationId === baseline.id)
      .sort(
        (a, b) =>
          (slotPosition.get(a.sourceSlotId) ?? Number.MAX_SAFE_INTEGER) -
          (slotPosition.get(b.sourceSlotId) ?? Number.MAX_SAFE_INTEGER),
      )
    const selectedIds = new Set([...baselineBindings.map((binding) => binding.agentId), ...include])
    const slotByAgent = new Map(
      baselineBindings.map((binding) => [binding.agentId, binding.sourceSlotId]),
    )
    for (const id of selectedIds) {
      if (!slotByAgent.has(id)) slotByAgent.set(id, randomUUID())
    }
    const previousSlotById = new Map(previous.slots.map((slot) => [slot.slotId, slot]))
    const selectedMembers = [...selectedIds].map((id) => {
      const agent = memberById.get(id)
      if (!agent) throw new Error(`member_not_in_group: ${id}`)
      return agent
    })
    const template = teamTemplateRepo.replaceCanonicalDefinition(db, source.id, {
      expectedRevision: input.templateExpectedRevision,
      allowAllocatedSlotIds: true,
      slots: selectedMembers.map((agent) => {
        const slotId = slotByAgent.get(agent.id)
        const old = slotId ? previousSlotById.get(slotId) : undefined
        return {
          slotId,
          profileId: agent.profileId,
          agentName: agent.name,
          modelOverride: agent.modelOverride,
          reasoningLevel: agent.reasoningLevel,
          layoutPosition: old?.layoutPosition ?? null,
          display: old?.display ?? null,
        }
      }),
      edges: teamPolicyRepo
        .edges(db, teamId)
        .filter(
          (edge) =>
            (edge.sourceKind !== 'agent' || selectedIds.has(edge.sourceId ?? '')) &&
            (edge.targetKind !== 'agent' || selectedIds.has(edge.targetId ?? '')),
        )
        .map((edge) => ({
          sourceKind: edge.sourceKind === 'agent' ? 'slot' : edge.sourceKind,
          sourceId: edge.sourceKind === 'agent' ? slotByAgent.get(edge.sourceId ?? '') : null,
          targetKind: edge.targetKind === 'agent' ? 'slot' : edge.targetKind,
          targetId: edge.targetKind === 'agent' ? slotByAgent.get(edge.targetId ?? '') : null,
        })),
    })
    db.raw.run('UPDATE template_instantiations SET template_revision = ? WHERE id = ?', [
      template.template.currentRevision,
      baseline.id,
    ])
    for (const id of include) {
      const oldBinding = bindings.find((binding) => binding.agentId === id)
      if (oldBinding?.instantiationId === baseline.id) continue
      if (oldBinding) {
        db.raw.run('DELETE FROM source_slot_bindings WHERE agent_id = ?', [id])
      }
      db.raw.run(
        `INSERT INTO source_slot_bindings (agent_id, instantiation_id, source_slot_id)
         VALUES (?, ?, ?)`,
        [id, baseline.id, slotByAgent.get(id)],
      )
      if (oldBinding)
        pruneEmptyNonbaselineInstantiation(db, oldBinding.instantiationId, baseline.id)
    }
    teamPolicyRepo.bumpRevision(db, teamId)
    const team = teamPolicyRepo.detail(db, teamId)
    if (!team) throw new Error(`team_policy_missing: ${teamId}`)
    return { template, team }
  })()
}

function pruneEmptyNonbaselineInstantiation(
  db: BazilionDb,
  instantiationId: string,
  baselineId: string,
): void {
  if (instantiationId === baselineId) return
  const remaining =
    db.raw
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM source_slot_bindings WHERE instantiation_id = ?',
      )
      .get(instantiationId)?.count ?? 0
  if (remaining === 0) {
    db.raw.run('DELETE FROM template_instantiations WHERE id = ?', [instantiationId])
  }
}
