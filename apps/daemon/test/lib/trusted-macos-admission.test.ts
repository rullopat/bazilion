import { afterEach, expect, test } from 'vitest'
import { configureTeamCodingEnvironment } from '../../src/lib/coding-environment/management.ts'
import { prepareAgentNativeInputs } from '../../src/lib/native-execution/prepare.ts'
import { prepareProtectedNativeExecution } from '../../src/lib/native-execution/protected.ts'
import { prepareProtectedExecution } from '../../src/lib/protected-execution.ts'
import { captureVerificationRequest } from '../../src/lib/verification/capture.ts'
import {
  prepareNativeAgentVerificationCapture,
  prepareNativeOperatorVerificationCapture,
} from '../../src/lib/verification/native-capture.ts'
import { prepareNativeVerificationExecutor } from '../../src/lib/verification/native-executor.ts'
import { prepareVerificationTurn } from '../../src/lib/verification/preparation.ts'
import {
  createBazilionSession,
  createProtectedBazilionSession,
} from '../../src/runtime/pi/session.ts'
import {
  MAC_NATIVE_EXECUTION_UNAVAILABLE,
  MAC_PROTECTED_EXECUTION_UNAVAILABLE,
  supportedIsolationBackends,
} from '../../src/runtime/shell/platform-support.ts'
import { spawnWorkerTurn } from '../../src/runtime/worker/spawn.ts'

// Synthetic platform admission controls, not execution/containment qualification.
const platform = Object.getOwnPropertyDescriptor(process, 'platform')
afterEach(() => {
  if (platform) Object.defineProperty(process, 'platform', platform)
})
function mac() {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
}

test('supported isolation choices exclude deferred Mac native and removed Docker, without changing Linux', () => {
  expect(supportedIsolationBackends('darwin')).toEqual([])
  expect(supportedIsolationBackends('linux')).toEqual(['native', 'docker'])
  expect(supportedIsolationBackends('win32')).toEqual([])
})

test('direct protected/native preparations refuse before DB, paths, provider or lease access', async () => {
  mac()
  await expect(prepareAgentNativeInputs({} as never, {} as never, {} as never)).rejects.toThrow(
    MAC_NATIVE_EXECUTION_UNAVAILABLE,
  )
  await expect(
    prepareProtectedNativeExecution({} as never, {} as never, {} as never),
  ).rejects.toThrow(MAC_PROTECTED_EXECUTION_UNAVAILABLE)
  for (const backend of ['native', 'docker'] as const)
    await expect(prepareProtectedExecution({} as never, { backend } as never)).rejects.toThrow(
      MAC_PROTECTED_EXECUTION_UNAVAILABLE,
    )
  await expect(prepareNativeVerificationExecutor({} as never)).rejects.toThrow(
    MAC_PROTECTED_EXECUTION_UNAVAILABLE,
  )
  await expect(prepareVerificationTurn({} as never)).rejects.toThrow(
    MAC_PROTECTED_EXECUTION_UNAVAILABLE,
  )
})

test('Mac verification capture refuses before inspecting source, credentials or writing a request', async () => {
  mac()
  const blocked = {
    kind: 'blocked',
    blocker: { reason: 'unsupported', detail: MAC_NATIVE_EXECUTION_UNAVAILABLE },
  }
  await expect(prepareNativeAgentVerificationCapture({} as never)).resolves.toEqual(blocked)
  await expect(prepareNativeOperatorVerificationCapture({} as never)).resolves.toEqual(blocked)
  expect(captureVerificationRequest({} as never, {} as never, {} as never)).toEqual({
    kind: 'blocked',
    blocker: { reason: 'unsupported', detail: MAC_PROTECTED_EXECUTION_UNAVAILABLE },
  })
})

test('Mac native defaults refuse before filesystem mutation; proxy metadata is not admission', async () => {
  mac()
  await expect(
    configureTeamCodingEnvironment({} as never, {} as never, 0, {
      backend: 'native',
      cwd: '.',
      env: {},
    }),
  ).rejects.toThrow(MAC_NATIVE_EXECUTION_UNAVAILABLE)
  // Metadata/proxy parsing is not admission. Active SDK and worker entry paths below refuse.
})

test('direct Mac sessions cannot request protected coding/native work before model creation', async () => {
  mac()
  await expect(createProtectedBazilionSession({} as never)).rejects.toThrow(
    MAC_PROTECTED_EXECUTION_UNAVAILABLE,
  )
  await expect(createBazilionSession({ nativeExecution: {} } as never)).rejects.toThrow(
    MAC_NATIVE_EXECUTION_UNAVAILABLE,
  )
})

test.each([
  'native',
  'docker',
])('explicit configured Mac %s worker selection refuses before worker artifacts/input', async (mode) => {
  mac()
  const frames = spawnWorkerTurn(
    { kind: 'configured_operator_http' } as never,
    { env: { BAZILION_BASH_SANDBOX: mode }, workerEntryPath: '/must-not-read' } as never,
  )
  await expect(frames.next()).rejects.toThrow(
    mode === 'native'
      ? MAC_NATIVE_EXECUTION_UNAVAILABLE
      : 'Docker execution is not supported on macOS',
  )
})

test.each([
  'protected',
  'specialist_verification',
])('Mac %s worker cannot use trusted host execution as fallback', async (kind) => {
  mac()
  const frames = spawnWorkerTurn(
    { kind } as never,
    { env: { BAZILION_BASH_SANDBOX: 'off' }, workerEntryPath: '/must-not-read' } as never,
  )
  await expect(frames.next()).rejects.toThrow(MAC_PROTECTED_EXECUTION_UNAVAILABLE)
})
