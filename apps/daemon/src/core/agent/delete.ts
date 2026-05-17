import { existsSync, rmSync } from 'node:fs'
import type { BazilionDb } from '../db/client.ts'
import * as agentRepo from '../repos/agents.ts'

export function deleteAgent(db: BazilionDb, id: string): void {
  const agent = agentRepo.get(db, id)
  if (!agent) throw new Error(`agent not found: ${id}`)
  const fullId = agent.id

  db.raw.transaction(() => {
    // messages.from_agent_id and to_agent_id reference agents(id) with no ON
    // DELETE rule, and messages.reply_to references messages(id) the same way,
    // so a naive DELETE of the agent fails if it has any mailbox history.
    // Null out inbound reply pointers to this agent's messages, then purge the
    // messages themselves, then let agentRepo.remove cascade the rest
    // (agent_skills, runs, events). agents.group_id is `ON DELETE RESTRICT`
    // from the group side, but the agent row itself goes away freely.
    db.raw.run(
      `UPDATE messages SET reply_to = NULL
         WHERE reply_to IN (SELECT id FROM messages WHERE from_agent_id = ? OR to_agent_id = ?)`,
      [fullId, fullId],
    )
    db.raw.run('DELETE FROM messages WHERE from_agent_id = ? OR to_agent_id = ?', [fullId, fullId])
    agentRepo.remove(db, fullId)
  })()

  if (existsSync(agent.dir)) {
    rmSync(agent.dir, { recursive: true, force: true })
  }
}
