import type { NativeExecutionRequest, NativeExecutionResult } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { createNativeSessionShellTools } from '../../src/runtime/shell/native-tooling.ts'
import { WorkerNativeExecutionError } from '../../src/runtime/worker/ipc-client.ts'
import type { NativeExecutionHost } from '../../src/runtime/worker/ipc-protocol.ts'

const context = {
  sessionManager: {
    getSessionId: () => 'not-forwarded',
    getSessionFile: () => '/private/not-forwarded',
    getCwd: () => '/workspace',
  },
} as never
function host(result: Partial<NativeExecutionResult> = {}) {
  const calls: NativeExecutionRequest[] = []
  const native: NativeExecutionHost = {
    cancel() {
      return false
    },
    async exec(request, output) {
      calls.push(request)
      output('stdout', Buffer.from('controlled-output'))
      return { code: 0, signal: null, stdoutTruncated: false, stderrTruncated: false, ...result }
    },
  }
  return { native, calls }
}
test('native bash disables every host coding tool and delegates exactly one closed content request', async () => {
  const input = host(),
    tools = createNativeSessionShellTools('/workspace', '.', input.native)
  expect(tools.hostToolNames).toEqual([])
  expect(tools.customBash.executionMode).toBe('sequential')
  const result = await tools.customBash.execute(
    'tool-one',
    { command: 'printf controlled', timeout: 3 },
    undefined,
    undefined,
    context,
  )
  expect(JSON.stringify(result.content)).toContain('controlled-output')
  expect(input.calls).toEqual([
    { toolCallId: 'tool-one', command: 'printf controlled', cwd: '.', timeoutMs: 3000 },
  ])
  expect(JSON.stringify(input.calls)).not.toContain('not-forwarded')
})
test('native capture truncation remains explicit even when the SDK sees a short retained result', async () => {
  const input = host({ stdoutTruncated: true }),
    tools = createNativeSessionShellTools('/workspace', '.', input.native)
  const result = await tools.customBash.execute(
    'truncated',
    { command: 'printf controlled' },
    undefined,
    undefined,
    context,
  )
  expect(result.details).toMatchObject({ nativeExecution: { stdoutTruncated: true } })
  expect(result.structuredContent).toMatchObject({ truncated: true })
  expect(JSON.stringify(result.content)).toContain('Native command capture was truncated')
})
test('native capture truncation also remains explicit on a nonzero SDK tool error', async () => {
  const input = host({ code: 7, stdoutTruncated: true }),
    tools = createNativeSessionShellTools('/workspace', '.', input.native)
  const result = await tools.customBash.execute(
    'failed',
    { command: 'printf controlled' },
    undefined,
    undefined,
    context,
  )
  expect(result.isError).toBe(true)
  expect(result.structuredContent).toMatchObject({ exit_code: 7, truncated: true })
  expect(result.details).toMatchObject({ nativeExecution: { code: 7, stdoutTruncated: true } })
  expect(JSON.stringify(result.content)).toContain('Native command capture was truncated')
})

test('native bash preserves structured unconfirmed-cleanup facts in canonical tool results without inventing execution evidence', async () => {
  const input = host()
  input.native.exec = async () => {
    throw new WorkerNativeExecutionError('Native execution recovery_required', {
      code: 'recovery_required',
      cleanupConfirmed: false,
      observation: {
        backend: 'darwin-seatbelt',
        phase: 'census',
        ownerLive: true,
        commandCompleted: true,
        commandNaturalEOF: true,
        fenced: true,
        terminalProof: false,
        captures: ['drift', 'drift'],
      },
    })
  }
  const result = await createNativeSessionShellTools(
    '/workspace',
    '.',
    input.native,
  ).customBash.execute('uncertain', { command: 'printf controlled' }, undefined, undefined, context)
  expect(result.isError).toBe(true)
  expect(result.details).toMatchObject({
    nativeExecutionFailure: {
      code: 'recovery_required',
      cleanupConfirmed: false,
      observation: { phase: 'census', captures: ['drift', 'drift'] },
    },
  })
  expect(JSON.stringify(result.content)).toContain('diagnostics, not cleanup authority')
  expect(result.details).not.toHaveProperty('nativeExecution')
})
test('unsupported native timeout refuses without running the operation or selecting a host backend', async () => {
  const input = host(),
    tools = createNativeSessionShellTools('/workspace', '.', input.native)
  await expect(
    tools.customBash.execute(
      'too-long',
      { command: 'printf controlled', timeout: 301 },
      undefined,
      undefined,
      context,
    ),
  ).rejects.toThrow('300 seconds')
  expect(input.calls).toEqual([])
})
