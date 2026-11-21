import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

// End-to-end coverage for Setup's HTTP surface: the provider on/off switch and
// per-field storage dispatch. Connecting a provider is in provider-connect.test.ts.
//
// The server fixture enables `lmstudio` + `ollama` by default (see
// `initHome` in server-fixture.ts). These tests explicitly toggle them to
// verify the switch flows through the API, the DB, and back out via the
// `/api/config/providers` endpoint the web UI + CLI both consume.

let server: TestServer

beforeAll(async () => {
  server = await startTestServer()
})
afterAll(async () => {
  await server.stop()
})
beforeEach(() => server.reset())

interface ProviderEntry {
  id: string
  enabled: boolean
  models: string[]
  fields: { envVar: string; kind: 'secret' | 'config'; set: boolean }[]
}

async function fetchProviders(): Promise<ProviderEntry[]> {
  const res = await fetch(`${server.url}/api/config/providers`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(res.ok).toBe(true)
  const body = (await res.json()) as { providers: ProviderEntry[] }
  return body.providers
}

async function findProvider(id: string): Promise<ProviderEntry> {
  const providers = await fetchProviders()
  const p = providers.find((x) => x.id === id)
  if (!p) throw new Error(`provider ${id} missing from /api/config/providers response`)
  return p
}

async function findService(id: string): Promise<{
  id: string
  fields: Array<{
    envVar: string
    kind: 'secret' | 'config'
    set: boolean
    value?: string
  }>
}> {
  const res = await fetch(`${server.url}/api/config/tools`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(res.ok).toBe(true)
  const body = (await res.json()) as {
    tools: Array<{
      id: string
      fields: Array<{
        envVar: string
        kind: 'secret' | 'config'
        set: boolean
        value?: string
      }>
    }>
  }
  const service = body.tools.find((entry) => entry.id === id)
  if (!service) throw new Error(`tool ${id} missing from /api/config/tools response`)
  return service
}

test('provider toggle defaults respect the test fixture seed (lmstudio enabled)', async () => {
  const lmstudio = await findProvider('lmstudio')
  expect(lmstudio.enabled).toBe(true)
  const anthropic = await findProvider('anthropic')
  expect(anthropic.enabled).toBe(false)
})

test('bazilion provider disable + enable round-trip via CLI', async () => {
  const before = await findProvider('lmstudio')
  expect(before.enabled).toBe(true)

  const off = await server.cli(['provider', 'disable', 'lmstudio'])
  expect(off.exitCode).toBe(0)
  expect(off.stdout).toContain('disabled')

  const mid = await findProvider('lmstudio')
  expect(mid.enabled).toBe(false)

  const on = await server.cli(['provider', 'enable', 'lmstudio'])
  expect(on.exitCode).toBe(0)
  expect(on.stdout).toContain('enabled')

  const after = await findProvider('lmstudio')
  expect(after.enabled).toBe(true)
})

test('a provider is switched on through the API only once it has credentials', async () => {
  const put = () =>
    fetch(`${server.url}/api/config/providers/anthropic/enabled`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${server.token}`,
        origin: server.url,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    })
  expect((await put()).status).toBe(409)
  await server.cli(['config', 'set', 'ANTHROPIC_API_KEY', 'sk-ant-testing-1234567890'])
  const res = await put()
  expect(res.status).toBe(200)
  const body = (await res.json()) as { name: string; enabled: boolean }
  expect(body).toEqual({ name: 'anthropic', enabled: true })
  const anthropic = await findProvider('anthropic')
  expect(anthropic.enabled).toBe(true)
})

test('toggling an unknown provider returns 404', async () => {
  const res = await fetch(`${server.url}/api/config/providers/martian/enabled`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${server.token}`,
      origin: server.url,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ enabled: true }),
  })
  expect(res.status).toBe(404)
})

test('bazilion config set routes config-kind fields to plaintext store', async () => {
  const set = await server.cli(['config', 'set', 'LMSTUDIO_URL', 'http://127.0.0.1:9999/v1'])
  expect(set.exitCode).toBe(0)
  // CLI echoes "(config)" for the kind.
  expect(set.stdout).toMatch(/LMSTUDIO_URL.*\(config\)/)
  expect(set.stdout).toContain('http://127.0.0.1:9999/v1')

  // Verify it lands in the provider fields state.
  const lmstudio = await findProvider('lmstudio')
  const url = lmstudio.fields.find((f) => f.envVar === 'LMSTUDIO_URL')
  expect(url?.set).toBe(true)
})

test('the Commands settings are the same from the CLI and the Tools page, and are checked', async () => {
  const commands = await findService('commands')
  expect(commands.fields.map((field) => field.envVar)).toEqual([
    'BAZILION_BASH_SANDBOX',
    'BAZILION_BASH_APPROVAL',
    'BAZILION_BASH_SANDBOX_IMAGE',
  ])

  const invalid = await server.cli(['config', 'set', 'BAZILION_BASH_SANDBOX', 'bogus'])
  expect(invalid.exitCode).not.toBe(0)
  expect(`${invalid.stdout}${invalid.stderr}`).toContain(
    'BAZILION_BASH_SANDBOX must be one of: off, docker',
  )
  // A mistyped approval mode used to be stored, and then failed every turn.
  const typo = await server.cli(['config', 'set', 'BAZILION_BASH_APPROVAL', 'Dangerous'])
  expect(typo.exitCode).not.toBe(0)
  expect(`${typo.stdout}${typo.stderr}`).toContain('must be dangerous or off')
  const set = await server.cli(['config', 'set', 'BAZILION_BASH_SANDBOX', 'docker'])
  expect(set.exitCode).toBe(0)
  expect(set.stdout).toMatch(/BAZILION_BASH_SANDBOX.*docker/)

  const updated = await findService('commands')
  expect(updated.fields.find((field) => field.envVar === 'BAZILION_BASH_SANDBOX')).toMatchObject({
    kind: 'config',
    set: true,
    value: 'docker',
  })
  expect((await server.cli(['config', 'rm', 'BAZILION_BASH_SANDBOX'])).exitCode).toBe(0)
})

test('several settings are saved together or not at all; yes and no are stored as true and false', async () => {
  const mixed = await server.cli([
    'config',
    'set',
    'BROWSER_MAX_SESSIONS=2',
    'BROWSER_IDLE_MS=soon',
  ])
  expect(mixed.exitCode).not.toBe(0)
  expect(`${mixed.stdout}${mixed.stderr}`).toContain('BROWSER_IDLE_MS must be a whole number')
  const browser = await findService('browser')
  expect(browser.fields.find((field) => field.envVar === 'BROWSER_MAX_SESSIONS')?.set).toBe(false)

  const saved = await server.cli([
    'config',
    'set',
    'BROWSER_MAX_SESSIONS=2',
    'BROWSER_HEADLESS=no',
    'SEARXNG_URL=https://search.example.com',
  ])
  expect(saved.exitCode).toBe(0)
  expect(saved.stdout).toMatch(/BROWSER_MAX_SESSIONS \(config\): 2/)
  expect(saved.stdout).toMatch(/BROWSER_HEADLESS \(config\): false/)
  const one = await server.cli(['config', 'set', 'BROWSER_MAX_SESSIONS'])
  expect(one.exitCode).not.toBe(0)

  const listed = await server.cli(['config', 'list'])
  expect(listed.stdout).toMatch(/browser\s+BROWSER_MAX_SESSIONS\s+config\s+2\b/)
  expect(listed.stdout).toMatch(/browser\s+BROWSER_ENABLED\s+config\s+true \(default\)/)
  expect(listed.stdout).toContain('Web search: Using SearXNG')
  expect(listed.stdout).toContain('Browser: On: a browser per Agent')
  expect(listed.stdout).toContain('BROWSER_ENABLED: true or false')
  expect(listed.stdout).toMatch(
    /BAZILION_WEB_SEARCH_ROUTE: auto \(Automatic\), brave \(Brave Search\)/,
  )
  for (const name of ['BROWSER_MAX_SESSIONS', 'BROWSER_HEADLESS', 'SEARXNG_URL']) {
    expect((await server.cli(['config', 'rm', name])).exitCode).toBe(0)
  }
})

test('bazilion config set routes secret-kind fields to encrypted store', async () => {
  const set = await server.cli(['config', 'set', 'ANTHROPIC_API_KEY', 'sk-ant-testing-1234567890'])
  expect(set.exitCode).toBe(0)
  expect(set.stdout).toMatch(/ANTHROPIC_API_KEY.*\(secret\)/)
  // Secret should be displayed as a masked preview, not the full value.
  expect(set.stdout).not.toContain('sk-ant-testing-1234567890')

  const anthropic = await findProvider('anthropic')
  const key = anthropic.fields.find((f) => f.envVar === 'ANTHROPIC_API_KEY')
  expect(key?.set).toBe(true)
})

test('bazilion config rm clears both kinds', async () => {
  await server.cli(['config', 'set', 'LMSTUDIO_URL', 'http://example.com/v1'])
  await server.cli(['config', 'set', 'OPENAI_API_KEY', 'sk-test-key-abcdefgh'])

  const rmUrl = await server.cli(['config', 'rm', 'LMSTUDIO_URL'])
  expect(rmUrl.exitCode).toBe(0)
  const rmKey = await server.cli(['config', 'rm', 'OPENAI_API_KEY'])
  expect(rmKey.exitCode).toBe(0)

  const lmstudio = await findProvider('lmstudio')
  expect(lmstudio.fields.find((f) => f.envVar === 'LMSTUDIO_URL')?.set).toBe(false)
  const openai = await findProvider('openai')
  expect(openai.fields.find((f) => f.envVar === 'OPENAI_API_KEY')?.set).toBe(false)
})

test('bazilion config set rejects unknown envVars', async () => {
  const r = await server.cli(['config', 'set', 'TOTALLY_MADE_UP_KEY', 'x'])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toMatch(/unknown envVar/i)
})

// SSR-regression coverage that previously asserted the rendered /config HTML
// matched provider_state lived here. After the daemon split, the test fixture
// boots only the daemon (the canonical /api/* surface). The SSR page now
// renders exclusively from the same `/api/config/providers` response we
// already exercise above — those API checks are the load-bearing assertions.
