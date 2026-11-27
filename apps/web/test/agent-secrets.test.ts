import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { SecretsView } from '../src/components/agent/AgentSecrets.tsx'
import { SecretCard } from '../src/components/chat/AgentQuestions.tsx'

test("an Agent's secrets show by name, where they go and why, and never a value", () => {
  const html = renderToStaticMarkup(
    createElement(SecretsView, {
      agentId: 'agent-1',
      agentName: 'Mira',
      secrets: [
        {
          name: 'GITHUB_TOKEN',
          reason: 'Open pull requests',
          hosts: ['api.github.com'],
          storedAt: Date.UTC(2026, 10, 27, 9),
        },
        { name: 'NPM_TOKEN', reason: null, hosts: [], storedAt: 0 },
      ],
      onChanged: async () => {},
    }),
  )
  expect(html).toContain('GITHUB_TOKEN')
  expect(html).toContain('api.github.com')
  expect(html).toContain('Open pull requests')
  expect(html).toContain('Commands only')
  expect(html).toContain('Add a secret')
  expect(html).toContain('More for NPM_TOKEN')
})

test('a secret request asks in a masked field, says where it goes, and can be declined', () => {
  const html = renderToStaticMarkup(
    createElement(SecretCard, {
      agentName: 'Mira',
      item: {
        id: 'q1',
        agentId: 'agent-1',
        conversationId: 'c1',
        createdAt: 0,
        expiresAt: null,
        question: {
          secret: { name: 'SENTRY_TOKEN', reason: 'Read the errors', hosts: ['sentry.io'] },
        },
      },
    }),
  )
  expect(html).toContain('Mira asks for a secret')
  expect(html).toContain('SENTRY_TOKEN')
  expect(html).toContain('type="password"')
  expect(html).toContain('autoComplete="off"')
  expect(html).toContain('sentry.io')
  expect(html).toContain('Mira never sees the value')
  expect(html).toContain('Decline')
})
