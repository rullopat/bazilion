import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { WebToken } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawToken {
  id: string
  label: string
  token_hash: string
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
}

function toToken(r: RawToken): WebToken {
  return {
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface CreatedToken {
  meta: WebToken
  /** Plaintext token — shown exactly once, never re-queryable. */
  token: string
}

export function create(db: BazilionDb, label: string): CreatedToken {
  const id = randomUUID()
  const token = randomBytes(24).toString('hex')
  const tokenHash = hashToken(token)
  const now = Date.now()
  db.raw.run(
    `INSERT INTO web_tokens (id, label, token_hash, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
    [id, label, tokenHash, now],
  )
  return {
    token,
    meta: { id, label, createdAt: now, lastUsedAt: null, revokedAt: null },
  }
}

export function list(db: BazilionDb, opts?: { includeRevoked?: boolean }): WebToken[] {
  const sql = opts?.includeRevoked
    ? 'SELECT * FROM web_tokens ORDER BY created_at ASC'
    : 'SELECT * FROM web_tokens WHERE revoked_at IS NULL ORDER BY created_at ASC'
  return db.raw.query<RawToken, []>(sql).all().map(toToken)
}

export function get(db: BazilionDb, id: string): WebToken | null {
  const row = db.raw.query<RawToken, [string]>('SELECT * FROM web_tokens WHERE id = ?').get(id)
  return row ? toToken(row) : null
}

/**
 * Returns the active token row matching the given plaintext, or null.
 * Does NOT bump last_used_at — call markUsed separately once the caller
 * has decided the request is authorized.
 */
export function findActiveByToken(db: BazilionDb, token: string): WebToken | null {
  const tokenHash = hashToken(token)
  const row = db.raw
    .query<RawToken, [string]>(
      'SELECT * FROM web_tokens WHERE token_hash = ? AND revoked_at IS NULL',
    )
    .get(tokenHash)
  return row ? toToken(row) : null
}

export function markUsed(db: BazilionDb, id: string, when: number = Date.now()): void {
  db.raw.run('UPDATE web_tokens SET last_used_at = ? WHERE id = ?', [when, id])
}

export function revoke(db: BazilionDb, id: string, when: number = Date.now()): boolean {
  const res = db.raw.run(
    'UPDATE web_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    [when, id],
  )
  return res.changes > 0
}
