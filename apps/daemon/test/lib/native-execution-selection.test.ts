import { expect, test } from 'vitest'
import {
  doctorSummaryLines,
  executionSecurityDoctorLines,
} from '../../../cli/src/commands/doctor.ts'
import { projectExecutionSecurity } from '../../src/lib/execution-security-status.ts'
import { createSessionShellTools } from '../../src/runtime/shell/tooling.ts'

test('native configuration cannot manufacture SDK tools without a daemon-admitted host', () => {
  expect(() => createSessionShellTools('/unused', { BAZILION_BASH_SANDBOX: 'native' })).toThrow(
    'genuine daemon-admitted native execution host',
  )
})

test('passive native status never advertises Docker readiness, a native image, host access or a successful sandbox proof', () => {
  const shellSecurity = {
    ok: true as const,
    sandboxMode: 'native' as const,
    approvalMode: 'dangerous' as const,
    sandboxImage: 'ignored-docker-image',
    hostCodingTools: false,
    network: 'denied-ip' as const,
  }
  const executionSecurity = projectExecutionSecurity({
    nativeBackend: 'linux-bwrap',
    configuredOperatorHttp: {
      shellSecurity,
      dockerImage: 'ignored-docker-image',
      browserEnabled: false,
      mcpEnabled: false,
    },
    protectedUnattendedTurns: {
      docker: { ready: true, image: 'irrelevant-docker-image', reason: null },
      openaiCodex: { enabled: false, connected: false, accessCurrent: false },
    },
  })
  expect(executionSecurity.configuredOperatorHttp).toMatchObject({
    codingSurface: 'native',
    dockerImage: null,
  })
  expect(executionSecurity.protectedUnattendedTurns).toMatchObject({
    codingSurface: 'native',
    docker: null,
    native: { backend: 'linux-bwrap', readiness: 'not_checked' },
    baseRuntimeReady: false,
    browser: 'denied',
    mcp: 'denied',
  })
  const display = executionSecurityDoctorLines({ shellSecurity, executionSecurity }).join('\n')
  expect(display).toContain('native OS sandbox')
  expect(display).toContain('Not checked')
  expect(display).not.toContain('Docker ready')
  expect(display).not.toContain('coding surface: host tools')
  expect(display).not.toContain('ignored-docker-image')
  const summary = doctorSummaryLines(
    { ok: true, protectedWorkBaselineReady: false },
    'native',
  ).join('\n')
  expect(summary).toContain('baseline: not checked')
  expect(summary).not.toContain('baseline: unavailable')
})
