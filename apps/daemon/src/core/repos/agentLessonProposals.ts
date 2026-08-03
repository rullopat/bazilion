import { randomUUID } from 'node:crypto'
import type {
  AgentLessonEvidence,
  AgentLessonProposal,
  AgentLessonScope,
  AgentLessonStatus,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawProposal {
  id: string
  review_id: string
  agent_id: string
  scope: string
  text: string
  evidence_json: string
  status: string
  version: number
  decided_at: number | null
  revoked_at: number | null
  applied_key: string | null
  created_at: number
  updated_at: number
}

function toProposal(row: RawProposal): AgentLessonProposal {
  return {
    id: row.id,
    reviewId: row.review_id,
    agentId: row.agent_id,
    scope: row.scope as AgentLessonScope,
    text: row.text,
    evidence: JSON.parse(row.evidence_json) as AgentLessonEvidence[],
    status: row.status as AgentLessonStatus,
    version: row.version,
    decidedAt: row.decided_at,
    revokedAt: row.revoked_at,
    appliedKey: row.applied_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function insert(
  db: BazilionDb,
  input: {
    reviewId: string
    agentId: string
    scope: AgentLessonScope
    text: string
    evidence: AgentLessonEvidence[]
    now?: number
  },
): AgentLessonProposal {
  const now = input.now ?? Date.now()
  const id = randomUUID()
  db.raw.run(
    `INSERT INTO agent_lesson_proposals
       (id, review_id, agent_id, scope, text, evidence_json, status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
    [
      id,
      input.reviewId,
      input.agentId,
      input.scope,
      input.text.trim(),
      JSON.stringify(input.evidence),
      now,
      now,
    ],
  )
  const proposal = get(db, id)
  if (!proposal) throw new Error('lesson proposal insert failed')
  return proposal
}

export function get(db: BazilionDb, id: string): AgentLessonProposal | null {
  const row = db.raw
    .query<RawProposal, [string]>('SELECT * FROM agent_lesson_proposals WHERE id = ?')
    .get(id)
  return row ? toProposal(row) : null
}

export function listForReview(db: BazilionDb, reviewId: string): AgentLessonProposal[] {
  return db.raw
    .query<RawProposal, [string]>(
      'SELECT * FROM agent_lesson_proposals WHERE review_id = ? ORDER BY created_at ASC',
    )
    .all(reviewId)
    .map(toProposal)
}

export function listForAgent(
  db: BazilionDb,
  agentId: string,
  options: { status?: AgentLessonStatus; limit?: number } = {},
): AgentLessonProposal[] {
  const limit = options.limit ?? 100
  const rows = options.status
    ? db.raw
        .query<RawProposal, [string, AgentLessonStatus, number]>(
          `SELECT * FROM agent_lesson_proposals WHERE agent_id = ? AND status = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(agentId, options.status, limit)
    : db.raw
        .query<RawProposal, [string, number]>(
          `SELECT * FROM agent_lesson_proposals WHERE agent_id = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(agentId, limit)
  return rows.map(toProposal)
}
