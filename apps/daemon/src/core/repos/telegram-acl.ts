// Telegram per-user allowlist repo (migration 0007). Flat-scope allowlist:
// presence => allowed. `owner` role gates allowlist management + can't be
// removed.

import type { TelegramAclRole, TelegramAllowedUser } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawAllowedUser {
  user_id: number
  username: string | null
  label: string | null
  role: string
  added_at: number
}

function toUser(r: RawAllowedUser): TelegramAllowedUser {
  return {
    userId: r.user_id,
    username: r.username,
    label: r.label,
    role: r.role as TelegramAclRole,
    addedAt: r.added_at,
  }
}

export function list(db: BazilionDb): TelegramAllowedUser[] {
  return db.raw
    .query<RawAllowedUser, []>('SELECT * FROM telegram_allowed_users ORDER BY added_at ASC')
    .all()
    .map(toUser)
}

export function get(db: BazilionDb, userId: number): TelegramAllowedUser | null {
  const row = db.raw
    .query<RawAllowedUser, [number]>('SELECT * FROM telegram_allowed_users WHERE user_id = ?')
    .get(userId)
  return row ? toUser(row) : null
}

export function isAllowed(db: BazilionDb, userId: number): boolean {
  return get(db, userId) !== null
}

export function count(db: BazilionDb): number {
  return (
    db.raw.query<{ c: number }, []>('SELECT COUNT(*) as c FROM telegram_allowed_users').get()?.c ??
    0
  )
}

export function ownerCount(db: BazilionDb): number {
  return (
    db.raw
      .query<{ c: number }, []>(
        "SELECT COUNT(*) as c FROM telegram_allowed_users WHERE role = 'owner'",
      )
      .get()?.c ?? 0
  )
}

export interface AddAllowedUserInput {
  userId: number
  username?: string | null
  label?: string | null
  role?: TelegramAclRole
}

/** Upsert: re-adding an existing user refreshes username/label, keeps role. */
export function add(db: BazilionDb, input: AddAllowedUserInput): TelegramAllowedUser {
  const now = Date.now()
  const role: TelegramAclRole = input.role ?? 'member'
  db.raw.run(
    `INSERT INTO telegram_allowed_users (user_id, username, label, role, added_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, label = excluded.label`,
    [input.userId, input.username ?? null, input.label ?? null, role, now],
  )
  return get(db, input.userId) as TelegramAllowedUser
}

/**
 * Remove a user. Returns false (no-op) when the user is the last owner — at
 * least one owner must always remain so the operator can't lock themselves out.
 */
export function remove(db: BazilionDb, userId: number): boolean {
  const u = get(db, userId)
  if (!u) return false
  if (u.role === 'owner' && ownerCount(db) <= 1) return false
  db.raw.run('DELETE FROM telegram_allowed_users WHERE user_id = ?', [userId])
  return true
}
