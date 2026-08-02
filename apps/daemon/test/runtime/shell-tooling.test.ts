import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BashOperations, createBashToolDefinition } from '@earendil-works/pi-coding-agent'
import { expect, test, vi } from 'vitest'
import {
  BashApprovalDeniedError,
  type BashApprovalHost,
  createApprovalGatedBashTool,
} from '../../src/runtime/shell/approval.ts'
import {
  buildSandboxContainerEnv,
  createSessionShellTools,
} from '../../src/runtime/shell/tooling.ts'

function fakeBashBackend() {
  const exec = vi.fn(
    async (_command: string, _cwd: string, _options: Parameters<BashOperations['exec']>[2]) => ({
      exitCode: 0,
    }),
  )
  return { exec, operations: { exec } satisfies BashOperations }
}

test('shell security off preserves the complete existing host coding-tool surface', () => {
  const result = createSessionShellTools('/tmp/team', {})

  expect(result.config.sandboxMode).toBe('off')
  expect(result.config.approvalMode).toBe('off')
  expect(result.hostToolNames).toEqual(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])
  expect(result.customBash).toBeUndefined()
})

test('dangerous approval on the host replaces only bash with a sequential custom tool', () => {
  const result = createSessionShellTools('/tmp/team', {
    BAZILION_BASH_APPROVAL: 'dangerous',
  })

  expect(result.config).toMatchObject({ sandboxMode: 'off', approvalMode: 'dangerous' })
  expect(result.hostToolNames).toEqual(['read', 'edit', 'write', 'grep', 'find', 'ls'])
  expect(result.customBash).toMatchObject({
    name: 'bash',
    label: 'bash',
    executionMode: 'sequential',
  })
  expect(result.customBash?.description).toContain('require operator approval')
})

test('Docker mode exposes a custom bash and no host-backed coding tools', () => {
  const result = createSessionShellTools('/tmp/team', {
    BAZILION_BASH_SANDBOX: 'docker',
    OPENAI_API_KEY: 'must-not-leak',
  })

  expect(result.config.sandboxMode).toBe('docker')
  expect(result.config.approvalMode).toBe('off')
  expect(result.hostToolNames).toEqual([])
  expect(result.customBash).toMatchObject({
    name: 'bash',
    label: 'bash (Docker sandbox)',
  })
  expect(result.customBash?.description).toContain('network-disabled Docker container')
  expect(result.customBash?.description).toContain('bounded read-only')
})

test('Docker plus dangerous approval wraps the Docker bash without restoring host tools', () => {
  const result = createSessionShellTools('/tmp/team', {
    BAZILION_BASH_APPROVAL: 'dangerous',
    BAZILION_BASH_SANDBOX: 'docker',
  })

  expect(result.hostToolNames).toEqual([])
  expect(result.customBash).toMatchObject({
    name: 'bash',
    label: 'bash (Docker sandbox)',
    executionMode: 'sequential',
  })
  expect(result.customBash?.description).toContain('network-disabled Docker container')
  expect(result.customBash?.description).toContain('require operator approval')
})

test('safe commands bypass the approval host and execute the selected backend', async () => {
  const { exec, operations } = fakeBashBackend()
  const requestApproval = vi.fn(async () => 'denied' as const)
  const host: BashApprovalHost = { requestApproval }
  const tool = createApprovalGatedBashTool(
    createBashToolDefinition('/tmp/team', { operations }),
    host,
  )

  await tool.execute('call-safe', { command: 'pwd' }, undefined, undefined, {} as never)

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
    {} as never,
  )

  expect(requestApproval).toHaveBeenCalledTimes(1)
  expect(requestApproval).toHaveBeenCalledWith({
    toolCallId: 'call-risky',
    command: 'sudo true',
    risks: [
      expect.objectContaining({
        code: 'privilege-or-credential-access',
        matchedText: 'sudo true',
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
    tool.execute('call-denied', { command: 'sudo true' }, undefined, undefined, {} as never),
  ).rejects.toBeInstanceOf(BashApprovalDeniedError)
  expect(exec).not.toHaveBeenCalled()
})

test('missing approval host auto-denies risky commands but not safe ones', async () => {
  const { exec, operations } = fakeBashBackend()
  const tool = createApprovalGatedBashTool(createBashToolDefinition('/tmp/team', { operations }))

  await expect(
    tool.execute('call-risky', { command: 'sudo true' }, undefined, undefined, {} as never),
  ).rejects.toThrow(/dangerous bash command denied/i)
  expect(exec).not.toHaveBeenCalled()

  await tool.execute('call-safe', { command: 'pwd' }, undefined, undefined, {} as never)
  expect(exec).toHaveBeenCalledTimes(1)
})

test('sandbox environment pins container basics and omits merged host secrets', () => {
  expect(
    buildSandboxContainerEnv(
      {
        PATH: '/host/bin',
        HOME: '/home/operator',
        LANG: 'host-locale',
        TERM: 'xterm-256color',
        CI: 'true',
        OPENAI_API_KEY: 'must-not-leak',
      },
      ['CI'],
    ),
  ).toEqual({
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TERM: 'xterm-256color',
    CI: 'true',
    SHELL: '/bin/bash',
    TMPDIR: '/tmp',
  })
})

test('Docker mode rejects a memory mount that is a symlink outside the team', () => {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-shell-tooling-'))
  const team = join(root, 'team')
  const outside = join(root, 'outside')
  mkdirSync(team)
  mkdirSync(outside)
  symlinkSync(outside, join(team, 'memory'))

  try {
    expect(() => createSessionShellTools(team, { BAZILION_BASH_SANDBOX: 'docker' })).toThrow(
      /read-only mount must be a real directory/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
