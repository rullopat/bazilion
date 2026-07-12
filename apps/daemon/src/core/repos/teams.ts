// Teams repo. The team `id` is the slug AND the directory name under
// `~/.bazilion/teams/<slug>/`. There is no `path` column — callers
// derive `paths.teamDir(id)` at read time. That makes the on-disk path
// canonical: a real directory or a symlink, but always at the same slot.

import type { Team } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import { DEFAULT_USER_MD } from '../profile/templates.ts'

interface RawTeam {
  id: string
  name: string
  user_md: string
  telegram_topic_name_format: string | null
  created_at: number
}

function toTeam(r: RawTeam, paths: Paths): Team {
  return {
    id: r.id,
    name: r.name,
    path: paths.teamDir(r.id),
    userMd: r.user_md,
    telegramTopicNameFormat: r.telegram_topic_name_format ?? null,
    createdAt: r.created_at,
  }
}

export function insert(
  db: BazilionDb,
  g: { id: string; name: string; userMd?: string },
  paths: Paths,
): Team {
  const now = Date.now()
  // A fresh team seeds the starter USER.md by default. Callers that pass
  // their own non-empty content (e.g. profile-team spawn) win; an absent or
  // empty userMd falls back to DEFAULT_USER_MD so no team is born blank.
  const userMd = g.userMd && g.userMd.length > 0 ? g.userMd : DEFAULT_USER_MD
  db.raw.run('INSERT INTO teams (id, name, user_md, created_at) VALUES (?, ?, ?, ?)', [
    g.id,
    g.name,
    userMd,
    now,
  ])
  return {
    id: g.id,
    name: g.name,
    path: paths.teamDir(g.id),
    userMd,
    telegramTopicNameFormat: null,
    createdAt: now,
  }
}

export function get(db: BazilionDb, id: string, paths: Paths): Team | null {
  const row = db.raw.query<RawTeam, [string]>('SELECT * FROM teams WHERE id = ?').get(id)
  return row ? toTeam(row, paths) : null
}

export function list(db: BazilionDb, paths: Paths): Team[] {
  return db.raw
    .query<RawTeam, []>('SELECT * FROM teams ORDER BY created_at ASC')
    .all()
    .map((r) => toTeam(r, paths))
}

export function remove(db: BazilionDb, id: string): void {
  db.raw.run('DELETE FROM teams WHERE id = ?', [id])
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

// --- telegram bindings (migration 0003) ---
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
 * allocation in lib/telegram/naming.ts:allocateGroupColor — the next color
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
