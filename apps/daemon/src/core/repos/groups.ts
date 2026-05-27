// Groups repo. The group `id` is the slug AND the directory name under
// `~/.bazilion/groups/<slug>/`. There is no `path` column — callers
// derive `paths.groupDir(id)` at read time. That makes the on-disk path
// canonical: a real directory or a symlink, but always at the same slot.

import type { Group } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'

interface RawGroup {
  id: string
  name: string
  user_md: string
  created_at: number
}

function toGroup(r: RawGroup, paths: Paths): Group {
  return {
    id: r.id,
    name: r.name,
    path: paths.groupDir(r.id),
    userMd: r.user_md,
    createdAt: r.created_at,
  }
}

export function insert(db: BazilionDb, g: { id: string; name: string }, paths: Paths): Group {
  const now = Date.now()
  db.raw.run("INSERT INTO groups (id, name, user_md, created_at) VALUES (?, ?, '', ?)", [
    g.id,
    g.name,
    now,
  ])
  return { id: g.id, name: g.name, path: paths.groupDir(g.id), userMd: '', createdAt: now }
}

export function get(db: BazilionDb, id: string, paths: Paths): Group | null {
  const row = db.raw.query<RawGroup, [string]>('SELECT * FROM groups WHERE id = ?').get(id)
  return row ? toGroup(row, paths) : null
}

export function list(db: BazilionDb, paths: Paths): Group[] {
  return db.raw
    .query<RawGroup, []>('SELECT * FROM groups ORDER BY created_at ASC')
    .all()
    .map((r) => toGroup(r, paths))
}

export function remove(db: BazilionDb, id: string): void {
  db.raw.run('DELETE FROM groups WHERE id = ?', [id])
}

export function setUserMd(db: BazilionDb, id: string, userMd: string): void {
  db.raw.run('UPDATE groups SET user_md = ? WHERE id = ?', [userMd, id])
}

// --- telegram bindings (migration 0003) ---
//
// `groups.telegram_icon_color` holds the integer from Telegram's 6-color enum
// allocated to this group at first-traffic. Red (16478047) is reserved for
// the service chat — see lib/telegram/naming.ts for the 5-color rotation.

export function getTelegramIconColor(db: BazilionDb, id: string): number | null {
  const row = db.raw
    .query<{ telegram_icon_color: number | null }, [string]>(
      'SELECT telegram_icon_color FROM groups WHERE id = ?',
    )
    .get(id)
  return row?.telegram_icon_color ?? null
}

export function setTelegramIconColor(db: BazilionDb, id: string, color: number): void {
  db.raw.run('UPDATE groups SET telegram_icon_color = ? WHERE id = ?', [color, id])
}

/**
 * Count of groups that already have a color allocated. Drives round-robin
 * allocation in lib/telegram/naming.ts:allocateGroupColor — the next color
 * picked is `AVAILABLE_COLORS[count % AVAILABLE_COLORS.length]`.
 */
export function countAllocatedColors(db: BazilionDb): number {
  return (
    db.raw
      .query<{ c: number }, []>(
        'SELECT COUNT(*) as c FROM groups WHERE telegram_icon_color IS NOT NULL',
      )
      .get()?.c ?? 0
  )
}
