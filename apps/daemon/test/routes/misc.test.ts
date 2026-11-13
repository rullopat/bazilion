import type { HealthReport } from '@bazilion/api-types'
import { afterEach, expect, test, vi } from 'vitest'
import { miscRouter } from '../../src/routes/misc.ts'
import * as dockerReadiness from '../../src/runtime/shell/docker.ts'

const originalSandbox = process.env.BAZILION_BASH_SANDBOX
const originalSandboxImage = process.env.BAZILION_BASH_SANDBOX_IMAGE
const originalApproval = process.env.BAZILION_BASH_APPROVAL
const originalBraveKey = process.env.BRAVE_API_KEY
const originalSearxngUrl = process.env.SEARXNG_URL
const originalLmstudioUrl = process.env.LMSTUDIO_URL
const originalLmstudioKey = process.env.LMSTUDIO_API_KEY
const originalOllamaUrl = process.env.OLLAMA_URL
const originalOpenaiKey = process.env.OPENAI_API_KEY

afterEach(() => {
  if (originalSandbox === undefined) delete process.env.BAZILION_BASH_SANDBOX
  else process.env.BAZILION_BASH_SANDBOX = originalSandbox
  if (originalSandboxImage === undefined) delete process.env.BAZILION_BASH_SANDBOX_IMAGE
  else process.env.BAZILION_BASH_SANDBOX_IMAGE = originalSandboxImage
  if (originalApproval === undefined) delete process.env.BAZILION_BASH_APPROVAL
  else process.env.BAZILION_BASH_APPROVAL = originalApproval
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

test('health lists every configured cloud provider, not a fixed subset', async () => {
  const original = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'deepseek-key'
  try {
    const report = (await (await miscRouter.request('/health/details')).json()) as HealthReport
    expect(report.providers.configured).toContain('deepseek')
  } finally {
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = original
  }
})

test('health reports the default-off host shell posture without probing Docker', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  const probe = vi.spyOn(dockerReadiness, 'checkDockerImage')
  try {
    const response = await miscRouter.request('/health/details')
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
      docker: null,
    })
    expect(probe).not.toHaveBeenCalled()
  } finally {
    probe.mockRestore()
  }
})

test('health reports the opt-in Docker posture with the image check and remediation', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'docker'
  process.env.BAZILION_BASH_SANDBOX_IMAGE = 'example.test/bazilion-shell:v1'
  const probe = vi
    .spyOn(dockerReadiness, 'checkDockerImage')
    .mockResolvedValueOnce({
      ok: false,
      error: 'Error response from daemon: No such image: example.test/bazilion-shell:v1',
    })
    .mockResolvedValueOnce({ ok: true })
  try {
    const response = await miscRouter.request('/health/details')
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
      docker: {
        ready: false,
        image: 'example.test/bazilion-shell:v1',
        reason: 'Error response from daemon: No such image: example.test/bazilion-shell:v1',
        remediation:
          'Start Docker and make the image available locally (Bazilion never pulls it), e.g. `docker pull example.test/bazilion-shell:v1`.',
      },
    })
    expect(probe).toHaveBeenCalledWith('example.test/bazilion-shell:v1')
    const ready = (await (await miscRouter.request('/health/details')).json()) as HealthReport
    expect(ready.shellSecurity).toMatchObject({
      docker: { ready: true, reason: null, remediation: null },
    })
  } finally {
    probe.mockRestore()
  }
})

test('health reports dangerous-command approval independently from sandboxing', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  process.env.BAZILION_BASH_APPROVAL = 'dangerous'
  const response = await miscRouter.request('/health/details')
  const report = (await response.json()) as { shellSecurity: unknown }

  expect(report.shellSecurity).toMatchObject({
    ok: true,
    sandboxMode: 'off',
    approvalMode: 'dangerous',
    hostCodingTools: true,
    network: 'host',
  })
})

test('health fails closed on an invalid shell-security mode', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'raw-shell-mode-sentinel'
  const response = await miscRouter.request('/health/details')
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
  const response = await miscRouter.request('/health/details')
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

test('health keeps structural ok separate from Docker readiness', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'docker'
  process.env.BAZILION_BASH_SANDBOX_IMAGE = 'bazilion-health-definitely-missing:v0'
  const probe = vi.spyOn(dockerReadiness, 'checkDockerImage').mockResolvedValue({
    ok: false,
    error: 'Error response from daemon: No such image: bazilion-health-definitely-missing:v0',
  })
  try {
    const response = await miscRouter.request('/health/details')
    const report = (await response.json()) as HealthReport

    const expectedStructural =
      Object.values(report.paths).every(Boolean) &&
      (report.database === null || report.database.ok) &&
      report.skills.parseErrors === 0 &&
      report.shellSecurity.ok
    expect(report.ok).toBe(expectedStructural)
    expect(report.shellSecurity).toMatchObject({ ok: true, docker: { ready: false } })
  } finally {
    probe.mockRestore()
  }
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

  const response = await miscRouter.request('/health/details')
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

test('health replaces an invalid image value with a fixed diagnostic', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  process.env.BAZILION_BASH_SANDBOX_IMAGE = 'raw image sentinel'
  const response = await miscRouter.request('/health/details')
  const report = (await response.json()) as { shellSecurity: { ok: false; error: string } }
  expect(report.shellSecurity.error).toBe('Docker image must use a valid local image reference.')
  expect(JSON.stringify(report)).not.toContain('raw image sentinel')
})
