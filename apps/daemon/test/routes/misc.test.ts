import { afterEach, expect, test } from 'vitest'
import { miscRouter } from '../../src/routes/misc.ts'

const originalEnforcement = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
const originalSandbox = process.env.BAZILION_BASH_SANDBOX
const originalSandboxImage = process.env.BAZILION_BASH_SANDBOX_IMAGE
const originalApproval = process.env.BAZILION_BASH_APPROVAL
const originalAllowlist = process.env.BAZILION_BASH_SANDBOX_ENV_ALLOWLIST
const originalBraveKey = process.env.BRAVE_API_KEY
const originalSearxngUrl = process.env.SEARXNG_URL
const originalLmstudioUrl = process.env.LMSTUDIO_URL
const originalLmstudioKey = process.env.LMSTUDIO_API_KEY
const originalOllamaUrl = process.env.OLLAMA_URL
const originalOpenaiKey = process.env.OPENAI_API_KEY

afterEach(() => {
  if (originalEnforcement === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = originalEnforcement
  if (originalSandbox === undefined) delete process.env.BAZILION_BASH_SANDBOX
  else process.env.BAZILION_BASH_SANDBOX = originalSandbox
  if (originalSandboxImage === undefined) delete process.env.BAZILION_BASH_SANDBOX_IMAGE
  else process.env.BAZILION_BASH_SANDBOX_IMAGE = originalSandboxImage
  if (originalApproval === undefined) delete process.env.BAZILION_BASH_APPROVAL
  else process.env.BAZILION_BASH_APPROVAL = originalApproval
  if (originalAllowlist === undefined) delete process.env.BAZILION_BASH_SANDBOX_ENV_ALLOWLIST
  else process.env.BAZILION_BASH_SANDBOX_ENV_ALLOWLIST = originalAllowlist
  if (originalBraveKey === undefined) delete process.env.BRAVE_API_KEY
  else process.env.BRAVE_API_KEY = originalBraveKey
  if (originalSearxngUrl === undefined) delete process.env.SEARXNG_URL
  else process.env.SEARXNG_URL = originalSearxngUrl
  if (originalLmstudioUrl === undefined) delete process.env.LMSTUDIO_URL
  else process.env.LMSTUDIO_URL = originalLmstudioUrl
  if (originalLmstudioKey === undefined) delete process.env.LMSTUDIO_API_KEY
  else process.env.LMSTUDIO_API_KEY = originalLmstudioKey
  if (originalOllamaUrl === undefined) delete process.env.OLLAMA_URL
  else process.env.OLLAMA_URL = originalOllamaUrl
  if (originalOpenaiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalOpenaiKey
})

test('health exposes the release-ready teamPolicy management contract with enforcement off', async () => {
  delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  const response = await miscRouter.request('/health')
  expect(response.status).toBe(200)
  const report = (await response.json()) as {
    teamPolicyManagement: {
      contractVersion: number
      enforcementRequested: boolean
      releaseReady: boolean
    }
  }
  expect(report.teamPolicyManagement).toEqual({
    contractVersion: 1,
    enforcementRequested: false,
    enforcementActive: false,
    releaseReady: true,
    degraded: false,
    decisions: { allowed: 0, denied: 0 },
  })
})

test('health reports active enforcement when requested by a release-ready build', async () => {
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    teamPolicyManagement: { enforcementRequested: boolean; releaseReady: boolean }
  }
  expect(report.teamPolicyManagement).toMatchObject({
    enforcementRequested: true,
    enforcementActive: true,
    releaseReady: true,
    degraded: false,
  })
})

test('health reports the default-off host shell posture', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    shellSecurity: unknown
  }

  expect(report.shellSecurity).toEqual({
    ok: true,
    sandboxMode: 'off',
    approvalMode: 'off',
    sandboxImage: 'debian:bookworm-slim',
    hostCodingTools: true,
    network: 'host',
  })
})

test('health reports the opt-in Docker confinement posture', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'docker'
  process.env.BAZILION_BASH_SANDBOX_IMAGE = 'example.test/bazilion-shell:v1'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    shellSecurity: unknown
  }

  expect(report.shellSecurity).toEqual({
    ok: true,
    sandboxMode: 'docker',
    approvalMode: 'off',
    sandboxImage: 'example.test/bazilion-shell:v1',
    hostCodingTools: false,
    network: 'none',
  })
})

test('health reports dangerous-command approval independently from sandboxing', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  process.env.BAZILION_BASH_APPROVAL = 'dangerous'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as { shellSecurity: unknown }

  expect(report.shellSecurity).toMatchObject({
    ok: true,
    sandboxMode: 'off',
    approvalMode: 'dangerous',
    hostCodingTools: true,
    network: 'host',
  })
})

test('health separates configured operator HTTP from protected unattended execution', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    protectedWorkBaselineReady: boolean
    executionSecurity: {
      configuredOperatorHttp: {
        protected: boolean
        codingSurface: string
        browser: string
        mcp: string
      }
      protectedUnattendedTurns: {
        baseRuntimeReady: boolean
        codingSurface: string
        docker: { ready: boolean; reason: string | null }
        browser: string
        mcp: string
        openaiCodex: {
          enabled: boolean
          connected: boolean
          accessCurrent: boolean
          refreshOnNextTurn: boolean
          baselineEligible: boolean
        }
        remediation: string | null
      }
    }
  }

  expect(report.executionSecurity.configuredOperatorHttp).toMatchObject({
    protected: false,
    codingSurface: 'host',
  })
  const protectedTurns = report.executionSecurity.protectedUnattendedTurns
  expect(protectedTurns.codingSurface).toBe('docker')
  expect(protectedTurns.browser).toBe('denied')
  expect(protectedTurns.mcp).toBe('denied')
  expect(typeof protectedTurns.baseRuntimeReady).toBe('boolean')
  expect(typeof protectedTurns.openaiCodex.enabled).toBe('boolean')
  expect(typeof protectedTurns.openaiCodex.connected).toBe('boolean')
  expect(typeof protectedTurns.openaiCodex.accessCurrent).toBe('boolean')
  expect(typeof protectedTurns.openaiCodex.refreshOnNextTurn).toBe('boolean')
  expect(typeof protectedTurns.openaiCodex.baselineEligible).toBe('boolean')
  expect(protectedTurns.openaiCodex.baselineEligible).toBe(
    protectedTurns.openaiCodex.enabled && protectedTurns.openaiCodex.connected,
  )
  expect(protectedTurns.openaiCodex.refreshOnNextTurn).toBe(
    protectedTurns.openaiCodex.connected && !protectedTurns.openaiCodex.accessCurrent,
  )
  expect(protectedTurns.baseRuntimeReady).toBe(
    protectedTurns.docker.ready && protectedTurns.openaiCodex.baselineEligible,
  )
  expect(report.protectedWorkBaselineReady).toBe(protectedTurns.baseRuntimeReady)
  expect(Object.keys(protectedTurns.docker).sort()).toEqual(['image', 'ready', 'reason'])
  if (protectedTurns.remediation) {
    expect(protectedTurns.remediation).not.toMatch(/bearer|api[_-]?key|token|password/i)
  } else expect(protectedTurns.baseRuntimeReady).toBe(true)
})

test('health fails closed on an invalid shell-security mode', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'raw-shell-mode-sentinel'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    ok: boolean
    shellSecurity: { ok: boolean; error: string }
  }

  expect(report.ok).toBe(false)
  expect(report.shellSecurity.ok).toBe(false)
  expect(report.shellSecurity.error).toBe('Sandbox mode must be "off" or "docker".')
  expect(JSON.stringify(report)).not.toContain('raw-shell-mode-sentinel')
})

test('health fails closed on an invalid dangerous-command approval policy', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  process.env.BAZILION_BASH_APPROVAL = 'raw-approval-sentinel'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    ok: boolean
    shellSecurity: { ok: boolean; error: string }
  }

  expect(report.ok).toBe(false)
  expect(report.shellSecurity.ok).toBe(false)
  expect(report.shellSecurity.error).toBe(
    'Dangerous-command approval must be "off" or "dangerous".',
  )
  expect(JSON.stringify(report)).not.toContain('raw-approval-sentinel')
})

test('health keeps structural ok separate from protected-work baseline readiness', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  process.env.BAZILION_BASH_SANDBOX_IMAGE = 'bazilion-health-definitely-missing:v0'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    ok: boolean
    protectedWorkBaselineReady: boolean
    paths: Record<string, boolean>
    database: { ok: boolean } | null
    skills: { parseErrors: number }
    shellSecurity: { ok: boolean }
    executionSecurity: { protectedUnattendedTurns: { baseRuntimeReady: boolean } }
  }

  const expectedStructural =
    Object.values(report.paths).every(Boolean) &&
    (report.database === null || report.database.ok) &&
    report.skills.parseErrors === 0 &&
    report.shellSecurity.ok
  expect(report.ok).toBe(expectedStructural)
  expect(report.protectedWorkBaselineReady).toBe(false)
  expect(report.protectedWorkBaselineReady).toBe(
    report.executionSecurity.protectedUnattendedTurns.baseRuntimeReady,
  )
})

test('public health exposes only booleans and fixed diagnostics for configured secrets and URLs', async () => {
  const sentinels = [
    'brave-secret-sentinel',
    'searxng-url-sentinel',
    'lmstudio-url-sentinel',
    'lmstudio-key-sentinel',
    'ollama-url-sentinel',
    'openai-key-sentinel',
    'shell-value-sentinel',
  ] as const
  process.env.BRAVE_API_KEY = sentinels[0]
  process.env.SEARXNG_URL = `https://${sentinels[1]}.example`
  process.env.LMSTUDIO_URL = `https://${sentinels[2]}.example/v1`
  process.env.LMSTUDIO_API_KEY = sentinels[3]
  process.env.OLLAMA_URL = `https://${sentinels[4]}.example/v1`
  process.env.OPENAI_API_KEY = sentinels[5]
  process.env.BAZILION_BASH_SANDBOX = sentinels[6]

  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    providers: {
      configured: string[]
      lmstudio: { customEndpointConfigured: boolean; keyConfigured: boolean }
      ollama: { customEndpointConfigured: boolean }
    }
    webSearch: { braveConfigured: boolean; searxngConfigured: boolean }
    shellSecurity: { ok: false; error: string }
  }

  expect(report.providers.configured).toContain('openai')
  expect(report.providers.lmstudio).toEqual({
    customEndpointConfigured: true,
    keyConfigured: true,
  })
  expect(report.providers.ollama).toEqual({ customEndpointConfigured: true })
  expect(report.webSearch).toEqual({ braveConfigured: true, searxngConfigured: true })
  expect(report.shellSecurity.error).toBe('Sandbox mode must be "off" or "docker".')
  const serialized = JSON.stringify(report)
  for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel)
  expect(serialized).not.toContain('bravePreview')
  expect(serialized).not.toContain('searxngUrl')
  expect(serialized).not.toContain('baseURL')
})

test('health replaces invalid image and allowlist values with fixed diagnostics', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  process.env.BAZILION_BASH_SANDBOX_IMAGE = 'raw image sentinel'
  let response = await miscRouter.request('/health')
  let report = (await response.json()) as { shellSecurity: { ok: false; error: string } }
  expect(report.shellSecurity.error).toBe('Docker image must use a valid local image reference.')
  expect(JSON.stringify(report)).not.toContain('raw image sentinel')

  process.env.BAZILION_BASH_SANDBOX_IMAGE = 'debian:bookworm-slim'
  process.env.BAZILION_BASH_SANDBOX_ENV_ALLOWLIST = 'raw-allowlist-sentinel!'
  response = await miscRouter.request('/health')
  report = (await response.json()) as { shellSecurity: { ok: false; error: string } }
  expect(report.shellSecurity.error).toBe(
    'Shell environment allowlist contains an invalid or unsafe variable name.',
  )
  expect(JSON.stringify(report)).not.toContain('raw-allowlist-sentinel!')
})
