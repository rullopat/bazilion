import type { Agent } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import type { Paths } from '../paths.ts'
import * as agentRepo from '../repos/agents.ts'
import * as teamPolicyRepo from '../repos/teamPolicies.ts'
import * as teamRepo from '../repos/teams.ts'

/** Move an Agent to another Team. Its old policy edges are removed; it joins with none. */
export function moveAgent(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
  destinationTeamId: string,
): Agent {
  const agent = agentRepo.get(db, agentId)
  if (!agent) throw new DomainError(404, `agent not found: ${agentId}`)
  if (!teamRepo.get(db, destinationTeamId, paths)) {
    throw new DomainError(404, `team not found: ${destinationTeamId}`)
  }
  if (agent.teamId === destinationTeamId) return agent
  return db.raw.transaction(() => {
    teamPolicyRepo.removeAgentEdges(db, agent.teamId, agent.id)
    agentRepo.setTeam(db, agent.id, destinationTeamId)
    const moved = agentRepo.get(db, agent.id)
    if (!moved) throw new Error(`agent vanished after move: ${agent.id}`)
    return moved
  })()
}
