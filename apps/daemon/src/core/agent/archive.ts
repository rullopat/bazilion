import type { BazilionDb } from '../db/client.ts'
import * as agentRepo from '../repos/agents.ts'

export function archiveAgent(db: BazilionDb, id: string): void {
  const agent = agentRepo.get(db, id)
  if (!agent) throw new Error(`agent not found: ${id}`)
  agentRepo.archive(db, agent.id)
}
