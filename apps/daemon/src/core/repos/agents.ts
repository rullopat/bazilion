import { join } from 'node:path'
import type {
  Agent,
  AgentSkillAttachment,
  AgentStatus,
  ReasoningLevel,
  TelegramMirrorMode,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { orderedIds } from './teams.ts'

interface RawAgent {
  id: string
  profile_id: string
  name: string
  model_override: string | null
  reasoning_level: string
  status: string
  team_id: string
  telegram_topic_id: number | null
  telegram_mirror_mode: string
  telegram_icon_emoji: string | null
  created_at: number
  archived_at: number | null
}

function toAgent(db: BazilionDb, r: RawAgent): Agent {
  return {
    id: r.id,
    profileId: r.profile_id,
    name: r.name,
    modelOverride: r.model_override,
    reasoningLevel: r.reasoning_level as ReasoningLevel,
    status: r.status as AgentStatus,
    dir: agentDir(db, r.id),
    teamId: r.team_id,
    telegramTopicId: r.telegram_topic_id,
    telegramMirrorMode: (r.telegram_mirror_mode ?? 'minimal') as TelegramMirrorMode,
    telegramIconEmoji: r.telegram_icon_emoji ?? null,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
  }
}

function agentDir(db: BazilionDb, id: string): string {
  return join(db.home, 'agents', id)
}

/** Insert an Agent row; every other column starts at its schema default. */
export function insert(
  db: BazilionDb,
  a: Pick<
    Agent,
    'id' | 'profileId' | 'name' | 'modelOverride' | 'reasoningLevel' | 'status' | 'teamId'
  >,
): Agent {
  // A new Agent goes at the end of its Team.
  db.raw.run(
    `INSERT INTO agents (id, profile_id, name, model_override, reasoning_level, status, team_id, created_at, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${END_OF_TEAM})`,
    [
      a.id,
      a.profileId,
      a.name,
      a.modelOverride,
      a.reasoningLevel,
      a.status,
      a.teamId,
      Date.now(),
      a.teamId,
    ],
  )
  const agent = get(db, a.id)
  if (!agent) throw new Error(`agent insert failed: ${a.id}`)
  return agent
}

export function setReasoningLevel(db: BazilionDb, id: string, level: ReasoningLevel): void {
  db.raw.run('UPDATE agents SET reasoning_level = ? WHERE id = ?', [level, id])
}

export function setModelOverride(db: BazilionDb, id: string, model: string | null): void {
  db.raw.run('UPDATE agents SET model_override = ? WHERE id = ?', [model, id])
}

export function setName(db: BazilionDb, id: string, name: string): void {
  db.raw.run('UPDATE agents SET name = ? WHERE id = ?', [name, id])
}

/** The place after the last Agent of the Team given as the query's parameter. */
const END_OF_TEAM = '(SELECT COALESCE(MAX(position) + 1, 0) FROM agents WHERE team_id = ?)'

/** The order Agents are listed in: by their Team's place, then by their own in it. */
const LIST_ORDER =
  'ORDER BY (SELECT position FROM teams WHERE teams.id = agents.team_id), position, created_at, id'

/** Move the agent to a different team, at its end. The new team must exist. */
export function setTeam(db: BazilionDb, id: string, teamId: string): void {
  db.raw.run(
    `UPDATE agents SET position = ${END_OF_TEAM}, team_id = ? WHERE id = ? AND team_id <> ?`,
    [teamId, teamId, id, teamId],
  )
}

/**
 * Put the Agents named first in their Team, in that order; the Team's other Agents (archived ones
 * included) follow in the order they had. Ids of other Teams' Agents are left out.
 */
export function setOrderInTeam(db: BazilionDb, teamId: string, ids: readonly string[]): void {
  const current = db.raw
    .query<{ id: string }, [string]>(
      'SELECT id FROM agents WHERE team_id = ? ORDER BY position, created_at, id',
    )
    .all(teamId)
    .map((row) => row.id)
  db.raw.transaction(() => {
    for (const [place, id] of orderedIds(current, ids).entries())
      db.raw.run('UPDATE agents SET position = ? WHERE id = ?', [place, id])
  })()
}

/**
 * Lookup by full UUID, exact name, or unambiguous UUID prefix (git-style
 * shorthand). Resolution order: (1) exact id, (2) exact name — only if
 * unique — (3) ≥4-char id prefix — only if unique. Ambiguous name or prefix
 * returns null so the caller's "not found" branch fires. Internal callers
 * always pass full UUIDs, so this only exercises on the new path (URL params,
 * CLI arguments).
 *
 * Name comes before prefix so that a hex-looking name like "abcd1234" resolves
 * to the named agent rather than accidentally matching a UUID prefix.
 */
export function get(db: BazilionDb, idOrName: string): Agent | null {
  if (!idOrName) return null
  const exactId = db.raw
    .query<RawAgent, [string]>('SELECT * FROM agents WHERE id = ?')
    .get(idOrName)
  if (exactId) return toAgent(db, exactId)
  const byName = db.raw
    .query<RawAgent, [string]>('SELECT * FROM agents WHERE name = ? LIMIT 2')
    .all(idOrName)
  if (byName.length === 1 && byName[0]) return toAgent(db, byName[0])
  if (byName.length > 1) return null
  if (idOrName.length < 4) return null
  const byPrefix = db.raw
    .query<RawAgent, [string]>('SELECT * FROM agents WHERE id LIKE ? LIMIT 2')
    .all(`${idOrName}%`)
  return byPrefix.length === 1 && byPrefix[0] ? toAgent(db, byPrefix[0]) : null
}

export function list(db: BazilionDb, opts?: { includeArchived?: boolean }): Agent[] {
  const sql = opts?.includeArchived
    ? `SELECT * FROM agents ${LIST_ORDER}`
    : `SELECT * FROM agents WHERE status != 'archived' ${LIST_ORDER}`
  return db.raw
    .query<RawAgent, []>(sql)
    .all()
    .map((row) => toAgent(db, row))
}

export function countByProfile(db: BazilionDb, profileId: string): number {
  return (
    db.raw
      .query<{ c: number }, [string]>('SELECT COUNT(*) as c FROM agents WHERE profile_id = ?')
      .get(profileId)?.c ?? 0
  )
}

/**
 * Count agents whose team_id matches. Blocks team deletion when > 0 (the
 * `agents.team_id` FK is `ON DELETE RESTRICT` — members must be moved or
 * archived before a team can go away).
 */
export function countByTeam(db: BazilionDb, teamId: string): number {
  return (
    db.raw
      .query<{ c: number }, [string]>('SELECT COUNT(*) as c FROM agents WHERE team_id = ?')
      .get(teamId)?.c ?? 0
  )
}

export function archive(db: BazilionDb, id: string): void {
  db.raw.run("UPDATE agents SET status = 'archived', archived_at = ? WHERE id = ?", [
    Date.now(),
    id,
  ])
}

export function unarchive(db: BazilionDb, id: string): void {
  db.raw.run("UPDATE agents SET status = 'idle', archived_at = NULL WHERE id = ?", [id])
}

export function remove(db: BazilionDb, id: string): void {
  db.raw.run('DELETE FROM agents WHERE id = ?', [id])
}

// --- telegram bindings ---
//
// One topic per agent. `agents.telegram_topic_id` is null until the agent is
// bound to a forum topic in the configured supergroup, then carries the
// message_thread_id Telegram returned from createForumTopic. The partial
// unique index on this column enforces 1:1 once an id is written.

/** Read just the bound topic id for an agent. Null when unbound. */
export function getTelegramTopicId(db: BazilionDb, agentId: string): number | null {
  const row = db.raw
    .query<{ telegram_topic_id: number | null }, [string]>(
      'SELECT telegram_topic_id FROM agents WHERE id = ?',
    )
    .get(agentId)
  return row?.telegram_topic_id ?? null
}

/**
 * Reverse lookup used by the inbound routing layer: given a
 * message_thread_id from an incoming Telegram update, find the agent it
 * belongs to. Null if the thread isn't bound (orphan / service-chat /
 * stale id).
 */
export function findByTelegramTopicId(db: BazilionDb, topicId: number): Agent | null {
  const row = db.raw
    .query<RawAgent, [number]>('SELECT * FROM agents WHERE telegram_topic_id = ?')
    .get(topicId)
  return row ? toAgent(db, row) : null
}

/**
 * Set or clear the agent's bound topic id. Pass `null` to clear (used by
 * `/unbind` and by the lazy-reconcile path when a topic is discovered to
 * have been deleted in Telegram).
 */
export function setTelegramTopicId(db: BazilionDb, agentId: string, topicId: number | null): void {
  db.raw.run('UPDATE agents SET telegram_topic_id = ? WHERE id = ?', [topicId, agentId])
}

/**
 * Update the agent's Telegram outbound-mirror verbosity. The CHECK constraint
 * on the column rejects values outside {minimal, verbose}.
 */
export function setTelegramMirrorMode(
  db: BazilionDb,
  agentId: string,
  mode: TelegramMirrorMode,
): void {
  db.raw.run('UPDATE agents SET telegram_mirror_mode = ? WHERE id = ?', [mode, agentId])
}

/**
 * Per-agent forum-topic emoji override. `null` clears it (resolution falls
 * back to the profile-name default, then color-only). Stores the emoji char,
 * not a Telegram custom_emoji_id — the id is resolved at topic-creation time.
 */
export function setTelegramIconEmoji(db: BazilionDb, agentId: string, emoji: string | null): void {
  db.raw.run('UPDATE agents SET telegram_icon_emoji = ? WHERE id = ?', [emoji, agentId])
}

/**
 * All agents matching `name` (case-sensitive, exact). Returns the full set
 * so the caller can disambiguate across teams. The `/talk <name>` resolver
 * collapses to a single agent only when the result has length 1.
 */
export function findByName(db: BazilionDb, name: string): Agent[] {
  return db.raw
    .query<RawAgent, [string]>(
      "SELECT * FROM agents WHERE name = ? AND status != 'archived' ORDER BY created_at ASC",
    )
    .all(name)
    .map((row) => toAgent(db, row))
}

/**
 * Agent matching `name` within a specific team. Used to resolve the
 * qualified `/talk <team>/<name>` syntax. Null when nothing matches.
 */
/**
 * Whether a Team has an Agent (not archived) by this name, in any case: names are how teammates
 * and the operator tell Agents apart, so one Team has each name once.
 */
export function nameTakenInTeam(
  db: BazilionDb,
  teamId: string,
  name: string,
  exceptId?: string,
): boolean {
  // Compared in JavaScript: SQLite's lower() leaves letters outside ASCII as they are (Éva, éva).
  const wanted = name.trim().toLowerCase()
  return db.raw
    .query<{ id: string; name: string }, [string]>(
      "SELECT id, name FROM agents WHERE team_id = ? AND status != 'archived'",
    )
    .all(teamId)
    .some((row) => row.id !== exceptId && row.name.trim().toLowerCase() === wanted)
}

/** `base`, or `base 2`, `base 3`… : the first name the Team does not have yet. */
export function freeNameInTeam(db: BazilionDb, teamId: string, base: string): string {
  if (!nameTakenInTeam(db, teamId, base)) return base
  let suffix = 2
  while (nameTakenInTeam(db, teamId, `${base} ${suffix}`)) suffix++
  return `${base} ${suffix}`
}

export function findByNameInTeam(db: BazilionDb, teamId: string, name: string): Agent | null {
  const row = db.raw
    .query<RawAgent, [string, string]>(
      "SELECT * FROM agents WHERE team_id = ? AND name = ? AND status != 'archived' LIMIT 1",
    )
    .get(teamId, name)
  return row ? toAgent(db, row) : null
}

/**
 * Bound agent topics in a team, for renaming them when the team's
 * `telegram_topic_name_format` changes (lib/telegram/topic-rename.ts).
 * Archived agents keep whatever name their topic has.
 */
export function listBoundTopicsInTeam(
  db: BazilionDb,
  teamId: string,
): { agentId: string; name: string; topicId: number }[] {
  return db.raw
    .query<{ id: string; name: string; telegram_topic_id: number }, [string]>(
      `SELECT id, name, telegram_topic_id FROM agents
       WHERE team_id = ?
         AND telegram_topic_id IS NOT NULL
         AND status != 'archived'`,
    )
    .all(teamId)
    .map((r) => ({ agentId: r.id, name: r.name, topicId: r.telegram_topic_id }))
}

// --- skill attachments ---

export function attachSkill(
  db: BazilionDb,
  agentId: string,
  skillName: string,
): AgentSkillAttachment {
  const now = Date.now()
  db.raw.run(
    `INSERT INTO agent_skills (agent_id, skill_name, attached_at)
     VALUES (?, ?, ?)
     ON CONFLICT (agent_id, skill_name) DO NOTHING`,
    [agentId, skillName, now],
  )
  return { agentId, skillName, attachedAt: now }
}

export function detachSkill(db: BazilionDb, agentId: string, skillName: string): void {
  db.raw.run('DELETE FROM agent_skills WHERE agent_id = ? AND skill_name = ?', [agentId, skillName])
}

export function listAttachedSkills(db: BazilionDb, agentId: string): string[] {
  return db.raw
    .query<{ skill_name: string }, [string]>(
      'SELECT skill_name FROM agent_skills WHERE agent_id = ? ORDER BY attached_at ASC',
    )
    .all(agentId)
    .map((r) => r.skill_name)
}

// --- chat history snapshot ---
//
// Conversation transcript storage lives in pi-coding-agent's SessionManager
// (JSONL under `~/.bazilion/agents/<id>/sessions/<sessionId>.jsonl`).
// Clear/truncate/rotate operations go through the runtime's
// `apps/daemon/src/runtime/pi/session.ts` helpers, not repo-level accessors.
