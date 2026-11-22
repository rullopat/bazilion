import type {
  AttentionDegradedSource,
  AttentionItem,
  AttentionKind,
  AttentionListResponse,
  AttentionRecordedKind,
  AttentionState,
  AttentionSummary,
} from '@bazilion/api-types'
import type { BazilionDb } from './db/client.ts'
import { DomainError } from './errors.ts'
import { INTERRUPTED_BY_RESTART } from './repos/user-queue.ts'

/** Kinds kept in the database until they are dealt with; Telegram can notify about these. */
export const RECORDED_ATTENTION_KINDS = [
  'lesson_proposal',
  'review_failure',
  'trigger_failure',
  'agent_loop_break',
  'queue_interrupted',
] as const satisfies readonly AttentionRecordedKind[]

/** An Agent waiting on the operator: held in memory while its turn waits (lib/attention-waiting). */
export const WAITING_ATTENTION_KINDS = [
  'agent_question',
  'command_approval',
] as const satisfies readonly AttentionKind[]

export const ATTENTION_KINDS = [
  ...WAITING_ATTENTION_KINDS,
  ...RECORDED_ATTENTION_KINDS,
] as const satisfies readonly AttentionKind[]

const isWaitingKind = (kind: AttentionKind): boolean =>
  (WAITING_ATTENTION_KINDS as readonly AttentionKind[]).includes(kind)

type RawItem = Omit<AttentionItem, 'key' | 'acknowledgedAt'> & { acknowledged_at: number | null }
type Source = { kind: AttentionRecordedKind; query: (db: BazilionDb) => RawItem[] }
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
interface QueueInterruptedSourceRow extends BaseSourceRow {
  interrupted_count: number
  waiting_count: number
}

export const bounded = (value: string | null, fallback: string): string =>
  (value?.trim() || fallback)
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .slice(0, 500)

/** The Agent's conversation in the web workspace, with one of its sheets open over it. */
function agentHref(agentId: string | undefined, section?: 'learning' | 'schedules' | 'mailbox') {
  const query = new URLSearchParams({ agent: agentId ?? '' })
  if (section) query.set('section', section)
  return `/?${query}`
}

const sources: Source[] = [
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
            href: agentHref(r.agentId, 'learning'),
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
            href: agentHref(r.agentId, 'learning'),
            acknowledgeable: true,
          }),
        ),
  },
  {
    kind: 'trigger_failure',
    query: (db) =>
      db.raw
        .query<DiagnosticSourceRow, []>(`SELECT d.id sourceId, d.scheduled_at occurredAt,
        COALESCE(d.finished_at, d.scheduled_at) updatedAt,
        d.agent_id agentId, a.name agentName, a.team_id teamId, t.name teamName,
        d.error diagnostic, aa.acknowledged_at FROM trigger_dispatches d
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
            diagnostic: bounded(r.diagnostic, 'The scheduled Agent turn failed.'),
            href: agentHref(r.agentId, 'schedules'),
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
            href: agentHref(r.agentId, 'mailbox'),
            acknowledgeable: true,
          }),
        ),
  },
  {
    kind: 'queue_interrupted',
    query: (db) =>
      // A daemon restart fails the follow-up it interrupted and pauses that queue until the owner
      // resumes it. Without this item the pause is invisible. Resuming clears it.
      db.raw
        .query<QueueInterruptedSourceRow, [string, string]>(
          `SELECT 'queue:' || c.agent_id sourceId,
          COALESCE((SELECT MAX(q.updated_at) FROM user_queue_items q WHERE q.agent_id = c.agent_id), a.created_at) occurredAt,
          COALESCE((SELECT MAX(q.updated_at) FROM user_queue_items q WHERE q.agent_id = c.agent_id), a.created_at) updatedAt,
          c.agent_id agentId, a.name agentName, a.team_id teamId, t.name teamName,
          (SELECT COUNT(*) FROM user_queue_items q WHERE q.agent_id = c.agent_id AND q.status = 'failed' AND q.diagnostic = ?) interrupted_count,
          (SELECT COUNT(*) FROM user_queue_items q WHERE q.agent_id = c.agent_id AND q.status = 'pending') waiting_count,
          NULL acknowledged_at
          FROM user_queue_controls c
          JOIN agents a ON a.id = c.agent_id JOIN teams t ON t.id = a.team_id
          WHERE c.paused = 1 AND EXISTS (SELECT 1 FROM user_queue_items q
            WHERE q.agent_id = c.agent_id AND q.status = 'failed' AND q.diagnostic = ?)`,
        )
        .all(INTERRUPTED_BY_RESTART, INTERRUPTED_BY_RESTART)
        .map(
          (r): RawItem => ({
            ...r,
            kind: 'queue_interrupted',
            severity: 'action_required',
            title: 'Agent queue paused after a daemon restart',
            diagnostic: `The daemon restarted during a follow-up, which was not run again (${r.interrupted_count} interrupted). ${r.waiting_count} follow-up${r.waiting_count === 1 ? ' waits' : 's wait'} in the paused queue: check them, then resume the queue.`,
            href: agentHref(r.agentId),
            acknowledgeable: false,
          }),
        ),
  },
]

function normalize(row: RawItem): AttentionItem {
  const { acknowledged_at, ...item } = row
  return { ...item, key: `${item.kind}:${item.sourceId}`, acknowledgedAt: acknowledged_at }
}

function parseAttentionKey(key: string): { kind: AttentionKind; sourceId: string } | null {
  const at = key.indexOf(':')
  const kind = key.slice(0, at) as AttentionKind
  const sourceId = key.slice(at + 1)
  return at > 0 && ATTENTION_KINDS.includes(kind) && sourceId ? { kind, sourceId } : null
}

/**
 * Everything open or acknowledged, newest first; `waiting` (questions and command approvals, which
 * only the daemon process knows) comes before the rest, the one that expires soonest first.
 */
export function projectAttention(
  db: BazilionDb,
  options: { state?: AttentionState; kind?: AttentionKind; limit?: number } = {},
  waiting: readonly AttentionItem[] = [],
): AttentionListResponse {
  const degraded: AttentionDegradedSource[] = []
  const recorded = sources.flatMap((source) => {
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
  // A waiting item is never acknowledged: it is answered, or it stops waiting.
  const now = (state === 'acknowledged' ? [] : waiting)
    .filter((item) => !options.kind || item.kind === options.kind)
    .toSorted(
      (a, b) =>
        (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY) ||
        a.key.localeCompare(b.key),
    )
  const rest = recorded
    .filter(
      (item) =>
        state === 'all' ||
        (state === 'acknowledged' ? item.acknowledgedAt !== null : item.acknowledgedAt === null),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
  return {
    items: [...now, ...rest].slice(0, Math.max(options.limit ?? 100, 1)),
    degraded,
  }
}

export function attentionSummary(
  db: BazilionDb,
  waiting: readonly AttentionItem[] = [],
): AttentionSummary {
  const projected = projectAttention(db, { state: 'open', limit: 100_000 }, waiting)
  return summarizeAttention(projected.items, projected.degraded)
}

/** The counts of a projection's open items. */
export function summarizeAttention(
  items: readonly AttentionItem[],
  degraded: AttentionDegradedSource[],
): AttentionSummary {
  const open = items.filter((item) => item.acknowledgedAt === null)
  const bySeverity = { action_required: 0, error: 0, warning: 0 }
  const byKind = Object.fromEntries(ATTENTION_KINDS.map((kind) => [kind, 0])) as Record<
    AttentionKind,
    number
  >
  for (const item of open) {
    bySeverity[item.severity]++
    byKind[item.kind]++
  }
  return { openTotal: open.length, bySeverity, byKind, degraded }
}

export function acknowledgeAttention(
  db: BazilionDb,
  key: string,
  acknowledged: boolean,
): AttentionItem {
  const parsed = parseAttentionKey(key)
  if (!parsed) throw new DomainError(400, 'invalid attention key')
  if (isWaitingKind(parsed.kind))
    throw new DomainError(409, 'action-required items must be resolved at their source')
  const current = projectAttention(db, {
    state: 'all',
    kind: parsed.kind,
    limit: 100_000,
  }).items.find((item) => item.sourceId === parsed.sourceId)
  if (!current) throw new DomainError(404, 'attention source not found or no longer eligible')
  if (!current.acknowledgeable)
    throw new DomainError(409, 'action-required items must be resolved at their source')
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
  if (!updated) throw new DomainError(404, 'attention source not found or no longer eligible')
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
