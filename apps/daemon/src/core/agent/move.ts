import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent, HarnessPlacement } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import * as groupRepo from '../repos/groups.ts'
import * as liveHarnessRepo from '../repos/liveHarnesses.ts'

export function moveAgentCompatibility(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
  destinationGroupId: string,
): Agent {
  const agent = agentRepo.get(db, agentId)
  if (!agent) throw new Error(`agent not found: ${agentId}`)
  if (!groupRepo.get(db, destinationGroupId, paths)) {
    throw new Error(`group not found: ${destinationGroupId}`)
  }
  if (agent.groupId === destinationGroupId) return agent
  liveHarnessRepo.requireCompatibilityOpen(db, agent.groupId)
  liveHarnessRepo.requireCompatibilityOpen(db, destinationGroupId)

  const metadataPath = join(agent.dir, 'agent.json')
  const beforeMetadata = readFileSync(metadataPath, 'utf8')
  try {
    return db.raw.transaction(() => {
      const current = agentRepo.get(db, agent.id)
      if (!current || current.groupId !== agent.groupId) {
        throw new Error(`group_revision_conflict: Agent membership changed for ${agent.id}`)
      }
      liveHarnessRepo.requireCompatibilityOpen(db, current.groupId)
      liveHarnessRepo.requireCompatibilityOpen(db, destinationGroupId)
      pruneBindingAndEmptyCohort(db, agent.id, agent.groupId)
      agentRepo.setGroup(db, agent.id, destinationGroupId)
      const metadata = JSON.parse(beforeMetadata) as Record<string, unknown>
      metadata.groupId = destinationGroupId
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
      liveHarnessRepo.regenerateExactOpen(db, agent.groupId)
      liveHarnessRepo.regenerateExactOpen(db, destinationGroupId)
      const moved = agentRepo.get(db, agent.id)
      if (!moved) throw new Error(`agent vanished after move: ${agent.id}`)
      return moved
    })()
  } catch (error) {
    writeFileSync(metadataPath, beforeMetadata)
    throw error
  }
}

export function moveAgentCanonical(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
  input: {
    destinationGroupId: string
    sourceExpectedRevision: number
    destinationExpectedRevision: number
    placement: Exclude<HarnessPlacement, 'template_snapshot'>
  },
): Agent {
  const agent = agentRepo.get(db, agentId)
  if (!agent) throw new Error(`agent not found: ${agentId}`)
  if (!groupRepo.get(db, input.destinationGroupId, paths)) {
    throw new Error(`group not found: ${input.destinationGroupId}`)
  }
  if (agent.groupId === input.destinationGroupId) return agent
  const metadataPath = join(agent.dir, 'agent.json')
  const beforeMetadata = readFileSync(metadataPath, 'utf8')
  try {
    return db.raw.transaction(() => {
      const current = agentRepo.get(db, agent.id)
      if (!current || current.groupId !== agent.groupId) {
        throw new Error(`group_revision_conflict: Agent membership changed for ${agent.id}`)
      }
      const source = liveHarnessRepo.get(db, current.groupId)
      const destination = liveHarnessRepo.get(db, input.destinationGroupId)
      if (!source || !destination) throw new Error('group_policy_missing')
      if (source.revision !== input.sourceExpectedRevision) {
        throw new Error(
          `source_group_revision_conflict: expected ${input.sourceExpectedRevision}, current ${source.revision}`,
        )
      }
      if (destination.revision !== input.destinationExpectedRevision) {
        throw new Error(
          `destination_group_revision_conflict: expected ${input.destinationExpectedRevision}, current ${destination.revision}`,
        )
      }
      db.raw.run(
        `DELETE FROM live_harness_edges WHERE group_id = ? AND
         ((source_kind = 'agent' AND source_id = ?) OR (target_kind = 'agent' AND target_id = ?))`,
        [current.groupId, current.id, current.id],
      )
      db.raw.run('DELETE FROM live_agent_state WHERE agent_id = ?', [current.id])
      pruneBindingAndEmptyCohort(db, current.id, current.groupId)
      agentRepo.setGroup(db, current.id, input.destinationGroupId)
      const metadata = JSON.parse(beforeMetadata) as Record<string, unknown>
      metadata.groupId = input.destinationGroupId
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
      liveHarnessRepo.insertAgentState(db, input.destinationGroupId, current.id)
      liveHarnessRepo.addPlacementEdges(
        db,
        input.destinationGroupId,
        current.id,
        input.placement,
        current.profileId,
      )
      liveHarnessRepo.bumpExplicit(db, current.groupId)
      liveHarnessRepo.bumpExplicit(db, input.destinationGroupId)
      const moved = agentRepo.get(db, current.id)
      if (!moved) throw new Error(`agent vanished after move: ${current.id}`)
      return moved
    })()
  } catch (error) {
    writeFileSync(metadataPath, beforeMetadata)
    throw error
  }
}

export function pruneBindingAndEmptyCohort(db: BazilionDb, agentId: string, groupId: string): void {
  const binding = db.raw
    .query<{ instantiation_id: string }, [string]>(
      'SELECT instantiation_id FROM source_slot_bindings WHERE agent_id = ?',
    )
    .get(agentId)
  if (!binding) return
  db.raw.run('DELETE FROM source_slot_bindings WHERE agent_id = ?', [agentId])
  const remaining =
    db.raw
      .query<{ count: number }, [string]>(
        'SELECT COUNT(*) AS count FROM source_slot_bindings WHERE instantiation_id = ?',
      )
      .get(binding.instantiation_id)?.count ?? 0
  const baseline = liveHarnessRepo.get(db, groupId)?.baselineInstantiationId
  if (remaining === 0 && baseline !== binding.instantiation_id) {
    db.raw.run('DELETE FROM template_instantiations WHERE id = ?', [binding.instantiation_id])
  }
}
