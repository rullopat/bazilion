import type { ExecutionSecurityReport, HealthReport } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { projectPlatformCapabilities } from '../../daemon/src/lib/platform-capabilities.ts'
import {
  doctorHasIssues,
  doctorSummaryLines,
  executionSecurityDoctorLines,
  platformCapabilityDoctorLines,
} from '../src/commands/doctor.ts'

const executionSecurity: ExecutionSecurityReport = {
  configuredOperatorHttp: {
    protected: false,
    codingSurface: 'host',
    dockerImage: 'debian:bookworm-slim',
    browser: 'enabled',
    mcp: 'enabled',
  },
  protectedUnattendedTurns: {
    baseRuntimeReady: false,
    codingSurface: 'docker',
    docker: {
      ready: false,
      image: 'debian:bookworm-slim',
      reason: 'Docker executable is unavailable',
    },
    browser: 'denied',
    mcp: 'denied',
    openaiCodex: {
      enabled: true,
      connected: false,
      accessCurrent: false,
      refreshOnNextTurn: false,
      baselineEligible: false,
    },
    remediation: 'Connect ChatGPT for OpenAI Codex on the Config page.',
  },
}

test('doctor clearly separates configured operator HTTP from protected unattended turns', () => {
  const report: Pick<HealthReport, 'executionSecurity' | 'shellSecurity'> = {
    executionSecurity,
    shellSecurity: {
      ok: true,
      sandboxMode: 'off',
      approvalMode: 'dangerous',
      sandboxImage: 'debian:bookworm-slim',
      hostCodingTools: true,
      network: 'host',
    },
  }
  const output = executionSecurityDoctorLines(report).join('\n')

  expect(output).toContain('configured operator HTTP (legacy · unprotected)')
  expect(output).toContain('coding surface: host tools')
  expect(output).toContain('browser: enabled')
  expect(output).toContain('MCP: enabled')
  expect(output).toContain(
    'protected unattended turns baseline (Telegram, schedules, inbox, approvals)',
  )
  expect(output).toContain('✗ protected base runtime ready')
  expect(output).toContain('coding surface: Docker only')
  expect(output).toContain(
    '✗ Docker ready (debian:bookworm-slim) — Docker executable is unavailable',
  )
  expect(output).toContain('✗ ChatGPT connected')
  expect(output).toContain('OpenAI access: unavailable')
  expect(output).toContain('✗ OpenAI Codex baseline eligible')
  expect(output).toContain('✓ browser: denied')
  expect(output).toContain('✓ MCP: denied')
  expect(output).toContain(
    'every turn separately validates its selected normal/review model, bound OAuth refresh, and mounts/paths',
  )
  expect(output).toContain('non-interactive operator requests auto-deny')
  expect(output).not.toContain('background and non-TTY turns')
  expect(output).toContain(`remediation: ${executionSecurity.protectedUnattendedTurns.remediation}`)
})

test('doctor treats near-expiry connected OAuth as refreshable baseline eligibility', () => {
  const status: ExecutionSecurityReport = {
    ...executionSecurity,
    protectedUnattendedTurns: {
      ...executionSecurity.protectedUnattendedTurns,
      baseRuntimeReady: true,
      docker: { ready: true, image: 'debian:bookworm-slim', reason: null },
      openaiCodex: {
        enabled: true,
        connected: true,
        accessCurrent: false,
        refreshOnNextTurn: true,
        baselineEligible: true,
      },
      remediation: null,
    },
  }
  const output = executionSecurityDoctorLines({
    executionSecurity: status,
    shellSecurity: {
      ok: true,
      sandboxMode: 'off',
      approvalMode: 'off',
      sandboxImage: 'debian:bookworm-slim',
      hostCodingTools: true,
      network: 'host',
    },
  }).join('\n')

  expect(output).toContain('✓ protected base runtime ready')
  expect(output).toContain('OpenAI access: refresh on next turn')
  expect(output).toContain('✓ OpenAI Codex baseline eligible')
  expect(output).not.toContain('Reconnect ChatGPT')
})

test.each([
  [{ ok: true, protectedWorkBaselineReady: true }, false],
  [{ ok: false, protectedWorkBaselineReady: true }, true],
  [{ ok: true, protectedWorkBaselineReady: false }, false],
  [{ ok: false, protectedWorkBaselineReady: false }, true],
] as const)('doctor exit status reflects installation health independently of protected readiness: %j', (report, expected) => {
  expect(doctorHasIssues(report)).toBe(expected)
  const output = doctorSummaryLines(report).join('\n')
  expect(output).toContain(report.ok ? 'install is healthy ✓' : 'installation issues found ✗')
  expect(output).toContain('ordinary chat execution: not checked')
  expect(output).toContain(
    report.protectedWorkBaselineReady
      ? 'protected unattended baseline: ready — per-turn checks still apply'
      : 'protected unattended baseline: unavailable — see reasons and remediation above',
  )
  expect(output).toContain('exit status covers installation health only')
  expect(output).not.toContain('all good')
})

test.each([
  'linux',
  'darwin',
  'win32',
])('doctor renders daemon platform support for %s without success badges', (platform) => {
  const report = projectPlatformCapabilities(platform)
  const output = platformCapabilityDoctorLines(report).join('\n')
  expect(output).toContain(`platform support: ${report.platform}`)
  expect(output).toContain('not an execution or connectivity test')
  for (const capability of report.capabilities) {
    expect(output).toContain(`${capability.label}: ${capability.support} on this platform`)
    expect(output).toContain(capability.detail)
  }
  expect(output).not.toContain('✓')
  if (platform === 'darwin') {
    expect(output).toContain('Hardened Git inspection: supported')
    expect(output).toContain('bounded private worktree capture')
    expect(output).toContain('MCP stdio: unsupported')
    expect(output).toContain('Use Streamable HTTP instead')
    expect(output).toContain('Ordinary interactive chat: supported')
  }
})
