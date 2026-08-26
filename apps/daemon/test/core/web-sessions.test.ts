import { beforeEach, describe, expect, test } from 'vitest'
import {
  type BazilionDb,
  openInMemoryDb,
  runMigrations,
  webSessionRepo,
  webTokenRepo,
} from '../../src/core/index.ts'

let db: BazilionDb
beforeEach(() => {
  db = openInMemoryDb()
  runMigrations(db)
})

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

  test('idle and absolute expiry fail closed', () => {
    const device = webTokenRepo.create(db, 'browser', { expiresAt: 20 * 86_400_000 })
    const idle = webSessionRepo.create(db, device.meta.id, 0)
    expect(
      webSessionRepo.authenticate(db, idle.cookieValue, webSessionRepo.SESSION_IDLE_MS),
    ).toBeNull()
    const absolute = webSessionRepo.create(db, device.meta.id, 0)
    expect(
      webSessionRepo.authenticate(db, absolute.cookieValue, webSessionRepo.SESSION_ABSOLUTE_MS),
    ).toBeNull()
  })

  test('device revocation invalidates its sessions without affecting another device', () => {
    const first = webTokenRepo.create(db, 'first')
    const second = webTokenRepo.create(db, 'second')
    const a = webSessionRepo.create(db, first.meta.id)
    const b = webSessionRepo.create(db, second.meta.id)
    webTokenRepo.revoke(db, first.meta.id)
    webSessionRepo.revokeForDevice(db, first.meta.id)
    expect(webSessionRepo.authenticate(db, a.cookieValue)).toBeNull()
    expect(webSessionRepo.authenticate(db, b.cookieValue)?.deviceLabel).toBe('second')
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
