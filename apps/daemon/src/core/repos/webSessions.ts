import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { WebSession } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { hashToken } from './webTokens.ts'

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000

interface RawSession {
  id: string
  secret_hash: string
  csrf_hash: string
  device_token_id: string
  device_label: string
  created_at: number
  last_seen_at: number
  idle_expires_at: number
  absolute_expires_at: number
  revoked_at: number | null
}

export interface CreatedSession {
  session: WebSession
  cookieValue: string
  csrfToken: string
}

export interface AuthenticatedSession {
  id: string
  deviceTokenId: string
  deviceLabel: string
  csrfHash: string
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function toSession(row: RawSession, currentId?: string): WebSession {
  return {
    id: row.id,
    deviceTokenId: row.device_token_id,
    deviceLabel: row.device_label,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    revokedAt: row.revoked_at,
    current: row.id === currentId,
  }
}

export function create(db: BazilionDb, deviceTokenId: string, now = Date.now()): CreatedSession {
  const token = db.raw
    .query<{ id: string; label: string }, [string, number]>(
      `SELECT id, label FROM web_tokens
       WHERE id = ? AND kind = 'device' AND revoked_at IS NULL AND expires_at > ?`,
    )
    .get(deviceTokenId, now)
  if (!token) throw new Error('active device credential required')
  const id = randomUUID()
  const secret = randomBytes(32).toString('base64url')
  const csrfToken = randomBytes(32).toString('base64url')
  const idleExpiresAt = now + SESSION_IDLE_MS
  const absoluteExpiresAt = now + SESSION_ABSOLUTE_MS
  db.raw.run(
    `INSERT INTO web_sessions
       (id, secret_hash, csrf_hash, device_token_id, created_at, last_seen_at,
        idle_expires_at, absolute_expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [id, hash(secret), hash(csrfToken), deviceTokenId, now, now, idleExpiresAt, absoluteExpiresAt],
  )
  return {
    cookieValue: `${id}.${secret}`,
    csrfToken,
    session: {
      id,
      deviceTokenId,
      deviceLabel: token.label,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      revokedAt: null,
      current: true,
    },
  }
}

export function authenticate(
  db: BazilionDb,
  cookieValue: string,
  now = Date.now(),
): AuthenticatedSession | null {
  const separator = cookieValue.indexOf('.')
  if (separator <= 0) return null
  const id = cookieValue.slice(0, separator)
  const secret = cookieValue.slice(separator + 1)
  if (!secret) return null
  const row = db.raw
    .query<RawSession, [string, string, number, number, number]>(
      `SELECT s.*, t.label AS device_label
       FROM web_sessions s JOIN web_tokens t ON t.id = s.device_token_id
       WHERE s.id = ? AND s.secret_hash = ? AND s.revoked_at IS NULL
         AND s.idle_expires_at > ? AND s.absolute_expires_at > ?
         AND t.kind = 'device' AND t.revoked_at IS NULL AND t.expires_at > ?`,
    )
    .get(id, hash(secret), now, now, now)
  if (!row) return null
  const idleExpiresAt = Math.min(now + SESSION_IDLE_MS, row.absolute_expires_at)
  db.raw.run('UPDATE web_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?', [
    now,
    idleExpiresAt,
    id,
  ])
  return {
    id,
    deviceTokenId: row.device_token_id,
    deviceLabel: row.device_label,
    csrfHash: row.csrf_hash,
  }
}

export function csrfMatches(session: AuthenticatedSession, csrf: string): boolean {
  return hashToken(csrf) === session.csrfHash
}

export function list(
  db: BazilionDb,
  opts: { includeRevoked?: boolean; currentId?: string } = {},
): WebSession[] {
  const where = opts.includeRevoked ? '' : 'WHERE s.revoked_at IS NULL'
  return db.raw
    .query<RawSession, []>(
      `SELECT s.*, t.label AS device_label FROM web_sessions s
       JOIN web_tokens t ON t.id = s.device_token_id
       ${where} ORDER BY s.created_at DESC`,
    )
    .all()
    .map((row) => toSession(row, opts.currentId))
}

export function revoke(db: BazilionDb, id: string, now = Date.now()): boolean {
  return (
    db.raw.run('UPDATE web_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [
      now,
      id,
    ]).changes > 0
  )
}

export function revokeForDevice(db: BazilionDb, tokenId: string, now = Date.now()): number {
  return db.raw.run(
    'UPDATE web_sessions SET revoked_at = ? WHERE device_token_id = ? AND revoked_at IS NULL',
    [now, tokenId],
  ).changes
}

export function revokeAll(db: BazilionDb, now = Date.now()): number {
  return db.raw.run('UPDATE web_sessions SET revoked_at = ? WHERE revoked_at IS NULL', [now])
    .changes
}
