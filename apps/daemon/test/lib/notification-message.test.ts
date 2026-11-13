import type { AttentionItem } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { attentionNotificationMessage } from '../../src/lib/notification-message.ts'

const item: AttentionItem = {
  key: 'trigger_failure:fixture',
  kind: 'trigger_failure',
  sourceId: 'fixture',
  severity: 'error',
  occurredAt: 0,
  updatedAt: 0,
  agentId: '604146ba-133d-4e07-8ea3-d17162b6d90e',
  agentName: '<b>Untrusted & Agent</b>',
  teamId: 'team',
  teamName: 'Team',
  title: 'Scheduled trigger failed',
  diagnostic: '/home/operator/PRIVATE_ERROR',
  href: '/agents/604146ba-133d-4e07-8ea3-d17162b6d90e',
  acknowledgeable: true,
  acknowledgedAt: null,
}

test('a notice names the item and its Agent, escaped, and links it through the public origin', () => {
  const text = attentionNotificationMessage(item, {
    BAZILION_PUBLIC_ORIGIN: 'https://host.tail123.ts.net',
  })
  expect(text).toContain('<b>Scheduled trigger failed</b>')
  expect(text).toContain('&lt;b&gt;Untrusted &amp; Agent&lt;/b&gt;')
  expect(text).toContain(`href="https://host.tail123.ts.net${item.href}"`)
  expect(text).not.toContain('PRIVATE_ERROR')
})

test('without a published non-loopback origin there is no link', () => {
  for (const origin of [
    undefined,
    'http://host.tail123.ts.net',
    'https://user:secret@host.tail123.ts.net',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
  ]) {
    const text = attentionNotificationMessage(item, { BAZILION_PUBLIC_ORIGIN: origin })
    expect(text).not.toContain('href=')
    expect(text).not.toContain('secret')
    expect(text).toContain('Open Bazilion')
  }
})
