import type {
  Agent,
  AgentSkillAttachment,
  AgentStatus,
  ReasoningLevel,
  TelegramMirrorMode,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawAgent {
  id: string
  profile_id: string
  name: string
  model_override: string | null
  reasoning_level: string
  status: string
  dir: string
  group_id: string
  telegram_topic_id: number | null
  telegram_mirror_mode: string
  telegram_icon_emoji: string | null
  created_at: number
  archived_at: number | null
}

function toAgent(r: RawAgent): Agent {
  return {
    id: r.id,
    profileId: r.profile_id,
    name: r.name,
    modelOverride: r.model_override,
    reasoningLevel: r.reasoning_level as ReasoningLevel,
    status: r.status as AgentStatus,
    dir: r.dir,
    groupId: r.group_id,
    telegramTopicId: r.telegram_topic_id,
    telegramMirrorMode: (r.telegram_mirror_mode ?? 'minimal') as TelegramMirrorMode,
    telegramIconEmoji: r.telegram_icon_emoji ?? null,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
  }
}

/**
 * Insert an agent row. Telegram-specific fields (`telegramTopicId`,
 * `telegramMirrorMode`) are excluded from the required input — the
 * schema's defaults apply (NULL topic, 'minimal' mirror mode). Lets
 * existing call sites stay focused on the fields they care about; only
 * the bind/talk paths populate the topic id later.
 */
export function insert(
  db: BazilionDb,
  a: Omit<
    Agent,
    'createdAt' | 'archivedAt' | 'telegramTopicId' | 'telegramMirrorMode' | 'telegramIconEmoji'
  > & {
    telegramMirrorMode?: Agent['telegramMirrorMode']
  },
): Agent {
  const now = Date.now()
  const mirrorMode = a.telegramMirrorMode ?? 'minimal'
  db.raw.run(
    `INSERT INTO agents (id, profile_id, name, model_override, reasoning_level, status, dir, group_id, telegram_mirror_mode, created_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      a.id,
      a.profileId,
      a.name,
      a.modelOverride,
      a.reasoningLevel,
      a.status,
      a.dir,
      a.groupId,
      mirrorMode,
      now,
    ],
  )
  return {
    ...a,
    telegramTopicId: null,
    telegramMirrorMode: mirrorMode,
    telegramIconEmoji: null,
    createdAt: now,
    archivedAt: null,
  }
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

/** Move the agent to a different group. The new group must exist. */
export function setGroup(db: BazilionDb, id: string, groupId: string): void {
  db.raw.run('UPDATE agents SET group_id = ? WHERE id = ?', [groupId, id])
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
  if (exactId) return toAgent(exactId)
  const byName = db.raw
    .query<RawAgent, [string]>('SELECT * FROM agents WHERE name = ? LIMIT 2')
    .all(idOrName)
  if (byName.length === 1 && byName[0]) return toAgent(byName[0])
  if (byName.length > 1) return null
  if (idOrName.length < 4) return null
  const byPrefix = db.raw
    .query<RawAgent, [string]>('SELECT * FROM agents WHERE id LIKE ? LIMIT 2')
    .all(`${idOrName}%`)
  return byPrefix.length === 1 && byPrefix[0] ? toAgent(byPrefix[0]) : null
}

/**
 * Resolve `idOrPrefix` to a full agent ID, or null if not found / ambiguous.
 * Thin wrapper around `get` for callers that want the canonical ID without
 * the rest of the row (e.g. URL param normalization).
 */
export function resolveId(db: BazilionDb, idOrPrefix: string): string | null {
  return get(db, idOrPrefix)?.id ?? null
}

export function list(db: BazilionDb, opts?: { includeArchived?: boolean }): Agent[] {
  const sql = opts?.includeArchived
    ? 'SELECT * FROM agents ORDER BY created_at ASC'
    : "SELECT * FROM agents WHERE status != 'archived' ORDER BY created_at ASC"
  return db.raw.query<RawAgent, []>(sql).all().map(toAgent)
}

export function countByProfile(db: BazilionDb, profileId: string): number {
  return (
    db.raw
      .query<{ c: number }, [string]>('SELECT COUNT(*) as c FROM agents WHERE profile_id = ?')
      .get(profileId)?.c ?? 0
  )
}

/**
 * Count agents whose group_id matches. Blocks group deletion when > 0 (the
 * `agents.group_id` FK is `ON DELETE RESTRICT` — members must be moved or
 * archived before a group can go away).
 */
export function countByGroup(db: BazilionDb, groupId: string): number {
  return (
    db.raw
      .query<{ c: number }, [string]>('SELECT COUNT(*) as c FROM agents WHERE group_id = ?')
      .get(groupId)?.c ?? 0
  )
}

export function setStatus(db: BazilionDb, id: string, status: AgentStatus): void {
  db.raw.run('UPDATE agents SET status = ? WHERE id = ?', [status, id])
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

// --- telegram bindings (migration 0003) ---
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
  return row ? toAgent(row) : null
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
 * so the caller can disambiguate across groups. The `/talk <name>` resolver
 * collapses to a single agent only when the result has length 1.
 */
export function findByName(db: BazilionDb, name: string): Agent[] {
  return db.raw
    .query<RawAgent, [string]>(
      "SELECT * FROM agents WHERE name = ? AND status != 'archived' ORDER BY created_at ASC",
    )
    .all(name)
    .map(toAgent)
}

/**
 * Agent matching `name` within a specific group. Used to resolve the
 * qualified `/talk <group>/<name>` syntax. Null when nothing matches.
 */
export function findByNameInGroup(db: BazilionDb, groupId: string, name: string): Agent | null {
  const row = db.raw
    .query<RawAgent, [string, string]>(
      "SELECT * FROM agents WHERE group_id = ? AND name = ? AND status != 'archived' LIMIT 1",
    )
    .get(groupId, name)
  return row ? toAgent(row) : null
}

/**
 * Bound, non-locked agent topics in a group. Drives topic-name propagation
 * when a group's `telegram_topic_name_format` changes
 * (lib/telegram/topic-rename.ts): only agents with a live topic that a human
 * hasn't manually renamed (`telegram_topic_name_locked = 0`) get re-rendered.
 * Archived agents are excluded — their topics keep whatever name they have.
 */
export function listBoundUnlockedTopicsInGroup(
  db: BazilionDb,
  groupId: string,
): { agentId: string; name: string; topicId: number }[] {
  return db.raw
    .query<{ id: string; name: string; telegram_topic_id: number }, [string]>(
      `SELECT id, name, telegram_topic_id FROM agents
       WHERE group_id = ?
         AND telegram_topic_id IS NOT NULL
         AND telegram_topic_name_locked = 0
         AND status != 'archived'`,
    )
    .all(groupId)
    .map((r) => ({ agentId: r.id, name: r.name, topicId: r.telegram_topic_id }))
}

// --- skill attachments ---

interface RawSkill {
  agent_id: string
  skill_name: string
  attached_at: number
}

function toSkillAttachment(r: RawSkill): AgentSkillAttachment {
  return {
    agentId: r.agent_id,
    skillName: r.skill_name,
    attachedAt: r.attached_at,
  }
}

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

export function listSkillAttachments(db: BazilionDb, agentId: string): AgentSkillAttachment[] {
  return db.raw
    .query<RawSkill, [string]>(
      'SELECT * FROM agent_skills WHERE agent_id = ? ORDER BY attached_at ASC',
    )
    .all(agentId)
    .map(toSkillAttachment)
}

// --- chat history snapshot ---
//
// Conversation transcript storage lives in pi-coding-agent's SessionManager
// (JSONL under `~/.bazilion/agents/<id>/sessions/<sessionId>.jsonl`).
// Clear/truncate/rotate operations go through the runtime's
// `apps/daemon/src/runtime/pi/session.ts` helpers, not repo-level accessors.
