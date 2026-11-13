import { randomBytes, randomUUID } from 'node:crypto'
import type { WebSession } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { hashToken } from './webTokens.ts'

/** Sliding lifetime: every authenticated request moves the expiry this far ahead. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** A session is live while unexpired and its token is neither revoked nor expired. */
const LIVE = `s.expires_at > ? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?)`

interface RawSession {
  id: string
  secret_hash: string
  csrf_hash: string
  token_id: string
  token_label: string
  created_at: number
  last_seen_at: number
  expires_at: number
}

export interface CreatedSession {
  session: WebSession
  cookieValue: string
  csrfToken: string
}

export interface AuthenticatedSession {
  id: string
  tokenId: string
  tokenLabel: string
  csrfHash: string
}

function toSession(row: RawSession, currentId?: string): WebSession {
  return {
    id: row.id,
    tokenId: row.token_id,
    tokenLabel: row.token_label,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    current: row.id === currentId,
  }
}

/** Open a browser session for an active token (bootstrap or device). */
export function create(db: BazilionDb, tokenId: string, now = Date.now()): CreatedSession {
  const token = db.raw
    .query<{ label: string }, [string, number]>(
      `SELECT label FROM web_tokens
       WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(tokenId, now)
  if (!token) throw new Error('active credential required')
  db.raw.run('DELETE FROM web_sessions WHERE expires_at <= ?', [now])
  const id = randomUUID()
  const secret = randomBytes(32).toString('base64url')
  const csrfToken = randomBytes(32).toString('base64url')
  const expiresAt = now + SESSION_TTL_MS
  db.raw.run(
    `INSERT INTO web_sessions
       (id, secret_hash, csrf_hash, token_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, hashToken(secret), hashToken(csrfToken), tokenId, now, now, expiresAt],
  )
  return {
    cookieValue: `${id}.${secret}`,
    csrfToken,
    session: {
      id,
      tokenId,
      tokenLabel: token.label,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
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
    .query<RawSession, [string, string, number, number]>(
      `SELECT s.*, t.label AS token_label
       FROM web_sessions s JOIN web_tokens t ON t.id = s.token_id
       WHERE s.id = ? AND s.secret_hash = ? AND ${LIVE}`,
    )
    .get(id, hashToken(secret), now, now)
  if (!row) return null
  db.raw.run('UPDATE web_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [
    now,
    now + SESSION_TTL_MS,
    id,
  ])
  return { id, tokenId: row.token_id, tokenLabel: row.token_label, csrfHash: row.csrf_hash }
}

export function csrfMatches(session: AuthenticatedSession, csrf: string): boolean {
  return hashToken(csrf) === session.csrfHash
}

export function list(
  db: BazilionDb,
  opts: { currentId?: string } = {},
  now = Date.now(),
): WebSession[] {
  return db.raw
    .query<RawSession, [number, number]>(
      `SELECT s.*, t.label AS token_label
       FROM web_sessions s JOIN web_tokens t ON t.id = s.token_id
       WHERE ${LIVE} ORDER BY s.created_at DESC`,
    )
    .all(now, now)
    .map((row) => toSession(row, opts.currentId))
}

/** Revoking a session deletes it. */
export function revoke(db: BazilionDb, id: string): boolean {
  return db.raw.run('DELETE FROM web_sessions WHERE id = ?', [id]).changes > 0
}

export function revokeForToken(db: BazilionDb, tokenId: string): number {
  return db.raw.run('DELETE FROM web_sessions WHERE token_id = ?', [tokenId]).changes
}
