import type { BazilionDb } from '../db/client.ts'

export interface ImageOperation {
  agentId: string
  teamId: string
  sessionId: string
  toolCallId: string
  turnId: string
  requestSha256: string
  model: string
}

/** Intent survives crashes/restores. There is deliberately no resumable/pending queue state. */
export function admit(db: BazilionDb, op: ImageOperation): 'new' | 'completed' {
  return db.raw.transaction(() => {
    const previous = db.raw
      .query<
        {
          team_id: string
          request_sha256: string
          model: string
          outcome: string
        },
        string[]
      >(`SELECT team_id, request_sha256, model, outcome FROM image_generations
      WHERE agent_id = ? AND session_id = ? AND tool_call_id = ?`)
      .get(op.agentId, op.sessionId, op.toolCallId)
    if (previous) {
      if (
        previous.team_id !== op.teamId ||
        previous.request_sha256 !== op.requestSha256 ||
        previous.model !== op.model
      ) {
        throw new Error('Image operation retry does not match its captured request')
      }
      if (previous.outcome === 'completed') return 'completed'
      throw new Error(
        `Image operation is ${previous.outcome}; it will not be automatically regenerated. It may have been billed.`,
      )
    }
    const uncertain =
      db.raw
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM image_generations WHERE turn_id = ? AND outcome = 'uncertain'",
        )
        .get(op.turnId)?.n ?? 0
    if (uncertain > 0)
      throw new Error(
        'A previous image request is uncertain. Generation is blocked for the rest of this turn; inspect Results before starting a new turn.',
      )
    const count =
      db.raw
        .query<{ n: number }, [string]>(
          'SELECT count(*) AS n FROM image_generations WHERE turn_id = ?',
        )
        .get(op.turnId)?.n ?? 0
    if (count >= 4) throw new Error('Image generation limit reached (four requests per turn)')
    db.raw.run(
      `INSERT INTO image_generations
      (agent_id, team_id, session_id, tool_call_id, turn_id, request_sha256, model, outcome, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'uncertain', ?)`,
      [
        op.agentId,
        op.teamId,
        op.sessionId,
        op.toolCallId,
        op.turnId,
        op.requestSha256,
        op.model,
        Date.now(),
      ],
    )
    return 'new'
  })()
}

export function settle(
  db: BazilionDb,
  op: ImageOperation,
  outcome: 'completed' | 'failed',
  responseId: string | null = null,
  usage: string | null = null,
): void {
  const { changes } = db.raw.run(
    `UPDATE image_generations
    SET outcome = ?, response_id = ?, usage_json = ?
    WHERE agent_id = ? AND session_id = ? AND tool_call_id = ? AND outcome = 'uncertain'`,
    [outcome, responseId, usage, op.agentId, op.sessionId, op.toolCallId],
  )
  if (changes !== 1) throw new Error('Image operation is no longer available')
}

export function resultIds(db: BazilionDb, op: ImageOperation): string[] {
  return db.raw
    .query<{ id: string }, string[]>(`SELECT id FROM agent_results
    WHERE agent_id = ? AND team_id = ? AND session_id = ? AND tool_call_id = ?
    AND source_kind = 'session_tool' ORDER BY source_index`)
    .all(op.agentId, op.teamId, op.sessionId, op.toolCallId)
    .map((row) => row.id)
}
