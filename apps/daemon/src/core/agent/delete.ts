import { randomUUID } from 'node:crypto'
import { existsSync, renameSync, rmSync } from 'node:fs'
import type { BazilionDb } from '../db/client.ts'
import * as agentRepo from '../repos/agents.ts'
import * as liveHarnessRepo from '../repos/liveHarnesses.ts'
import { pruneBindingAndEmptyCohort } from './move.ts'

export function deleteAgent(db: BazilionDb, id: string): void {
  const agent = agentRepo.get(db, id)
  if (!agent) throw new Error(`agent not found: ${id}`)
  const fullId = agent.id
  liveHarnessRepo.requireCompatibilityOpen(db, agent.groupId)
  const stagedDir = `${agent.dir}.deleting-${randomUUID()}`
  const hadDir = existsSync(agent.dir)
  if (hadDir) renameSync(agent.dir, stagedDir)

  try {
    db.raw.transaction(() => {
      liveHarnessRepo.requireCompatibilityOpen(db, agent.groupId)
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
      db.raw.run('DELETE FROM messages WHERE from_agent_id = ? OR to_agent_id = ?', [
        fullId,
        fullId,
      ])
      pruneBindingAndEmptyCohort(db, fullId, agent.groupId)
      agentRepo.remove(db, fullId)
      liveHarnessRepo.regenerateExactOpen(db, agent.groupId)
    })()
  } catch (error) {
    if (hadDir && existsSync(stagedDir)) renameSync(stagedDir, agent.dir)
    throw error
  }

  if (hadDir && existsSync(stagedDir)) {
    rmSync(stagedDir, { recursive: true, force: true })
  }
}
