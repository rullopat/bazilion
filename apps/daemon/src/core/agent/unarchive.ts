import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import * as agentRepo from '../repos/agents.ts'

export function unarchiveAgent(db: BazilionDb, id: string): void {
  const agent = agentRepo.get(db, id)
  if (!agent) throw new DomainError(404, `agent not found: ${id}`)
  if (agent.status !== 'archived') {
    throw new DomainError(400, `agent is not archived (status: ${agent.status})`)
  }
  // While it was archived, another Agent of its Team may have taken its name.
  if (agentRepo.nameTakenInTeam(db, agent.teamId, agent.name, agent.id)) {
    throw new DomainError(
      409,
      `Its Team now has another Agent named ${agent.name}: rename one of them first.`,
    )
  }
  agentRepo.unarchive(db, agent.id)
}
