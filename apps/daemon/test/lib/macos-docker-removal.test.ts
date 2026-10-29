import { afterEach, expect, test } from 'vitest'
import { configureTeamCodingEnvironment } from '../../src/lib/coding-environment/management.ts'
import { projectExecutionSecurity } from '../../src/lib/execution-security-status.ts'
import { resolveProtectedExecutionBackend } from '../../src/lib/native-execution/selection.ts'
import {
  checkProtectedDockerReadiness,
  createDockerBashOperations,
  preflightProtectedDockerEngine,
  preflightProtectedDockerRuntime,
  terminateRecordedContainer,
} from '../../src/runtime/shell/docker.ts'
import { MAC_PROTECTED_EXECUTION_UNAVAILABLE } from '../../src/runtime/shell/platform-support.ts'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')
afterEach(() => {
  if (platform) Object.defineProperty(process, 'platform', platform)
})
test('macOS protected execution refuses in every configured mode without host fallback', () => {
  for (const mode of ['off', 'native', 'docker'])
    expect(() =>
      resolveProtectedExecutionBackend({ BAZILION_BASH_SANDBOX: mode }, 'darwin'),
    ).toThrow(MAC_PROTECTED_EXECUTION_UNAVAILABLE)
  expect(resolveProtectedExecutionBackend({}, 'linux')).toBe('docker')
  expect(resolveProtectedExecutionBackend({ BAZILION_BASH_SANDBOX: 'docker' }, 'linux')).toBe(
    'docker',
  )
})
test('macOS Docker admission and execution refuse before executable/socket lookup; cold recovery cannot launch Docker', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  const input = { image: 'controlled-image', dockerPath: '/must-not-be-looked-up' }
  await expect(checkProtectedDockerReadiness(input)).resolves.toEqual({
    ready: false,
    image: input.image,
    reason: 'unsupported platform',
  })
  await expect(preflightProtectedDockerEngine(input)).rejects.toThrow('only on Linux')
  await expect(
    preflightProtectedDockerRuntime({ ...input, workspaceDir: '/must-not-be-read' }),
  ).rejects.toThrow('only on Linux')
  const operations = createDockerBashOperations({ image: input.image, env: {} })
  await expect(operations.exec('true', '/must-not-be-read', { onData() {} })).rejects.toThrow(
    'only on Linux',
  )
  await expect(terminateRecordedContainer({} as never)).resolves.toBe(false)
  await expect(
    configureTeamCodingEnvironment({} as never, {} as never, 0, {
      backend: 'docker',
      image: 'controlled-image',
      cwd: '.',
      env: {},
    }),
  ).rejects.toThrow('not supported on macOS')
})
test('macOS passive host-mode status never probes or advertises a Docker protected backend', () => {
  const report = projectExecutionSecurity({
    protectedUnavailableReason: MAC_PROTECTED_EXECUTION_UNAVAILABLE,
    nativeBackend: 'darwin-seatbelt',
    configuredOperatorHttp: {
      shellSecurity: {
        ok: true,
        sandboxMode: 'off',
        approvalMode: 'off',
        sandboxImage: null,
        hostCodingTools: true,
        network: 'host',
      },
      dockerImage: 'must-not-appear',
      browserEnabled: false,
      mcpEnabled: false,
    },
    protectedUnattendedTurns: {
      docker: { ready: true, image: 'must-not-appear', reason: null },
      openaiCodex: { enabled: false, connected: false, accessCurrent: false },
    },
  })
  expect(report.configuredOperatorHttp).toMatchObject({
    codingSurface: 'host',
    protected: false,
    dockerImage: null,
  })
  expect(report.protectedUnattendedTurns).toMatchObject({
    codingSurface: 'unavailable',
    docker: null,
    baseRuntimeReady: false,
    remediation: MAC_PROTECTED_EXECUTION_UNAVAILABLE,
  })
  expect(report.protectedUnattendedTurns).not.toHaveProperty('native')
  expect(JSON.stringify(report)).not.toContain('must-not-appear')
})
