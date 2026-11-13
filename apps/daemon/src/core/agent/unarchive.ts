import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import * as agentRepo from '../repos/agents.ts'

export function unarchiveAgent(db: BazilionDb, id: string): void {
  const agent = agentRepo.get(db, id)
  if (!agent) throw new DomainError(404, `agent not found: ${id}`)
  if (agent.status !== 'archived') {
    throw new DomainError(400, `agent is not archived (status: ${agent.status})`)
  }
  agentRepo.unarchive(db, agent.id)
}
