import { afterEach, expect, test } from 'vitest'
import { miscRouter } from '../../src/routes/misc.ts'

const originalEnforcement = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
const originalSandbox = process.env.BAZILION_BASH_SANDBOX
const originalSandboxImage = process.env.BAZILION_BASH_SANDBOX_IMAGE
const originalApproval = process.env.BAZILION_BASH_APPROVAL

afterEach(() => {
  if (originalEnforcement === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = originalEnforcement
  if (originalSandbox === undefined) delete process.env.BAZILION_BASH_SANDBOX
  else process.env.BAZILION_BASH_SANDBOX = originalSandbox
  if (originalSandboxImage === undefined) delete process.env.BAZILION_BASH_SANDBOX_IMAGE
  else process.env.BAZILION_BASH_SANDBOX_IMAGE = originalSandboxImage
  if (originalApproval === undefined) delete process.env.BAZILION_BASH_APPROVAL
  else process.env.BAZILION_BASH_APPROVAL = originalApproval
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

test('health fails closed on an invalid shell-security mode', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'enabled'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    ok: boolean
    shellSecurity: { ok: boolean; error: string }
  }

  expect(report.ok).toBe(false)
  expect(report.shellSecurity.ok).toBe(false)
  expect(report.shellSecurity.error).toMatch(/must be "off" or "docker"/)
})

test('health fails closed on an invalid dangerous-command approval policy', async () => {
  process.env.BAZILION_BASH_SANDBOX = 'off'
  process.env.BAZILION_BASH_APPROVAL = 'prompt'
  const response = await miscRouter.request('/health')
  const report = (await response.json()) as {
    ok: boolean
    shellSecurity: { ok: boolean; error: string }
  }

  expect(report.ok).toBe(false)
  expect(report.shellSecurity.ok).toBe(false)
  expect(report.shellSecurity.error).toMatch(/must be "off" or "dangerous"/)
})
