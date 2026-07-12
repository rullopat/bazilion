import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Agent, TeamPolicyPlacement } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import * as teamPolicyRepo from '../repos/teamPolicies.ts'
import * as teamRepo from '../repos/teams.ts'

export function moveAgentCanonical(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
  input: {
    destinationTeamId: string
    sourceExpectedRevision: number
    destinationExpectedRevision: number
    placement: Exclude<TeamPolicyPlacement, 'template_snapshot'>
  },
): Agent {
  const agent = agentRepo.get(db, agentId)
  if (!agent) throw new Error(`agent not found: ${agentId}`)
  if (!teamRepo.get(db, input.destinationTeamId, paths)) {
    throw new Error(`team not found: ${input.destinationTeamId}`)
  }
  if (agent.teamId === input.destinationTeamId) return agent
  const metadataPath = join(agent.dir, 'agent.json')
  const beforeMetadata = readFileSync(metadataPath, 'utf8')
  try {
    return db.raw.transaction(() => {
      const current = agentRepo.get(db, agent.id)
      if (!current || current.teamId !== agent.teamId) {
        throw new Error(`team_revision_conflict: Agent membership changed for ${agent.id}`)
      }
      const source = teamPolicyRepo.get(db, current.teamId)
      const destination = teamPolicyRepo.get(db, input.destinationTeamId)
      if (!source || !destination) throw new Error('team_policy_missing')
      if (source.revision !== input.sourceExpectedRevision) {
        throw new Error(
          `source_team_revision_conflict: expected ${input.sourceExpectedRevision}, current ${source.revision}`,
        )
      }
      if (destination.revision !== input.destinationExpectedRevision) {
        throw new Error(
          `destination_team_revision_conflict: expected ${input.destinationExpectedRevision}, current ${destination.revision}`,
        )
      }
      db.raw.run(
        `DELETE FROM team_policy_edges WHERE team_id = ? AND
         ((source_kind = 'agent' AND source_id = ?) OR (target_kind = 'agent' AND target_id = ?))`,
        [current.teamId, current.id, current.id],
      )
      db.raw.run('DELETE FROM team_agent_state WHERE agent_id = ?', [current.id])
      pruneBindingAndEmptyCohort(db, current.id, current.teamId)
      agentRepo.setGroup(db, current.id, input.destinationTeamId)
      const metadata = JSON.parse(beforeMetadata) as Record<string, unknown>
      metadata.teamId = input.destinationTeamId
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
      teamPolicyRepo.insertAgentState(db, input.destinationTeamId, current.id)
      teamPolicyRepo.addPlacementEdges(
        db,
        input.destinationTeamId,
        current.id,
        input.placement,
        current.profileId,
      )
      teamPolicyRepo.bumpRevision(db, current.teamId)
      teamPolicyRepo.bumpRevision(db, input.destinationTeamId)
      const moved = agentRepo.get(db, current.id)
      if (!moved) throw new Error(`agent vanished after move: ${current.id}`)
      return moved
    })()
  } catch (error) {
    writeFileSync(metadataPath, beforeMetadata)
    throw error
  }
}

export function pruneBindingAndEmptyCohort(db: BazilionDb, agentId: string, teamId: string): void {
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
  const baseline = teamPolicyRepo.get(db, teamId)?.baselineInstantiationId
  if (remaining === 0 && baseline !== binding.instantiation_id) {
    db.raw.run('DELETE FROM template_instantiations WHERE id = ?', [binding.instantiation_id])
  }
}
