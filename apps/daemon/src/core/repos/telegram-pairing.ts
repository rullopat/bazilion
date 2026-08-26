import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { BazilionDb } from '../db/client.ts'
import { add } from './telegram-acl.ts'

const TTL_MS = 10 * 60_000

interface PairingRow {
  digest: string
  expires_at: number
  created_at: number
}

export interface TelegramPairingStatus {
  paired: boolean
  challengeActive: boolean
  challengeExpiresAt: number | null
  ownerUserId: number | null
}

function digest(code: string): Buffer {
  return createHash('sha256').update(code, 'utf8').digest()
}

export function create(db: BazilionDb): { code: string; expiresAt: number } {
  if (status(db).paired) throw new Error('Telegram already has a paired owner')
  const code = randomBytes(16).toString('base64url')
  const now = Date.now()
  const expiresAt = now + TTL_MS
  db.raw.run(
    `INSERT INTO telegram_pairing_challenge (singleton, digest, expires_at, created_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(singleton) DO UPDATE SET
       digest = excluded.digest, expires_at = excluded.expires_at, created_at = excluded.created_at`,
    [digest(code).toString('hex'), expiresAt, now],
  )
  return { code, expiresAt }
}

export function cancel(db: BazilionDb): void {
  db.raw.run('DELETE FROM telegram_pairing_challenge WHERE singleton = 1')
}

export function reset(db: BazilionDb): void {
  db.raw.transaction(() => {
    cancel(db)
    db.raw.run('DELETE FROM telegram_allowed_users')
  })()
}

export function status(db: BazilionDb): TelegramPairingStatus {
  const owner = db.raw
    .query<{ user_id: number }, []>(
      "SELECT user_id FROM telegram_allowed_users WHERE role = 'owner' ORDER BY added_at LIMIT 1",
    )
    .get()
  const row = db.raw
    .query<PairingRow, []>(
      'SELECT digest, expires_at, created_at FROM telegram_pairing_challenge WHERE singleton = 1',
    )
    .get()
  const active = row !== null && row.expires_at > Date.now()
  if (row && !active) cancel(db)
  return {
    paired: owner !== null,
    challengeActive: active,
    challengeExpiresAt: active ? (row?.expires_at ?? null) : null,
    ownerUserId: owner?.user_id ?? null,
  }
}

export function consume(
  db: BazilionDb,
  input: { code: string; userId: number; username?: string | null; label?: string | null },
): boolean {
  return db.raw.transaction(() => {
    if (status(db).paired) return false
    const row = db.raw
      .query<PairingRow, []>(
        'SELECT digest, expires_at, created_at FROM telegram_pairing_challenge WHERE singleton = 1',
      )
      .get()
    if (!row || row.expires_at <= Date.now()) {
      cancel(db)
      return false
    }
    const supplied = digest(input.code)
    const expected = Buffer.from(row.digest, 'hex')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false
    add(db, { ...input, role: 'owner' })
    cancel(db)
    return true
  })()
}
