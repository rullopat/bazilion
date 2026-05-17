import type { BazilionDb } from '../db/client.ts'
import * as agentRepo from '../repos/agents.ts'

export function unarchiveAgent(db: BazilionDb, id: string): void {
  const agent = agentRepo.get(db, id)
  if (!agent) throw new Error(`agent not found: ${id}`)
  if (agent.status !== 'archived') {
    throw new Error(`agent is not archived (status: ${agent.status})`)
  }
  agentRepo.unarchive(db, agent.id)
}
