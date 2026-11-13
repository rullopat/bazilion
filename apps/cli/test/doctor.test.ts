import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { HealthReport, PublicHealthResponse } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer({
    BAZILION_SCHEDULER: 'off',
    BROWSER_ENABLED: 'false',
    // Unset so the default (off) applies and `config set` can select docker below.
    BAZILION_BASH_SANDBOX: undefined,
    BAZILION_BASH_SANDBOX_IMAGE: 'bazilion-doctor-definitely-missing:v0',
  })
})
afterAll(async () => {
  await server?.stop()
})

async function health(): Promise<HealthReport> {
  const response = await fetch(`${server.url}/api/health/details`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(response.status).toBe(200)
  return response.json() as Promise<HealthReport>
}

test('actual doctor exits zero for a healthy install and states the runtime rule', async () => {
  const report = await health()
  expect(report.ok).toBe(true)
  expect(report.shellSecurity).toMatchObject({ ok: true, sandboxMode: 'off', docker: null })
  const publicReport = (await fetch(`${server.url}/api/health`).then((r) =>
    r.json(),
  )) as PublicHealthResponse
  expect(publicReport).toEqual({ ok: true })
  expect((await fetch(`${server.url}/api/health/details`)).status).toBe(401)
  const result = await server.cli(['doctor'])
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.stdout).toContain('install is healthy ✓')
  expect(result.stdout).toContain('agent runtime (every turn: chat, Telegram, schedules, inbox)')
  expect(result.stdout).toContain('sandbox: off — bash and file tools run on the host')
  expect(result.stdout).not.toContain('all good')
  expect(result.stdout).not.toContain('installation issues found')
})

test('actual doctor reports Docker readiness and remediation when the sandbox is docker', async () => {
  const set = await server.cli(['config', 'set', 'BAZILION_BASH_SANDBOX', 'docker'])
  expect(set.exitCode, set.stderr).toBe(0)
  try {
    const report = await health()
    expect(report.shellSecurity).toMatchObject({
      ok: true,
      sandboxMode: 'docker',
      docker: { ready: false, image: 'bazilion-doctor-definitely-missing:v0' },
    })
    const result = await server.cli(['doctor'])
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('sandbox: docker (bazilion-doctor-definitely-missing:v0)')
    expect(result.stdout).toContain('✗ Docker ready (bazilion-doctor-definitely-missing:v0)')
    expect(result.stdout).toContain('remediation:')
  } finally {
    const reset = await server.cli(['config', 'set', 'BAZILION_BASH_SANDBOX', 'off'])
    expect(reset.exitCode, reset.stderr).toBe(0)
  }
})

test('actual doctor still exits nonzero for a structural installation fault', async () => {
  rmSync(join(server.home, 'profiles'), { recursive: true })
  expect((await health()).ok).toBe(false)
  const result = await server.cli(['doctor'])
  expect(result.exitCode).toBe(1)
  expect(result.stdout).toContain('✗ profiles dir exists')
  expect(result.stdout).toContain('installation issues found ✗')
  expect(result.stdout).not.toContain('install is healthy ✓')
})
