import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import * as agentRepo from '../repos/agents.ts'

export function archiveAgent(db: BazilionDb, id: string): void {
  const agent = agentRepo.get(db, id)
  if (!agent) throw new DomainError(404, `agent not found: ${id}`)
  agentRepo.archive(db, agent.id)
}
