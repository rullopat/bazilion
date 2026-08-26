import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

// End-to-end coverage for the /config page's HTTP surface — provider
// enable/disable toggle and per-field storage dispatch.
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
  curated: string[]
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
  const res = await fetch(`${server.url}/api/config/services`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(res.ok).toBe(true)
  const body = (await res.json()) as {
    services: Array<{
      id: string
      fields: Array<{
        envVar: string
        kind: 'secret' | 'config'
        set: boolean
        value?: string
      }>
    }>
  }
  const service = body.services.find((entry) => entry.id === id)
  if (!service) throw new Error(`service ${id} missing from /api/config/services response`)
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

test('provider enable via API accepts {enabled: boolean} and round-trips state', async () => {
  const res = await fetch(`${server.url}/api/config/providers/anthropic/enabled`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${server.token}`,
      origin: server.url,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ enabled: true }),
  })
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

test('shell sandbox settings are configurable through the shared CLI and web service surface', async () => {
  const shellSecurity = await findService('shell-security')
  expect(shellSecurity.fields.map((field) => field.envVar)).toEqual([
    'BAZILION_BASH_APPROVAL',
    'BAZILION_BASH_SANDBOX',
    'BAZILION_BASH_SANDBOX_IMAGE',
    'BAZILION_BASH_SANDBOX_ENV_ALLOWLIST',
    'BAZILION_AGENT_LOOP_MAX_HOPS',
  ])

  const set = await server.cli(['config', 'set', 'BAZILION_BASH_SANDBOX', 'docker'])
  expect(set.exitCode).toBe(0)
  expect(set.stdout).toMatch(/BAZILION_BASH_SANDBOX.*docker/)

  const updated = await findService('shell-security')
  expect(updated.fields.find((field) => field.envVar === 'BAZILION_BASH_SANDBOX')).toMatchObject({
    kind: 'config',
    set: true,
    value: 'docker',
  })
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
