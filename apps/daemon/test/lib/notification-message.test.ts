import type { AttentionItem } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { ATTENTION_KINDS } from '../../src/core/attention.ts'
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
  title: 'PRIVATE_TITLE',
  diagnostic: '/home/operator/PRIVATE_ERROR',
  href: 'https://token:secret@evil.example/payload',
  acknowledgeable: true,
  acknowledgedAt: null,
}

test('all five templates omit source content and use escaped metadata with canonical authenticated links', () => {
  for (const kind of ATTENTION_KINDS) {
    const text = attentionNotificationMessage(
      { ...item, kind },
      { BAZILION_PUBLIC_ORIGIN: 'https://host.tail123.ts.net' },
    )
    expect(text).toContain('&lt;b&gt;Untrusted &amp; Agent&lt;/b&gt;')
    expect(text).toContain('href="https://host.tail123.ts.net/')
    expect(text).toContain('browser login required')
    expect(text).toContain('does not resolve')
    for (const privateValue of ['PRIVATE_', '/home/', 'secret', 'evil.example', 'payload'])
      expect(text).not.toContain(privateValue)
  }
})

test('absent, malformed, credential-bearing and loopback origins give navigation without links', () => {
  for (const origin of [
    undefined,
    'http://host.tail123.ts.net',
    'https://user:secret@host.tail123.ts.net',
    'https://host.tail123.ts.net/?token=secret',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
  ]) {
    const text = attentionNotificationMessage(item, { BAZILION_PUBLIC_ORIGIN: origin })
    expect(text).not.toContain('href=')
    expect(text).not.toContain('secret')
    expect(text).toContain('Open Bazilion web')
  }
})
