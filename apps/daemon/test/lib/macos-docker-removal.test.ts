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

const platform = Object.getOwnPropertyDescriptor(process, 'platform')
afterEach(() => {
  if (platform) Object.defineProperty(process, 'platform', platform)
})
test('macOS protected execution is native even when ordinary host mode remains off; Docker is not reinterpreted', () => {
  expect(resolveProtectedExecutionBackend({}, 'darwin')).toBe('native')
  expect(resolveProtectedExecutionBackend({ BAZILION_BASH_SANDBOX: 'native' }, 'darwin')).toBe(
    'native',
  )
  expect(() =>
    resolveProtectedExecutionBackend({ BAZILION_BASH_SANDBOX: 'docker' }, 'darwin'),
  ).toThrow('not supported on macOS')
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
    nativeProtected: true,
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
    codingSurface: 'native',
    docker: null,
    baseRuntimeReady: false,
    native: { backend: 'darwin-seatbelt', readiness: 'not_checked' },
  })
  expect(JSON.stringify(report)).not.toContain('must-not-appear')
})
