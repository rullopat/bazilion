import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())

test('a common connection is added with its token kept secret, and its tools can ask first', async () => {
  const presets = await server.cli(['mcp', 'presets'])
  expect(presets.stdout).toContain('microsoft365\tMicrosoft 365')
  expect(presets.stdout).toContain('--env NOTION_TOKEN=')

  const missing = await server.cli(['mcp', 'add', 'notion', '--preset', 'notion'])
  expect(missing.exitCode).not.toBe(0)
  expect(missing.stderr).toContain('--env NOTION_TOKEN=')

  const added = await server.cli([
    'mcp',
    'add',
    'notion',
    '--preset',
    'notion',
    '--env',
    'NOTION_TOKEN=ntn_PRIVATE_VALUE',
    '--disabled',
  ])
  expect(added.exitCode, added.stderr).toBe(0)
  const id = added.stdout.split('\t')[0] ?? ''
  const shown = await server.cli(['mcp', 'show', id])
  expect(shown.stdout).toContain('"NOTION_TOKEN"')
  expect(shown.stdout).toContain('"@notionhq/notion-mcp-server"')
  expect(shown.stdout).not.toContain('ntn_PRIVATE_VALUE')

  const set = await server.cli([
    'mcp',
    'set',
    id,
    '--ask',
    'API-retrieve-a-page',
    '--skip',
    'API-patch-page',
  ])
  expect(set.stdout).toContain(
    'asks first: by default, except API-retrieve-a-page (asks), API-patch-page (never asks)',
  )
  const back = await server.cli(['mcp', 'set', id, '--ask', 'default'])
  expect(back.stdout).toContain('asks first: by default')

  // A typo in an option, or a flag the preset sets itself, is refused rather than ignored.
  const typo = await server.cli(['mcp', 'add', 'm', '--preset', 'microsoft365', '--option', 'orgs'])
  expect(typo.stderr).toContain('Microsoft 365 has no option orgs; its options: org')
  const both = await server.cli(['mcp', 'add', 'n', '--preset', 'notion', '--command', 'x'])
  expect(both.stderr).toContain('--preset sets how it runs: leave out --command')
})
