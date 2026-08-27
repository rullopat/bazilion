import { beforeEach, describe, expect, test } from 'vitest'
import {
  type BazilionDb,
  openInMemoryDb,
  runMigrations,
  webTokenRepo,
} from '../../src/core/index.ts'

let db: BazilionDb
beforeEach(() => {
  db = openInMemoryDb()
  runMigrations(db)
})

describe('webTokenRepo', () => {
  test('create returns plaintext + metadata; plaintext is never re-queryable', () => {
    const out = webTokenRepo.create(db, 'laptop')
    expect(out.token).toMatch(/^[0-9a-f]{48}$/)
    expect(out.meta.label).toBe('laptop')
    expect(out.meta.kind).toBe('device')
    expect(out.meta.expiresAt).toBeGreaterThan(Date.now())
    expect(out.meta.revokedAt).toBe(null)
    expect(out.meta.lastUsedAt).toBe(null)

    // list() returns meta only — no plaintext
    const listed = webTokenRepo.list(db)
    expect(listed).toHaveLength(1)
    expect((listed[0] as unknown as { token?: unknown }).token).toBeUndefined()
  })

  test('findActiveByToken matches the plaintext and excludes revoked rows', () => {
    const { token, meta } = webTokenRepo.create(db, 'laptop')
    const match = webTokenRepo.findActiveByToken(db, token)
    expect(match?.id).toBe(meta.id)

    webTokenRepo.revoke(db, meta.id)
    expect(webTokenRepo.findActiveByToken(db, token)).toBe(null)
  })

  test('findActiveByToken returns null for unknown tokens', () => {
    webTokenRepo.create(db, 'laptop')
    expect(webTokenRepo.findActiveByToken(db, 'wrong')).toBe(null)
  })

  test('expired device tokens fail closed while bootstrap is non-expiring', () => {
    const expired = webTokenRepo.create(db, 'old phone', {
      kind: 'device',
      expiresAt: Date.now() - 1,
    })
    const bootstrap = webTokenRepo.create(db, 'bootstrap', { kind: 'bootstrap' })
    expect(webTokenRepo.findActiveByToken(db, expired.token)).toBeNull()
    expect(webTokenRepo.findActiveByToken(db, bootstrap.token)?.kind).toBe('bootstrap')
    expect(bootstrap.meta.expiresAt).toBeNull()
  })

  test('markUsed updates last_used_at', () => {
    const { meta } = webTokenRepo.create(db, 'laptop')
    const when = Date.now() + 10_000
    webTokenRepo.markUsed(db, meta.id, when)
    expect(webTokenRepo.get(db, meta.id)?.lastUsedAt).toBe(when)
  })

  test('revoke is idempotent — second revoke reports no change', () => {
    const { meta } = webTokenRepo.create(db, 'laptop')
    expect(webTokenRepo.revoke(db, meta.id)).toBe(true)
    expect(webTokenRepo.revoke(db, meta.id)).toBe(false)
    expect(webTokenRepo.get(db, meta.id)?.revokedAt).toBeTruthy()
  })

  test('list hides revoked tokens by default but reveals them with includeRevoked', () => {
    webTokenRepo.create(db, 'a')
    const b = webTokenRepo.create(db, 'b')
    webTokenRepo.revoke(db, b.meta.id)
    expect(webTokenRepo.list(db).map((t) => t.label)).toEqual(['a'])
    expect(webTokenRepo.list(db, { includeRevoked: true }).map((t) => t.label)).toEqual(['a', 'b'])
  })

  test('plaintext token is stored as a hash, not in the clear', () => {
    const { token } = webTokenRepo.create(db, 'laptop')
    const row = db.raw
      .query<{ token_hash: string }, []>('SELECT token_hash FROM web_tokens LIMIT 1')
      .get()
    expect(row?.token_hash).not.toBe(token)
    expect(row?.token_hash).toBe(webTokenRepo.hashToken(token))
  })

  test('two tokens with the same label coexist (label is not a primary key)', () => {
    webTokenRepo.create(db, 'laptop')
    expect(() => webTokenRepo.create(db, 'laptop')).not.toThrow()
    expect(webTokenRepo.list(db)).toHaveLength(2)
  })
})
