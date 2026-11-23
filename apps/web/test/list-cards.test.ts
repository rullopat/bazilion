// What the MCP and Access cards put on the page for what the daemon reports. Their forms and
// buttons are walked in a browser.
import type { McpServer, WebSession, WebToken } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { MintTokenCard, SessionsCard, TokensCard } from '../src/components/setup/AccessCards.tsx'
import { AddServerCard, ServersCard } from '../src/components/setup/McpCards.tsx'

const done = async () => {}
/** The rows of a card's list, each as its text. */
const rows = (html: string): string[] =>
  Array.from(html.matchAll(/<li [^>]*>(.*?)<\/li>/g), (match) =>
    (match[1] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )

const server = (more: Partial<McpServer>): McpServer => ({
  id: 's1',
  name: 'files',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@scope/server', '/srv/data'],
  url: null,
  hasAuthToken: false,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  ...more,
})

test('the Servers card lists each server with its state, how it is reached and what can be done', () => {
  const html = renderToStaticMarkup(
    createElement(ServersCard, {
      servers: [
        server({}),
        server({
          id: 's2',
          name: 'docs_search',
          transport: 'http',
          command: null,
          args: [],
          url: 'https://mcp.example.com/mcp',
          hasAuthToken: true,
          enabled: false,
        }),
      ],
      onChanged: done,
    }),
  )
  expect(html).toContain('1 of 2 on')
  expect(rows(html)).toEqual([
    'files Enabled stdio asks you before tools that send or change something npx -y @scope/server /srv/data Test Variables Disable Delete',
    'docs_search Disabled http bearer token asks you before tools that send or change something https://mcp.example.com/mcp Test Enable Delete',
  ])
  // Each button says which server it is for.
  for (const name of ['Test files', 'Disable files', 'Delete files', 'Enable docs_search']) {
    expect(html).toContain(`aria-label="${name}"`)
  }
  // The token itself is never part of the page.
  expect(html).not.toContain('type="password"')
})

test('with no server the card says so and claims no state', () => {
  const html = renderToStaticMarkup(createElement(ServersCard, { servers: [], onChanged: done }))
  expect(html).toContain('No MCP servers yet; add one above.')
  expect(rows(html)).toEqual([])
  expect(html).not.toContain('servers on')
})

test('the add form starts on stdio and cannot be sent empty', () => {
  const html = renderToStaticMarkup(createElement(AddServerCard, { onAdded: done }))
  for (const label of ['Name', 'Transport', 'Command', 'Args (space-separated)']) {
    expect(html).toContain(`>${label}</label>`)
  }
  expect(html).not.toContain('>URL</label>')
  expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Add server<\/button>/)
  expect(html).toMatch(/role="combobox"[^>]*>.*>stdio<\/span>/)
})

const now = Date.UTC(2026, 10, 22, 12, 0)
const token = (more: Partial<WebToken>): WebToken => ({
  id: 'b6a695b7',
  label: 'laptop-tailscale',
  kind: 'device',
  createdAt: Date.UTC(2026, 10, 21, 23, 13),
  lastUsedAt: null,
  expiresAt: Date.UTC(2026, 11, 21, 23, 13),
  revokedAt: null,
  ...more,
})
const session = (more: Partial<WebSession>): WebSession => ({
  id: '3a1d0214',
  tokenId: 'boot',
  tokenLabel: 'bootstrap',
  createdAt: now - 1000,
  lastSeenAt: Date.UTC(2026, 10, 22, 11, 58),
  expiresAt: Date.UTC(2026, 11, 22, 11, 58),
  current: true,
  ...more,
})

test('the Tokens card shows what each token is and offers to revoke only what can be revoked', () => {
  const html = renderToStaticMarkup(
    createElement(TokensCard, {
      tokens: [
        token({
          id: 'boot',
          label: 'bootstrap',
          kind: 'bootstrap',
          expiresAt: null,
          lastUsedAt: now,
        }),
        token({}),
        token({ id: 'old', label: 'ci-script', revokedAt: now - 5, expiresAt: null }),
        token({ id: 'gone', label: 'phone', expiresAt: now - 1 }),
      ],
      sessions: [session({})],
      includeRevoked: true,
      now,
      onRevoked: done,
    }),
  )
  expect(rows(html)).toEqual([
    'bootstrap Active bootstrap (auth.json) created 2026-11-21 23:13 last used 2026-11-22 12:00 expires never boot',
    'laptop-tailscale Active device created 2026-11-21 23:13 last used never expires 2026-12-21 23:13 b6a695b7 Revoke',
    'ci-script Revoked device created 2026-11-21 23:13 last used never expires never old',
    'phone Expired device created 2026-11-21 23:13 last used never expires 2026-11-22 11:59 gone Revoke',
  ])
  expect(html).toContain('aria-label="Revoke laptop-tailscale"')
  expect(html).toContain('href="/config/access"')
  expect(html).toContain('>Hide revoked<')

  const hidden = renderToStaticMarkup(
    createElement(TokensCard, {
      tokens: [],
      sessions: [],
      includeRevoked: false,
      now,
      onRevoked: done,
    }),
  )
  expect(hidden).toContain('href="/config/access?all=1"')
  expect(hidden).toContain('>Show revoked<')
  expect(hidden).toContain('No tokens yet; mint one above.')
})

test('the sessions card marks the browser that is looking at it', () => {
  const html = renderToStaticMarkup(
    createElement(SessionsCard, {
      sessions: [
        session({}),
        session({ id: 'other', tokenLabel: 'laptop-tailscale', current: false }),
      ],
      onRevoked: done,
    }),
  )
  expect(rows(html)).toEqual([
    'bootstrap This browser last seen 2026-11-22 11:58 expires 2026-12-22 11:58 3a1d0214 Revoke',
    'laptop-tailscale last seen 2026-11-22 11:58 expires 2026-12-22 11:58 other Revoke',
  ])
  expect(html).toContain('aria-label="Revoke the session of this browser"')
  expect(
    renderToStaticMarkup(createElement(SessionsCard, { sessions: [], onRevoked: done })),
  ).toContain('No active browser sessions.')
})

test('minting starts with an empty form, no token on show, and Create off', () => {
  const html = renderToStaticMarkup(createElement(MintTokenCard, { onMinted: done }))
  expect(html).toContain('>Label</label>')
  expect(html).toContain('>Expires in days</label>')
  expect(html).toContain('placeholder="never"')
  expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Create<\/button>/)
  expect(html).not.toContain('Copy this token now')
})
