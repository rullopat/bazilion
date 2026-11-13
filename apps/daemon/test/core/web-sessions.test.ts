import { beforeEach, describe, expect, test } from 'vitest'
import {
  type BazilionDb,
  initSchema,
  openInMemoryDb,
  webSessionRepo,
  webTokenRepo,
} from '../../src/core/index.ts'

let db: BazilionDb
beforeEach(() => {
  db = openInMemoryDb('')
  initSchema(db)
})

const TTL = webSessionRepo.SESSION_TTL_MS

describe('webSessionRepo', () => {
  test('stores only hashes and authenticates an indexed id.secret cookie', () => {
    const device = webTokenRepo.create(db, 'browser')
    const created = webSessionRepo.create(db, device.meta.id, 1_000)
    expect(created.cookieValue).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/)
    expect(created.csrfToken).toMatch(/^[A-Za-z0-9_-]+$/)
    const row = db.raw
      .query<{ secret_hash: string; csrf_hash: string }, []>(
        'SELECT secret_hash, csrf_hash FROM web_sessions',
      )
      .get()
    expect(row?.secret_hash).not.toContain(created.cookieValue.split('.')[1] as string)
    expect(row?.csrf_hash).not.toBe(created.csrfToken)
    expect(webSessionRepo.authenticate(db, created.cookieValue, 2_000)?.id).toBe(created.session.id)
  })

  test('the lifetime slides forward on every use and ends after it goes unused', () => {
    const device = webTokenRepo.create(db, 'browser')
    const created = webSessionRepo.create(db, device.meta.id, 0)
    // Used just before it would expire: the expiry moves a full lifetime ahead.
    expect(webSessionRepo.authenticate(db, created.cookieValue, TTL - 1)).not.toBeNull()
    expect(webSessionRepo.authenticate(db, created.cookieValue, 2 * TTL - 2)).not.toBeNull()
    expect(webSessionRepo.list(db, {}, 2 * TTL - 2)[0]?.expiresAt).toBe(3 * TTL - 2)
    // Unused for a whole lifetime: gone.
    expect(webSessionRepo.authenticate(db, created.cookieValue, 3 * TTL - 2)).toBeNull()
    expect(webSessionRepo.list(db, {}, 3 * TTL - 2)).toEqual([])
  })

  test('the bootstrap token opens sessions too', () => {
    const bootstrap = webTokenRepo.create(db, 'bootstrap', { kind: 'bootstrap' })
    const created = webSessionRepo.create(db, bootstrap.meta.id)
    expect(webSessionRepo.authenticate(db, created.cookieValue)).toMatchObject({
      tokenId: bootstrap.meta.id,
      tokenLabel: 'bootstrap',
    })
  })

  test('a token without expiry keeps working; an expired token ends its sessions', () => {
    const forever = webTokenRepo.create(db, 'forever')
    expect(forever.meta.expiresAt).toBeNull()
    expect(webSessionRepo.create(db, forever.meta.id).session.tokenLabel).toBe('forever')

    const now = Date.now()
    const expiring = webTokenRepo.create(db, 'expiring', { expiresAt: now + 1_000 })
    const session = webSessionRepo.create(db, expiring.meta.id, now)
    expect(webSessionRepo.authenticate(db, session.cookieValue, now)).not.toBeNull()
    expect(webSessionRepo.authenticate(db, session.cookieValue, now + 1_000)).toBeNull()
    expect(() => webSessionRepo.create(db, expiring.meta.id, now + 1_000)).toThrow(
      'active credential required',
    )
  })

  test('revoking a token deletes its sessions without affecting another token', () => {
    const first = webTokenRepo.create(db, 'first')
    const second = webTokenRepo.create(db, 'second')
    const a = webSessionRepo.create(db, first.meta.id)
    const b = webSessionRepo.create(db, second.meta.id)
    webTokenRepo.revoke(db, first.meta.id)
    expect(webSessionRepo.revokeForToken(db, first.meta.id)).toBe(1)
    expect(webSessionRepo.authenticate(db, a.cookieValue)).toBeNull()
    expect(webSessionRepo.authenticate(db, b.cookieValue)?.tokenLabel).toBe('second')
    expect(webSessionRepo.revoke(db, b.session.id)).toBe(true)
    expect(webSessionRepo.revoke(db, b.session.id)).toBe(false)
    expect(webSessionRepo.authenticate(db, b.cookieValue)).toBeNull()
  })

  test('CSRF matches only the session-bound value and list never exposes hashes', () => {
    const device = webTokenRepo.create(db, 'browser')
    const created = webSessionRepo.create(db, device.meta.id)
    const session = webSessionRepo.authenticate(db, created.cookieValue)
    expect(session && webSessionRepo.csrfMatches(session, created.csrfToken)).toBe(true)
    expect(session && webSessionRepo.csrfMatches(session, 'wrong')).toBe(false)
    const listed = webSessionRepo.list(db, { currentId: created.session.id })[0]
    expect(listed?.current).toBe(true)
    expect((listed as unknown as { secretHash?: unknown }).secretHash).toBeUndefined()
  })
})
