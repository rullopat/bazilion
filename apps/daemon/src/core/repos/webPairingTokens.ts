import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ALL_DEVICE_TOKEN_SCOPES, type DeviceTokenScope } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

// BAZ-055 slice 2: one-paste pairing setup codes. A pairing token is
// short-lived, single-use, and NOT an API credential — it admits exactly one
// exchange that mints a durable scoped device credential (the OpenClaw model:
// a short-lived key that admits a durable device identity).

export const PAIRING_TOKEN_TTL_MS = 10 * 60_000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

interface RawPairingToken {
  id: string
  token_hash: string
  scopes: string
  created_at: number
  expires_at: number
  used_at: number | null
  used_by_token_id: string | null
}

export interface CreatedPairingCode {
  meta: {
    id: string
    scopes: DeviceTokenScope[]
    createdAt: number
    expiresAt: number
    usedAt: null
    usedByTokenId: null
  }
  /** Plaintext setup code — shown exactly once, never re-queryable. */
  code: string
}

export function create(
  db: BazilionDb,
  opts: { scopes?: DeviceTokenScope[] } = {},
): CreatedPairingCode {
  const id = randomUUID()
  const code = randomBytes(24).toString('hex')
  const now = Date.now()
  const scopes = (opts.scopes ?? ALL_DEVICE_TOKEN_SCOPES).join(' ')
  db.raw.run(
    `INSERT INTO web_pairing_tokens (id, token_hash, scopes, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, hashToken(code), scopes, now, now + PAIRING_TOKEN_TTL_MS],
  )
  return {
    code,
    meta: {
      id,
      scopes: scopes.split(' ') as DeviceTokenScope[],
      createdAt: now,
      expiresAt: now + PAIRING_TOKEN_TTL_MS,
      usedAt: null,
      usedByTokenId: null,
    },
  }
}

export type PairingRejection = 'invalid' | 'expired' | 'used'

/**
 * Consume a pairing code exactly once. Returns the scopes the minted device
 * credential must carry, or the reason the code cannot be used. The use is
 * recorded in the same statement that proves it was unused — two concurrent
 * exchanges cannot both win.
 */
export function exchange(
  db: BazilionDb,
  code: string,
  now = Date.now(),
): { ok: true; scopes: DeviceTokenScope[] } | { ok: false; reason: PairingRejection } {
  const tokenHash = hashToken(code)
  const claimed = db.raw.run(
    `UPDATE web_pairing_tokens
       SET used_at = ?, used_by_token_id = 'pending'
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    [now, tokenHash, now],
  )
  if (claimed.changes === 0) {
    const row = db.raw
      .query<Pick<RawPairingToken, 'expires_at' | 'used_at'>, [string]>(
        'SELECT expires_at, used_at FROM web_pairing_tokens WHERE token_hash = ?',
      )
      .get(tokenHash)
    if (!row) return { ok: false, reason: 'invalid' }
    if (row.used_at !== null) return { ok: false, reason: 'used' }
    return { ok: false, reason: 'expired' }
  }
  const row = db.raw
    .query<Pick<RawPairingToken, 'scopes' | 'used_by_token_id'>, [string]>(
      'SELECT scopes, used_by_token_id FROM web_pairing_tokens WHERE token_hash = ?',
    )
    .get(tokenHash)
  if (!row) return { ok: false, reason: 'invalid' }
  return { ok: true, scopes: row.scopes.split(' ') as DeviceTokenScope[] }
}

/**
 * Record which device token a consumed pairing code produced — the second
 * half of the two-step claim above, called in the same transaction as the
 * device-token INSERT so the audit chain cannot be broken.
 */
export function completeExchange(db: BazilionDb, code: string, deviceTokenId: string): void {
  db.raw.run(
    `UPDATE web_pairing_tokens SET used_by_token_id = ?
     WHERE token_hash = ? AND used_by_token_id = 'pending'`,
    [deviceTokenId, hashToken(code)],
  )
}

export function list(
  db: BazilionDb,
  opts?: { includeUsed?: boolean },
): Array<{
  id: string
  scopes: DeviceTokenScope[]
  createdAt: number
  expiresAt: number
  usedAt: number | null
  usedByTokenId: string | null
}> {
  const sql = opts?.includeUsed
    ? 'SELECT * FROM web_pairing_tokens ORDER BY created_at DESC'
    : 'SELECT * FROM web_pairing_tokens WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC'
  const rows = opts?.includeUsed
    ? db.raw.query<RawPairingToken, []>(sql).all()
    : db.raw.query<RawPairingToken, [number]>(sql).all(Date.now())
  return rows.map((r) => ({
    id: r.id,
    scopes: r.scopes.split(' ') as DeviceTokenScope[],
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    usedByTokenId: r.used_by_token_id,
  }))
}
