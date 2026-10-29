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
    BAZILION_BASH_SANDBOX: 'off',
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

test('actual doctor exits zero for a healthy install while retaining unavailable protected diagnostics', async () => {
  const report = await health()
  expect(report.ok).toBe(true)
  expect(report.protectedWorkBaselineReady).toBe(false)
  const publicReport = (await fetch(`${server.url}/api/health`).then((r) =>
    r.json(),
  )) as PublicHealthResponse
  expect(Object.keys(publicReport).sort()).toEqual(['auth', 'ok'])
  expect(JSON.stringify(publicReport)).not.toContain('platformCapabilities')
  expect((await fetch(`${server.url}/api/health/details`)).status).toBe(401)
  const result = await server.cli(['doctor'])
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.stdout).toContain('install is healthy ✓')
  expect(result.stdout).toContain('ordinary chat execution: not checked')
  expect(result.stdout).toContain(
    process.platform === 'darwin'
      ? 'protected unattended baseline: not checked'
      : 'protected unattended baseline: unavailable',
  )
  expect(result.stdout).toContain('remediation:')
  expect(result.stdout).toContain('✓ MCP: denied')
  expect(result.stdout).toContain(`platform support: ${report.platformCapabilities.platform}`)
  expect(result.stdout).not.toContain('all good')
  expect(result.stdout).not.toContain('installation issues found')
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
