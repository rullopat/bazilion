import type {
  AttentionDegradedSource,
  AttentionItem,
  AttentionKind,
  AttentionListResponse,
  AttentionState,
  AttentionSummary,
} from '@bazilion/api-types'
import type { BazilionDb } from './db/client.ts'

export const ATTENTION_KINDS = [
  'communication_approval',
  'lesson_proposal',
  'review_failure',
  'trigger_failure',
  'agent_loop_break',
] as const satisfies readonly AttentionKind[]

type RawItem = Omit<AttentionItem, 'key' | 'acknowledgedAt'> & { acknowledged_at: number | null }
type Source = { kind: AttentionKind; query: (db: BazilionDb) => RawItem[] }
interface BaseSourceRow {
  sourceId: string
  occurredAt: number
  updatedAt: number
  agentId?: string
  agentName?: string
  teamId?: string
  teamName?: string
  acknowledged_at: number | null
}
interface ReviewSourceRow extends BaseSourceRow {
  status: string
  diagnostic: string | null
}
interface DiagnosticSourceRow extends BaseSourceRow {
  diagnostic: string | null
}
interface LoopSourceRow extends BaseSourceRow {
  attempted_hop: number
  max_hops: number
}

const bounded = (value: string | null, fallback: string): string =>
  (value?.trim() || fallback)
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .slice(0, 500)

const sources: Source[] = [
  {
    kind: 'communication_approval',
    query: (db) =>
      db.raw
        .query<
          BaseSourceRow,
          []
        >(`SELECT ca.id sourceId, ca.created_at occurredAt, ca.updated_at updatedAt,
          COALESCE(ca.target_id, ca.source_id) agentId, a.name agentName,
          COALESCE(ca.target_team_id, ca.source_team_id) teamId, t.name teamName,
          NULL acknowledged_at
          FROM communication_approvals ca
          LEFT JOIN agents a ON a.id = COALESCE(NULLIF(ca.target_id,''), NULLIF(ca.source_id,''))
          LEFT JOIN teams t ON t.id = COALESCE(ca.target_team_id, ca.source_team_id)
          WHERE ca.status = 'pending' AND ca.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)`)
        .all()
        .map(
          (r): RawItem => ({
            ...r,
            kind: 'communication_approval',
            severity: 'action_required',
            title: 'Communication approval required',
            diagnostic: 'A policy-protected communication is waiting for an operator decision.',
            href: '/approvals',
            acknowledgeable: false,
          }),
        ),
  },
  {
    kind: 'lesson_proposal',
    query: (db) =>
      db.raw
        .query<
          BaseSourceRow,
          []
        >(`SELECT p.id sourceId, p.created_at occurredAt, p.updated_at updatedAt,
        p.agent_id agentId, a.name agentName, a.team_id teamId, t.name teamName, NULL acknowledged_at
        FROM agent_lesson_proposals p JOIN agents a ON a.id = p.agent_id
        JOIN teams t ON t.id = a.team_id
        WHERE p.status = 'pending'`)
        .all()
        .map(
          (r): RawItem => ({
            ...r,
            kind: 'lesson_proposal',
            severity: 'action_required',
            title: 'Lesson proposal ready',
            diagnostic: 'A reviewed-learning proposal is waiting for approval or rejection.',
            href: `/agents/${encodeURIComponent(r.agentId ?? '')}/learning`,
            acknowledgeable: false,
          }),
        ),
  },
  {
    kind: 'review_failure',
    query: (db) =>
      db.raw
        .query<
          ReviewSourceRow,
          []
        >(`SELECT r.id sourceId, r.created_at occurredAt, r.updated_at updatedAt,
        r.agent_id agentId, a.name agentName, a.team_id teamId, t.name teamName,
        r.status, r.last_error diagnostic, aa.acknowledged_at FROM agent_reviews r
        JOIN agents a ON a.id = r.agent_id JOIN teams t ON t.id = a.team_id
        LEFT JOIN attention_acknowledgements aa ON aa.source_kind = 'review_failure' AND aa.source_id = r.id
        WHERE r.status IN ('failed','cancelled')`)
        .all()
        .map(
          (r): RawItem => ({
            ...r,
            kind: 'review_failure',
            severity: 'error',
            title: r.status === 'cancelled' ? 'Agent review cancelled' : 'Agent review failed',
            diagnostic: bounded(r.diagnostic, 'The review stopped without completing.'),
            href: `/agents/${encodeURIComponent(r.agentId ?? '')}/learning`,
            acknowledgeable: true,
          }),
        ),
  },
  {
    kind: 'trigger_failure',
    query: (db) =>
      db.raw
        .query<
          DiagnosticSourceRow,
          []
        >(`SELECT d.id sourceId, d.scheduled_at occurredAt, d.updated_at updatedAt,
        d.agent_id agentId, a.name agentName, a.team_id teamId, t.name teamName,
        d.last_error diagnostic, aa.acknowledged_at FROM trigger_dispatches d
        JOIN agents a ON a.id = d.agent_id JOIN teams t ON t.id = a.team_id
        LEFT JOIN attention_acknowledgements aa ON aa.source_kind = 'trigger_failure' AND aa.source_id = d.id
        WHERE d.status = 'failed'`)
        .all()
        .map(
          (r): RawItem => ({
            ...r,
            kind: 'trigger_failure',
            severity: 'error',
            title: 'Scheduled trigger failed',
            diagnostic: bounded(r.diagnostic, 'The scheduled Agent turn exhausted its retries.'),
            href: `/agents/${encodeURIComponent(r.agentId ?? '')}`,
            acknowledgeable: true,
          }),
        ),
  },
  {
    kind: 'agent_loop_break',
    query: (db) =>
      db.raw
        .query<
          LoopSourceRow,
          []
        >(`SELECT e.id sourceId, e.created_at occurredAt, e.created_at updatedAt,
        e.from_agent_id agentId, a.name agentName, e.source_team_id teamId, t.name teamName,
        e.attempted_hop, e.max_hops, aa.acknowledged_at FROM agent_loop_break_events e
        JOIN agents a ON a.id = e.from_agent_id JOIN teams t ON t.id = e.source_team_id
        LEFT JOIN attention_acknowledgements aa ON aa.source_kind = 'agent_loop_break' AND aa.source_id = e.id`)
        .all()
        .map(
          (r): RawItem => ({
            ...r,
            kind: 'agent_loop_break',
            severity: 'warning',
            title: 'Agent message loop stopped',
            diagnostic: `Message chain stopped at hop ${r.attempted_hop} (limit ${r.max_hops}).`,
            href: `/agents/${encodeURIComponent(r.agentId ?? '')}/inbox`,
            acknowledgeable: true,
          }),
        ),
  },
]

function normalize(row: RawItem): AttentionItem {
  const { acknowledged_at, ...item } = row
  return { ...item, key: `${item.kind}:${item.sourceId}`, acknowledgedAt: acknowledged_at }
}

export function parseAttentionKey(key: string): { kind: AttentionKind; sourceId: string } | null {
  const at = key.indexOf(':')
  const kind = key.slice(0, at) as AttentionKind
  const sourceId = key.slice(at + 1)
  return at > 0 && ATTENTION_KINDS.includes(kind) && sourceId ? { kind, sourceId } : null
}

export function projectAttention(
  db: BazilionDb,
  options: { state?: AttentionState; kind?: AttentionKind; limit?: number } = {},
): AttentionListResponse {
  const degraded: AttentionDegradedSource[] = []
  const items = sources.flatMap((source) => {
    if (options.kind && source.kind !== options.kind) return []
    try {
      return source.query(db).map(normalize)
    } catch (error) {
      degraded.push({
        kind: source.kind,
        error: bounded(error instanceof Error ? error.message : String(error), 'Projection failed'),
      })
      return []
    }
  })
  const state = options.state ?? 'open'
  return {
    items: items
      .filter(
        (item) =>
          state === 'all' ||
          (state === 'acknowledged' ? item.acknowledgedAt !== null : item.acknowledgedAt === null),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
      .slice(0, Math.max(options.limit ?? 100, 1)),
    degraded,
  }
}

export function attentionSummary(db: BazilionDb): AttentionSummary {
  const projected = projectAttention(db, { state: 'open', limit: 100_000 })
  const bySeverity = { action_required: 0, error: 0, warning: 0 }
  const byKind = Object.fromEntries(ATTENTION_KINDS.map((kind) => [kind, 0])) as Record<
    AttentionKind,
    number
  >
  for (const item of projected.items) {
    bySeverity[item.severity]++
    byKind[item.kind]++
  }
  return { openTotal: projected.items.length, bySeverity, byKind, degraded: projected.degraded }
}

export function acknowledgeAttention(
  db: BazilionDb,
  key: string,
  acknowledged: boolean,
): AttentionItem {
  const parsed = parseAttentionKey(key)
  if (!parsed) throw new Error('invalid_attention_key')
  const current = projectAttention(db, {
    state: 'all',
    kind: parsed.kind,
    limit: 100_000,
  }).items.find((item) => item.sourceId === parsed.sourceId)
  if (!current) throw new Error('attention_source_not_found')
  if (!current.acknowledgeable) throw new Error('attention_action_required')
  if (acknowledged)
    db.raw.run(
      `INSERT INTO attention_acknowledgements (source_kind, source_id, acknowledged_at) VALUES (?, ?, ?) ON CONFLICT(source_kind, source_id) DO NOTHING`,
      [parsed.kind, parsed.sourceId, Date.now()],
    )
  else
    db.raw.run('DELETE FROM attention_acknowledgements WHERE source_kind = ? AND source_id = ?', [
      parsed.kind,
      parsed.sourceId,
    ])
  const updated = projectAttention(db, {
    state: 'all',
    kind: parsed.kind,
    limit: 100_000,
  }).items.find((item) => item.sourceId === parsed.sourceId)
  if (!updated) throw new Error('attention_source_not_found')
  return updated
}

export function acknowledgeAllAttention(db: BazilionDb): number {
  return db.raw.transaction(() => {
    const items = projectAttention(db, { state: 'open', limit: 100_000 }).items.filter(
      (item) => item.acknowledgeable,
    )
    const now = Date.now()
    for (const item of items)
      db.raw.run(
        `INSERT INTO attention_acknowledgements (source_kind, source_id, acknowledged_at) VALUES (?, ?, ?) ON CONFLICT(source_kind, source_id) DO NOTHING`,
        [item.kind, item.sourceId, now],
      )
    return items.length
  })()
}
