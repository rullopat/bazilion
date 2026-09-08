import type { AttentionItem } from '@bazilion/api-types'
import { agentRepo, authorizeInSnapshot, type BazilionDb } from '../core/index.ts'
import { teamPolicyEnforcementEnabled } from './communication.ts'

export type NotificationAuthorization =
  | { allowed: true; agentId: string; teamId: string }
  | { allowed: false; reason: 'source_unattributed' | 'source_changed' | 'policy_suppressed' }

/** Read-only policy evaluation: an operator notice must never create another approval. */
export function authorizeAttentionNotification(
  db: BazilionDb,
  item: AttentionItem,
  captured?: { agentId: string | null; teamId: string | null },
): NotificationAuthorization {
  return db.raw.transaction((): NotificationAuthorization => {
    if (!item.agentId || !item.teamId) return { allowed: false, reason: 'source_unattributed' }
    const agent = agentRepo.get(db, item.agentId)
    if (!agent || agent.status === 'archived' || agent.teamId !== item.teamId)
      return { allowed: false, reason: 'source_changed' }
    if (captured && (captured.agentId !== agent.id || captured.teamId !== agent.teamId))
      return { allowed: false, reason: 'source_changed' }
    if (teamPolicyEnforcementEnabled()) {
      const result = authorizeInSnapshot(db, {
        source: { kind: 'agent', id: agent.id },
        target: { kind: 'user', teamId: agent.teamId },
        origin: 'attention_notification',
        attemptKind: 'attention_notification',
        attemptId: item.key,
      })
      if (result.decision !== 'allow') return { allowed: false, reason: 'policy_suppressed' }
    }
    return { allowed: true, agentId: agent.id, teamId: agent.teamId }
  })()
}
