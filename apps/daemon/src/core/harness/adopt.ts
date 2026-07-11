import { randomUUID } from 'node:crypto'
import type { HarnessPlacement, LiveHarnessEdge, ResolvedGroupHarness } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import * as agentRepo from '../repos/agents.ts'
import * as harnessTemplateRepo from '../repos/harnessTemplates.ts'
import * as liveHarnessRepo from '../repos/liveHarnesses.ts'

type RemainingPlacement = Exclude<HarnessPlacement, 'template_snapshot'>

export interface AdoptHarnessTemplateInput {
  groupExpectedRevision: number
  templateId: string
  templateExpectedRevision: number
  slotMappings: Array<{ slotId: string; agentId: string }>
  remainingPlacements: Array<{ agentId: string; placement: RemainingPlacement }>
  previewEdges: Omit<LiveHarnessEdge, 'groupId'>[]
}

export function adoptHarnessTemplate(
  db: BazilionDb,
  groupId: string,
  input: AdoptHarnessTemplateInput,
): ResolvedGroupHarness {
  return db.raw.transaction(() => {
    const harness = liveHarnessRepo.get(db, groupId)
    if (!harness) throw new Error(`group_policy_missing: ${groupId}`)
    if (harness.revision !== input.groupExpectedRevision) {
      throw new Error(
        `group_revision_conflict: expected ${input.groupExpectedRevision}, current ${harness.revision}`,
      )
    }
    const template = harnessTemplateRepo.get(db, input.templateId)
    if (!template) throw new Error(`team template not found: ${input.templateId}`)
    if (template.deletedAt !== null) throw new Error(`template_deleted: ${input.templateId}`)
    if (template.currentRevision !== input.templateExpectedRevision) {
      throw new Error(
        `template_revision_conflict: expected ${input.templateExpectedRevision}, current ${template.currentRevision}`,
      )
    }
    const snapshot = harnessTemplateRepo.revision(db, template.id, input.templateExpectedRevision)
    if (!snapshot) throw new Error('template_snapshot_missing')
    const members = agentRepo
      .list(db, { includeArchived: true })
      .filter((agent) => agent.groupId === groupId)
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
        (item) =>
          item.placement !== 'isolated' &&
          item.placement !== 'open' &&
          item.placement !== 'profile_defaults',
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
    const resolved = resolveAdoptionEdges(db, snapshot.edges, mapping, placements, members)
    if (!sameEdges(resolved, input.previewEdges)) {
      throw new Error('adoption_preview_mismatch: reviewed preview does not match resolved policy')
    }

    db.raw.run('UPDATE live_harnesses SET baseline_instantiation_id = NULL WHERE group_id = ?', [
      groupId,
    ])
    db.raw.run(
      `DELETE FROM source_slot_bindings WHERE instantiation_id IN
       (SELECT id FROM template_instantiations WHERE group_id = ?)`,
      [groupId],
    )
    db.raw.run('DELETE FROM template_instantiations WHERE group_id = ?', [groupId])
    db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ?', [groupId])
    const instantiationId = randomUUID()
    db.raw.run(
      `INSERT INTO template_instantiations
         (id, group_id, template_id, template_revision, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [instantiationId, groupId, template.id, snapshot.revision, Date.now()],
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
        `INSERT INTO live_harness_edges
           (group_id, source_kind, source_id, target_kind, target_id)
         VALUES (?, ?, ?, ?, ?)`,
        [groupId, edge.sourceKind, edge.sourceId ?? '', edge.targetKind, edge.targetId ?? ''],
      )
    }
    db.raw.run('UPDATE live_harnesses SET baseline_instantiation_id = ? WHERE group_id = ?', [
      instantiationId,
      groupId,
    ])
    liveHarnessRepo.bumpExplicit(db, groupId)
    const result = liveHarnessRepo.detail(db, groupId)
    if (!result) throw new Error(`group_policy_missing: ${groupId}`)
    return result
  })()
}

function resolveAdoptionEdges(
  db: BazilionDb,
  templateEdges: Array<{
    sourceKind: 'user' | 'outside_group' | 'slot'
    sourceId: string | null
    targetKind: 'user' | 'outside_group' | 'slot'
    targetId: string | null
  }>,
  mapping: ReadonlyMap<string, string>,
  placements: ReadonlyMap<string, RemainingPlacement>,
  members: ReturnType<typeof agentRepo.list>,
): Omit<LiveHarnessEdge, 'groupId'>[] {
  const edgeMap = new Map<string, Omit<LiveHarnessEdge, 'groupId'>>()
  const add = (
    sourceKind: LiveHarnessEdge['sourceKind'],
    sourceId: string | null,
    targetKind: LiveHarnessEdge['targetKind'],
    targetId: string | null,
  ) => {
    const edge = { sourceKind, sourceId, targetKind, targetId }
    edgeMap.set(edgeKey(edge), edge)
  }
  for (const edge of templateEdges) {
    add(
      edge.sourceKind === 'slot' ? 'agent' : edge.sourceKind,
      edge.sourceKind === 'slot' ? (mapping.get(edge.sourceId ?? '') ?? null) : null,
      edge.targetKind === 'slot' ? 'agent' : edge.targetKind,
      edge.targetKind === 'slot' ? (mapping.get(edge.targetId ?? '') ?? null) : null,
    )
  }
  const mappedIds = new Set(mapping.values())
  const memberById = new Map(members.map((agent) => [agent.id, agent]))
  const requestsPeers = new Set<string>()
  for (const [agentId, placement] of placements) {
    const agent = memberById.get(agentId)
    if (!agent) continue
    if (placement === 'open') {
      add('user', null, 'agent', agentId)
      add('agent', agentId, 'user', null)
      add('outside_group', null, 'agent', agentId)
      add('agent', agentId, 'outside_group', null)
      requestsPeers.add(agentId)
    } else if (placement === 'profile_defaults') {
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
        .get(agent.profileId)
      if (defaults?.user_input) add('user', null, 'agent', agentId)
      if (defaults?.user_output) add('agent', agentId, 'user', null)
      if (defaults?.outside_group_input) add('outside_group', null, 'agent', agentId)
      if (defaults?.outside_group_output) add('agent', agentId, 'outside_group', null)
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
  actual: Omit<LiveHarnessEdge, 'groupId'>[],
  preview: Omit<LiveHarnessEdge, 'groupId'>[],
): boolean {
  const a = actual.map(edgeKey).sort()
  const b = preview.map(edgeKey).sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function edgeKey(edge: Omit<LiveHarnessEdge, 'groupId'>): string {
  return `${edge.sourceKind}:${edge.sourceId ?? ''}>${edge.targetKind}:${edge.targetId ?? ''}`
}
