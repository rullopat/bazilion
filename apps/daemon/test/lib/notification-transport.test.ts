import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openConfig } from '../../src/core/index.ts'
import * as acl from '../../src/core/repos/telegram-acl.ts'
import {
  installNotificationTransport,
  notificationDestinationAllowed,
  telegramNotificationTransport,
} from '../../src/lib/telegram/notification-transport.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
const verify = vi.fn()
const send = vi.fn()
beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'notification-fixture-token')
  vi.stubEnv('TELEGRAM_CHAT_ID', '-100')
  openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '7')
  acl.add(env.db, { userId: 123, role: 'owner' })
  verify.mockReset().mockResolvedValue(true)
  send.mockReset().mockResolvedValue({ message_id: 99 })
  installNotificationTransport(() => ({
    db: env.db,
    authToken: 'test',
    botToken: 'notification-fixture-token',
    verify,
    send,
  }))
})
afterEach(() => {
  installNotificationTransport(null)
  vi.unstubAllEnvs()
  env.cleanup()
})
test('capture requires live matching transport and owner, and reveals no plaintext credential', async () => {
  const transport = telegramNotificationTransport(env.db, 'test')
  const binding = transport.capture()
  if (!binding) throw new Error('Missing fixture binding')
  expect(JSON.stringify(binding)).not.toContain('notification-fixture-token')
  expect(await transport.verify(binding)).toBe(true)
  expect(verify).toHaveBeenCalledWith(-100, 123, expect.any(AbortSignal))
  installNotificationTransport(null)
  expect(transport.capture()).toBeNull()
  expect(await transport.verify(binding)).toBe(false)
  expect(() => transport.send(binding, 'notice', new AbortController().signal)).toThrow(
    'destination_changed',
  )
  expect(send).not.toHaveBeenCalled()
})
test('topic rebinding during remote validation prevents a ready result or stale send', async () => {
  const transport = telegramNotificationTransport(env.db, 'test')
  const binding = transport.capture()
  if (!binding) throw new Error('Missing fixture binding')
  verify.mockImplementationOnce(async () => {
    openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '8')
    return true
  })
  expect(await transport.verify(binding)).toBe(false)
  expect(() => transport.send(binding, 'notice', new AbortController().signal)).toThrow(
    'destination_changed',
  )
  expect(transport.capture()?.id).not.toBe(binding.id)
})
test('remote destination rejection and bot credential changes fail closed', async () => {
  const transport = telegramNotificationTransport(env.db, 'test')
  const binding = transport.capture()
  if (!binding) throw new Error('Missing fixture binding')
  verify.mockResolvedValueOnce(false)
  expect(await transport.verify(binding)).toBe(false)
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'changed-fixture-token')
  expect(transport.capture()).toBeNull()
  expect(await transport.verify(binding)).toBe(false)
})
test('revoking the paired owner invalidates a previously captured destination', async () => {
  const transport = telegramNotificationTransport(env.db, 'test')
  const binding = transport.capture()
  if (!binding) throw new Error('Missing fixture binding')
  env.db.raw.run("DELETE FROM telegram_allowed_users WHERE role='owner'")
  expect(transport.capture()).toBeNull()
  expect(await transport.verify(binding)).toBe(false)
  expect(() => transport.send(binding, 'notice', new AbortController().signal)).toThrow(
    'destination_changed',
  )
  expect(send).not.toHaveBeenCalled()
})
test('live destination facts require a private forum, present owner and capable bot', () => {
  const chat = { type: 'supergroup', is_forum: true }
  const owner = { status: 'member' }
  const bot = { status: 'administrator', can_manage_topics: true }
  expect(notificationDestinationAllowed(chat, owner, bot)).toBe(true)
  for (const changed of [
    { ...chat, username: 'public' },
    { ...chat, active_usernames: ['public'] },
    { ...chat, type: 'group' },
    { ...chat, is_forum: false },
  ])
    expect(notificationDestinationAllowed(changed, owner, bot)).toBe(false)
  for (const changed of [
    { status: 'left' },
    { status: 'kicked' },
    { status: 'restricted', is_member: false },
  ])
    expect(notificationDestinationAllowed(chat, changed, bot)).toBe(false)
  expect(notificationDestinationAllowed(chat, owner, { status: 'member' })).toBe(false)
  expect(
    notificationDestinationAllowed(chat, owner, {
      status: 'administrator',
      can_manage_topics: false,
    }),
  ).toBe(false)
})
