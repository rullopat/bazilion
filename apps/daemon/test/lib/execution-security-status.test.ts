import type { ProtectedDockerReadinessReason } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import {
  type ExecutionSecurityProjectionInput,
  projectExecutionSecurity,
} from '../../src/lib/execution-security-status.ts'

const base: ExecutionSecurityProjectionInput = {
  configuredOperatorHttp: {
    shellSecurity: {
      ok: true,
      sandboxMode: 'off',
      approvalMode: 'off',
      sandboxImage: 'debian:bookworm-slim',
      hostCodingTools: true,
      network: 'host',
    },
    dockerImage: 'debian:bookworm-slim',
    browserEnabled: true,
    mcpEnabled: true,
  },
  protectedUnattendedTurns: {
    docker: {
      ready: false,
      image: 'debian:bookworm-slim',
      reason: 'Docker executable is unavailable',
    },
    openaiCodex: { enabled: false, connected: false, accessCurrent: false },
  },
}

describe('execution-security projection', () => {
  test('keeps configured host capabilities separate from fail-closed protected capabilities', () => {
    expect(projectExecutionSecurity(base)).toEqual({
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
          enabled: false,
          connected: false,
          accessCurrent: false,
          refreshOnNextTurn: false,
          baselineEligible: false,
        },
        remediation: 'Enable OpenAI Codex and connect ChatGPT on the Config page.',
      },
    })
  })

  test('reports a ready base runtime when Docker and OpenAI Codex are baseline eligible', () => {
    const projected = projectExecutionSecurity({
      ...base,
      configuredOperatorHttp: {
        ...base.configuredOperatorHttp,
        shellSecurity: {
          ok: true,
          sandboxMode: 'docker',
          approvalMode: 'dangerous',
          sandboxImage: 'example.test/bazilion@sha256:123',
          hostCodingTools: false,
          network: 'none',
        },
        dockerImage: 'example.test/bazilion@sha256:123',
        browserEnabled: false,
        mcpEnabled: false,
      },
      protectedUnattendedTurns: {
        docker: { ready: true, image: 'example.test/bazilion@sha256:123', reason: null },
        openaiCodex: { enabled: true, connected: true, accessCurrent: true },
      },
    })

    expect(projected.configuredOperatorHttp).toMatchObject({
      codingSurface: 'docker',
      browser: 'disabled',
      mcp: 'disabled',
    })
    expect(projected.protectedUnattendedTurns).toMatchObject({
      baseRuntimeReady: true,
      remediation: null,
      openaiCodex: { baselineEligible: true, refreshOnNextTurn: false },
    })
  })

  test('keeps near-expiry refreshable OAuth baseline eligible', () => {
    const projected = projectExecutionSecurity({
      ...base,
      protectedUnattendedTurns: {
        docker: { ready: true, image: 'debian:bookworm-slim', reason: null },
        openaiCodex: { enabled: true, connected: true, accessCurrent: false },
      },
    })

    expect(projected.protectedUnattendedTurns).toMatchObject({
      baseRuntimeReady: true,
      remediation: null,
      openaiCodex: {
        accessCurrent: false,
        refreshOnNextTurn: true,
        baselineEligible: true,
      },
    })
  })

  test('invalid shell syntax makes the protected posture unavailable without a downgrade', () => {
    const projected = projectExecutionSecurity({
      ...base,
      configuredOperatorHttp: {
        ...base.configuredOperatorHttp,
        shellSecurity: { ok: false, error: 'invalid configured mode' },
      },
      protectedUnattendedTurns: {
        docker: {
          ready: true,
          image: 'debian:bookworm-slim',
          reason: null,
          configurationValid: false,
        },
        openaiCodex: { enabled: true, connected: true, accessCurrent: true },
      },
    })

    expect(projected.configuredOperatorHttp.codingSurface).toBe('unavailable')
    expect(projected.protectedUnattendedTurns.baseRuntimeReady).toBe(false)
  })

  test('returns one safe configuration remediation when Docker policy syntax is invalid', () => {
    const projected = projectExecutionSecurity({
      ...base,
      protectedUnattendedTurns: {
        docker: {
          ready: false,
          image: 'debian:bookworm-slim',
          reason: null,
          configurationValid: false,
        },
        openaiCodex: { enabled: true, connected: true, accessCurrent: true },
      },
    })

    expect(projected.protectedUnattendedTurns.remediation).toBe(
      'Fix the shell-security configuration in Config Services, then retry.',
    )
    expect(Object.keys(projected.protectedUnattendedTurns.docker).sort()).toEqual([
      'image',
      'ready',
      'reason',
    ])
  })

  test.each<[ProtectedDockerReadinessReason, string]>([
    [
      'unsupported platform',
      'Run protected unattended work on a POSIX host with local Docker support.',
    ],
    [
      'Docker executable is unavailable',
      'Install Docker locally and ensure the Bazilion daemon can execute it.',
    ],
    [
      'Docker must use a local Unix socket',
      'Switch Docker to a local Unix-socket context, then retry.',
    ],
    [
      'Docker socket is unavailable',
      'Start the local Docker daemon and allow Bazilion to access its Unix socket.',
    ],
    [
      'Docker image is unavailable',
      'Make the configured protected Docker image available locally without pulling.',
    ],
    [
      'Docker image declares writable volumes',
      'Use a protected Docker image that declares no writable VOLUME paths.',
    ],
    ['Docker preflight failed', 'Check the local Docker daemon and protected image, then retry.'],
  ])('maps Docker readiness reason %s to one fixed remediation', (reason, remediation) => {
    const projected = projectExecutionSecurity({
      ...base,
      protectedUnattendedTurns: {
        docker: { ready: false, image: 'secret-sentinel/image', reason },
        openaiCodex: { enabled: true, connected: true, accessCurrent: true },
      },
    })

    expect(projected.protectedUnattendedTurns.docker.reason).toBe(reason)
    expect(projected.protectedUnattendedTurns.remediation).toBe(remediation)
    expect(projected.protectedUnattendedTurns.remediation).not.toContain('secret-sentinel')
  })
})
