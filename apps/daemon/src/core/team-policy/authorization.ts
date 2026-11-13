import { OUTSIDE_TEAM } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import * as teamPolicyRepo from '../repos/teamPolicies.ts'

export type MessageDecision = { allowed: true } | { allowed: false; reason: string }

interface Endpoint {
  id: string
  name: string
  team_id: string
  status: string
}

/**
 * Team Policy for one Agent-to-Agent message. Inside a Team, an open mode allows
 * every message and a restricted mode needs an edge. Between Teams the sender's Team
 * needs `sender -> outside` and the recipient's Team needs `outside -> recipient`.
 */
export function mayMessage(db: BazilionDb, fromId: string, toId: string): MessageDecision {
  const find = (id: string) =>
    db.raw
      .query<Endpoint, [string]>('SELECT id, name, team_id, status FROM agents WHERE id = ?')
      .get(id)
  const from = find(fromId)
  const to = find(toId)
  if (!from) return { allowed: false, reason: `unknown sender Agent ${fromId}` }
  if (!to) return { allowed: false, reason: `unknown recipient Agent ${toId}` }
  if (from.id === to.id) return { allowed: false, reason: 'an Agent cannot message itself' }
  if (from.status === 'archived' || to.status === 'archived') {
    return { allowed: false, reason: 'archived Agents cannot send or receive messages' }
  }
  if (from.team_id === to.team_id) {
    if (teamPolicyRepo.mode(db, from.team_id) === 'open') return { allowed: true }
    if (teamPolicyRepo.hasEdge(db, from.team_id, from.id, to.id)) return { allowed: true }
    return {
      allowed: false,
      reason: `Team ${from.team_id} is restricted and has no edge from ${from.name} to ${to.name}`,
    }
  }
  if (!teamPolicyRepo.hasEdge(db, from.team_id, from.id, OUTSIDE_TEAM)) {
    return {
      allowed: false,
      reason: `Team ${from.team_id} has no edge from ${from.name} to other Teams`,
    }
  }
  if (!teamPolicyRepo.hasEdge(db, to.team_id, OUTSIDE_TEAM, to.id)) {
    return {
      allowed: false,
      reason: `Team ${to.team_id} has no edge from other Teams to ${to.name}`,
    }
  }
  return { allowed: true }
}
