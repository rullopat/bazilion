import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ALL_DEVICE_TOKEN_SCOPES, type DeviceTokenScope, type WebToken } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawToken {
  id: string
  label: string
  kind: 'bootstrap' | 'device'
  token_hash: string
  scopes: string
  created_at: number
  last_used_at: number | null
  expires_at: number | null
  revoked_at: number | null
}

export function parseScopes(raw: string | null | undefined): DeviceTokenScope[] {
  if (!raw) return [...ALL_DEVICE_TOKEN_SCOPES]
  const parsed = raw
    .split(/\s+/)
    .filter(Boolean)
    .filter((s): s is DeviceTokenScope =>
      (ALL_DEVICE_TOKEN_SCOPES as readonly string[]).includes(s),
    )
  return parsed.length > 0 ? parsed : [...ALL_DEVICE_TOKEN_SCOPES]
}

function toToken(r: RawToken): WebToken {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    scopes: parseScopes(r.scopes),
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
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

export function create(
  db: BazilionDb,
  label: string,
  opts: {
    kind?: 'bootstrap' | 'device'
    expiresAt?: number | null
    /** Authorization scopes. Defaults to all (pre-BAZ-055 behavior). */
    scopes?: DeviceTokenScope[]
  } = {},
): CreatedToken {
  const id = randomUUID()
  const token = randomBytes(24).toString('hex')
  const tokenHash = hashToken(token)
  const now = Date.now()
  const kind = opts.kind ?? 'device'
  const expiresAt = kind === 'bootstrap' ? null : (opts.expiresAt ?? now + 90 * 86_400_000)
  // The bootstrap row always holds every scope; device rows take what was asked.
  const scopes = (
    kind === 'bootstrap' ? ALL_DEVICE_TOKEN_SCOPES : (opts.scopes ?? ALL_DEVICE_TOKEN_SCOPES)
  ).join(' ')
  db.raw.run(
    `INSERT INTO web_tokens
       (id, label, kind, token_hash, scopes, created_at, last_used_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    [id, label, kind, tokenHash, scopes, now, expiresAt],
  )
  return {
    token,
    meta: {
      id,
      label,
      kind,
      scopes: parseScopes(scopes),
      createdAt: now,
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
    },
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
    .query<RawToken, [string, number]>(
      `SELECT * FROM web_tokens
       WHERE token_hash = ? AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(tokenHash, Date.now())
  return row ? toToken(row) : null
}

export function rejectionReason(
  db: BazilionDb,
  token: string,
  now = Date.now(),
): 'invalid' | 'expired' | 'revoked' {
  const row = db.raw
    .query<Pick<RawToken, 'expires_at' | 'revoked_at'>, [string]>(
      'SELECT expires_at, revoked_at FROM web_tokens WHERE token_hash = ?',
    )
    .get(hashToken(token))
  if (!row) return 'invalid'
  if (row.revoked_at !== null) return 'revoked'
  if (row.expires_at !== null && row.expires_at <= now) return 'expired'
  return 'invalid'
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
