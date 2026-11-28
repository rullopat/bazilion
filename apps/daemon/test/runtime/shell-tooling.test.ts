import { type BashOperations, createBashToolDefinition } from '@earendil-works/pi-coding-agent'
import { expect, test, vi } from 'vitest'
import {
  BashApprovalDeniedError,
  type BashApprovalHost,
  createApprovalGatedBashTool,
} from '../../src/runtime/shell/approval.ts'
import { createSessionShellTools, redactedOutput } from '../../src/runtime/shell/tooling.ts'

const containerPrefix = `bazilion-${'1'.repeat(12)}-`

function fakeBashBackend() {
  const exec = vi.fn(
    async (_command: string, _cwd: string, _options: Parameters<BashOperations['exec']>[2]) => ({
      exitCode: 0,
    }),
  )
  return { exec, operations: { exec } satisfies BashOperations }
}

const toolContext = {
  sessionManager: {
    getSessionId: () => 'test-session',
    getSessionFile: () => '/tmp/test-session.jsonl',
    getCwd: () => '/tmp/team',
  },
} as never

test('with shell security off, bash is still Bazilion’s own, which redacts its output', () => {
  const result = createSessionShellTools('/tmp/team', {})

  expect(result.config.sandboxMode).toBe('off')
  expect(result.config.approvalMode).toBe('off')
  expect(result.hostToolNames).toEqual(['read', 'edit', 'write', 'grep', 'find', 'ls'])
  expect(result.bash).toMatchObject({ name: 'bash', label: 'bash' })
})

test('dangerous approval on the host replaces only bash with a sequential custom tool', () => {
  const result = createSessionShellTools('/tmp/team', {
    BAZILION_BASH_APPROVAL: 'dangerous',
  })

  expect(result.config).toMatchObject({ sandboxMode: 'off', approvalMode: 'dangerous' })
  expect(result.hostToolNames).toEqual(['read', 'edit', 'write', 'grep', 'find', 'ls'])
  expect(result.bash).toMatchObject({
    name: 'bash',
    label: 'bash',
    executionMode: 'sequential',
  })
  expect(result.bash.description).toContain('require operator approval')
})

test('Docker mode exposes a custom bash and no host-backed coding tools', () => {
  const result = createSessionShellTools(
    '/tmp/team',
    { BAZILION_BASH_SANDBOX: 'docker', OPENAI_API_KEY: 'must-not-leak' },
    { containerPrefix },
  )

  expect(result.config.sandboxMode).toBe('docker')
  expect(result.config.approvalMode).toBe('off')
  expect(result.hostToolNames).toEqual([])
  expect(result.bash).toMatchObject({
    name: 'bash',
    label: 'bash (Docker sandbox)',
  })
  expect(result.bash.description).toContain('network-disabled Docker container')
  expect(result.bash.description).toContain('Host files and credentials are unavailable')
})

test('Docker plus dangerous approval wraps the Docker bash without restoring host tools', () => {
  const result = createSessionShellTools(
    '/tmp/team',
    { BAZILION_BASH_APPROVAL: 'dangerous', BAZILION_BASH_SANDBOX: 'docker' },
    { containerPrefix },
  )

  expect(result.hostToolNames).toEqual([])
  expect(result.bash).toMatchObject({
    name: 'bash',
    label: 'bash (Docker sandbox)',
    executionMode: 'sequential',
  })
  expect(result.bash.description).toContain('network-disabled Docker container')
  expect(result.bash.description).toContain('require operator approval')
})

test('safe commands bypass the approval host and execute the selected backend', async () => {
  const { exec, operations } = fakeBashBackend()
  const requestApproval = vi.fn(async () => 'denied' as const)
  const host: BashApprovalHost = { requestApproval }
  const tool = createApprovalGatedBashTool(
    createBashToolDefinition('/tmp/team', { operations }),
    host,
  )

  await tool.execute('call-safe', { command: 'pwd' }, undefined, undefined, toolContext)

  expect(requestApproval).not.toHaveBeenCalled()
  expect(exec).toHaveBeenCalledTimes(1)
  expect(exec.mock.calls[0]?.[0]).toBe('pwd')
})

test('approval receives tool identity, risks, and cancellation before backend execution', async () => {
  const { exec, operations } = fakeBashBackend()
  const requestApproval = vi.fn(async () => 'approved' as const)
  const host: BashApprovalHost = { requestApproval }
  const tool = createApprovalGatedBashTool(
    createBashToolDefinition('/tmp/team', { operations }),
    host,
  )
  const controller = new AbortController()

  await tool.execute(
    'call-risky',
    { command: 'sudo true', timeout: 7 },
    controller.signal,
    undefined,
    toolContext,
  )

  expect(requestApproval).toHaveBeenCalledTimes(1)
  expect(requestApproval).toHaveBeenCalledWith({
    toolCallId: 'call-risky',
    command: 'sudo true',
    risks: [
      expect.objectContaining({
        code: 'privilege-or-credential-access',
        span: { start: 0, end: 9 },
      }),
    ],
    signal: controller.signal,
  })
  expect(exec).toHaveBeenCalledTimes(1)
  expect(exec.mock.calls[0]?.[0]).toBe('sudo true')
  expect(exec.mock.calls[0]?.[2]).toMatchObject({
    signal: controller.signal,
    timeout: 7,
  })
})

test('denial fails before the backend is invoked', async () => {
  const { exec, operations } = fakeBashBackend()
  const host: BashApprovalHost = {
    requestApproval: vi.fn(async () => 'denied' as const),
  }
  const tool = createApprovalGatedBashTool(
    createBashToolDefinition('/tmp/team', { operations }),
    host,
  )

  await expect(
    tool.execute('call-denied', { command: 'sudo true' }, undefined, undefined, toolContext),
  ).rejects.toBeInstanceOf(BashApprovalDeniedError)
  expect(exec).not.toHaveBeenCalled()
})

test('missing approval host auto-denies risky commands but not safe ones', async () => {
  const { exec, operations } = fakeBashBackend()
  const tool = createApprovalGatedBashTool(createBashToolDefinition('/tmp/team', { operations }))

  await expect(
    tool.execute('call-risky', { command: 'sudo true' }, undefined, undefined, toolContext),
  ).rejects.toThrow(/dangerous bash command denied/i)
  expect(exec).not.toHaveBeenCalled()

  await tool.execute('call-safe', { command: 'pwd' }, undefined, undefined, toolContext)
  expect(exec).toHaveBeenCalledTimes(1)
})

test('paths inside the workspace count as project-local, the workspace itself does not', async () => {
  const { exec, operations } = fakeBashBackend()
  const requestApproval = vi.fn(async () => 'denied' as const)
  const tool = createApprovalGatedBashTool(
    createBashToolDefinition('/tmp/team', { operations }),
    { requestApproval },
    '/workspace',
  )

  for (const command of [
    'rm -rf /workspace/build',
    'find /workspace/tmp -type f -delete',
    'chown -R 1000 /workspace/out',
  ])
    await tool.execute('call-local', { command }, undefined, undefined, toolContext)
  expect(requestApproval).not.toHaveBeenCalled()
  expect(exec).toHaveBeenCalledTimes(3)

  for (const command of ['rm -rf /workspace', 'rm -rf /workspace/*', 'rm -rf /workspace/../etc'])
    await expect(
      tool.execute('call-broad', { command }, undefined, undefined, toolContext),
    ).rejects.toBeInstanceOf(BashApprovalDeniedError)
  expect(requestApproval).toHaveBeenCalledTimes(3)
  expect(exec).toHaveBeenCalledTimes(3)
})

test('command output loses the turn’s credentials as it arrives: split, added late, around bytes', async () => {
  const values = ['SECRETVALUE-0123456789']
  const backend: BashOperations = {
    async exec(_command, _cwd, { onData }) {
      onData(Buffer.from('a SECRETVA'))
      onData(Buffer.from('LUE-0123456789 b\n'))
      // A token refreshed during the command.
      values.push('LATE-TOKEN-abcdef')
      onData(Buffer.from([0xff, 0x00, 0xc3]))
      onData(Buffer.from([0xa9, 0x20]))
      onData(Buffer.from('LATE-TOKEN-abcdef'))
      return { exitCode: 0 }
    },
  }
  const chunks: Buffer[] = []
  const result = await redactedOutput(backend, values).exec('true', '/', {
    onData: (data) => chunks.push(data),
  })
  expect(result).toEqual({ exitCode: 0 })
  expect(Buffer.concat(chunks)).toEqual(
    Buffer.concat([
      Buffer.from('a [REDACTED] b\n'),
      // Bytes that are no text, and a character split across chunks, pass as they came.
      Buffer.from([0xff, 0x00, 0xc3, 0xa9, 0x20]),
      Buffer.from('[REDACTED]'),
    ]),
  )
})
