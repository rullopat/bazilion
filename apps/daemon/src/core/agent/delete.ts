import { randomUUID } from 'node:crypto'
import { existsSync, renameSync, rmSync } from 'node:fs'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import * as agentRepo from '../repos/agents.ts'
import * as teamPolicyRepo from '../repos/teamPolicies.ts'

export function deleteAgent(db: BazilionDb, id: string): void {
  const agent = agentRepo.get(db, id)
  if (!agent) throw new DomainError(404, `agent not found: ${id}`)
  const fullId = agent.id
  const stagedDir = `${agent.dir}.deleting-${randomUUID()}`
  const hadDir = existsSync(agent.dir)
  if (hadDir) renameSync(agent.dir, stagedDir)

  try {
    db.raw.transaction(() => {
      // messages.from_agent_id and to_agent_id reference agents(id) with no ON
      // DELETE rule, and messages.reply_to references messages(id) the same way,
      // so a naive DELETE of the agent fails if it has any mailbox history.
      // Null out inbound reply pointers to this agent's messages, then purge the
      // messages themselves, then let agentRepo.remove cascade the rest
      // (agent_skills and other agent-owned rows). agents.team_id is `ON DELETE RESTRICT`
      // from the team side, but the agent row itself goes away freely.
      db.raw.run(
        `UPDATE messages SET reply_to = NULL
         WHERE reply_to IN (SELECT id FROM messages WHERE from_agent_id = ? OR to_agent_id = ?)`,
        [fullId, fullId],
      )
      db.raw.run('DELETE FROM messages WHERE from_agent_id = ? OR to_agent_id = ?', [
        fullId,
        fullId,
      ])
      teamPolicyRepo.removeAgentEdges(db, agent.teamId, fullId)
      agentRepo.remove(db, fullId)
    })()
  } catch (error) {
    if (hadDir && existsSync(stagedDir)) renameSync(stagedDir, agent.dir)
    throw error
  }

  if (hadDir && existsSync(stagedDir)) {
    rmSync(stagedDir, { recursive: true, force: true })
  }
}
