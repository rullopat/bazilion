// Teams repo. The team `id` is the slug AND the directory name under
// `~/.bazilion/teams/<slug>/`. There is no `path` column — callers
// derive `paths.teamDir(id)` at read time. That makes the on-disk path
// canonical: a real directory or a symlink, but always at the same slot.

import type { Team, TeamPolicyMode } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'

interface RawTeam {
  id: string
  name: string
  user_md: string
  telegram_topic_name_format: string | null
  policy_mode: TeamPolicyMode
  created_at: number
}

function toTeam(r: RawTeam, paths: Paths): Team {
  return {
    id: r.id,
    name: r.name,
    path: paths.teamDir(r.id),
    userMd: r.user_md,
    telegramTopicNameFormat: r.telegram_topic_name_format ?? null,
    policyMode: r.policy_mode,
    createdAt: r.created_at,
  }
}

export function insert(
  db: BazilionDb,
  g: { id: string; name: string; userMd?: string; policyMode?: TeamPolicyMode },
  paths: Paths,
): Team {
  const now = Date.now()
  // A fresh team's USER.md is empty: the operator writes it, or its Agents fill it in as they
  // learn about the operator (the system prompt tells them how when it is empty). Callers that
  // pass content, such as a Team template's spawn, keep it.
  const userMd = g.userMd ?? ''
  const policyMode = g.policyMode ?? 'open'
  // A new Team goes at the end of the list.
  db.raw.run(
    `INSERT INTO teams (id, name, user_md, policy_mode, created_at, position)
     VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM teams))`,
    [g.id, g.name, userMd, policyMode, now],
  )
  return {
    id: g.id,
    name: g.name,
    path: paths.teamDir(g.id),
    userMd,
    telegramTopicNameFormat: null,
    policyMode,
    createdAt: now,
  }
}

export function get(db: BazilionDb, id: string, paths: Paths): Team | null {
  const row = db.raw.query<RawTeam, [string]>('SELECT * FROM teams WHERE id = ?').get(id)
  return row ? toTeam(row, paths) : null
}

export function list(db: BazilionDb, paths: Paths): Team[] {
  return db.raw
    .query<RawTeam, []>('SELECT * FROM teams ORDER BY position, created_at, id')
    .all()
    .map((r) => toTeam(r, paths))
}

export function remove(db: BazilionDb, id: string): void {
  db.raw.run('DELETE FROM teams WHERE id = ?', [id])
}

/**
 * Put the Teams named first, in that order; the others follow in the order they had. Ids that
 * name no Team are left out, and the caller says so.
 */
export function setOrder(db: BazilionDb, ids: readonly string[]): void {
  const current = db.raw
    .query<{ id: string }, []>('SELECT id FROM teams ORDER BY position, created_at, id')
    .all()
    .map((row) => row.id)
  db.raw.transaction(() => {
    for (const [place, id] of orderedIds(current, ids).entries())
      db.raw.run('UPDATE teams SET position = ? WHERE id = ?', [place, id])
  })()
}

/** `named` first (those that are in `current`, once each), then the rest of `current` in order. */
export function orderedIds(current: readonly string[], named: readonly string[]): string[] {
  const known = new Set(current)
  const first = [...new Set(named)].filter((id) => known.has(id))
  const placed = new Set(first)
  return [...first, ...current.filter((id) => !placed.has(id))]
}

export function setUserMd(db: BazilionDb, id: string, userMd: string): void {
  db.raw.run('UPDATE teams SET user_md = ? WHERE id = ?', [userMd, id])
}

/**
 * Set (or clear, with `null`) the Telegram forum-topic name template for a
 * team. Callers validate the template first
 * (lib/telegram/naming.ts:validateTopicNameFormat).
 */
export function setTelegramTopicNameFormat(
  db: BazilionDb,
  id: string,
  format: string | null,
): void {
  db.raw.run('UPDATE teams SET telegram_topic_name_format = ? WHERE id = ?', [format, id])
}

// --- telegram bindings ---
//
// `teams.telegram_icon_color` holds the integer from Telegram's 6-color enum
// allocated to this team at first-traffic. Red (16478047) is reserved for
// the service chat — see lib/telegram/naming.ts for the 5-color rotation.

export function getTelegramIconColor(db: BazilionDb, id: string): number | null {
  const row = db.raw
    .query<{ telegram_icon_color: number | null }, [string]>(
      'SELECT telegram_icon_color FROM teams WHERE id = ?',
    )
    .get(id)
  return row?.telegram_icon_color ?? null
}

export function setTelegramIconColor(db: BazilionDb, id: string, color: number): void {
  db.raw.run('UPDATE teams SET telegram_icon_color = ? WHERE id = ?', [color, id])
}

/**
 * Count of teams that already have a color allocated. Drives round-robin
 * allocation in lib/telegram/naming.ts:allocateTeamColor — the next color
 * picked is `AVAILABLE_COLORS[count % AVAILABLE_COLORS.length]`.
 */
export function countAllocatedColors(db: BazilionDb): number {
  return (
    db.raw
      .query<{ c: number }, []>(
        'SELECT COUNT(*) as c FROM teams WHERE telegram_icon_color IS NOT NULL',
      )
      .get()?.c ?? 0
  )
}
