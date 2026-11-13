import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CommandApprovalRegistry } from '../../src/lib/bash-approval.ts'
import type { BashApprovalArgs } from '../../src/runtime/worker/ipc-protocol.ts'

function approvalArgs(overrides: Partial<BashApprovalArgs> = {}): BashApprovalArgs {
  return {
    id: 'approval-1',
    turnId: 'turn-1',
    toolCallId: 'tool-1',
    agentId: 'agent-1',
    teamId: 'team-1',
    command: 'cat ~/.ssh/id_rsa',
    risks: [
      {
        code: 'sensitive-path-read',
        message: 'Accesses a path that commonly contains credentials.',
        span: { start: 4, end: 17 },
      },
    ],
    mode: 'interactive',
    ...overrides,
  }
}

let logged: unknown[]
beforeEach(() => {
  logged = []
  vi.spyOn(console, 'info').mockImplementation((...args) => {
    logged.push(args)
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CommandApprovalRegistry', () => {
  test('auto-denies a turn without a human, without a pending request', async () => {
    const registry = new CommandApprovalRegistry()
    const handle = registry.begin(approvalArgs({ mode: 'auto_deny' }))

    expect(handle.approval.status).toBe('auto_denied')
    await expect(handle.settled).resolves.toMatchObject({ status: 'auto_denied' })
    expect(registry.list()).toEqual([])
    // The decision is logged, never the command.
    expect(JSON.stringify(logged)).toContain('auto_denied')
    expect(JSON.stringify(logged)).not.toContain('id_rsa')
  })

  test.each([
    ['allow', 'allowed'],
    ['deny', 'denied'],
  ] as const)('answers a pending request once (%s)', async (decision, status) => {
    const registry = new CommandApprovalRegistry()
    const handle = registry.begin(approvalArgs())

    expect(registry.list('agent-1')).toEqual([handle.approval])
    expect(registry.list('agent-2')).toEqual([])
    expect(registry.respond('approval-1', decision)).toMatchObject({ status })
    await expect(handle.settled).resolves.toMatchObject({ status })
    expect(registry.list()).toEqual([])
    // A second answer finds nothing pending.
    expect(registry.respond('approval-1', 'allow')).toBeUndefined()
  })

  test('expires an unanswered request', async () => {
    vi.useFakeTimers()
    const registry = new CommandApprovalRegistry(50)
    const handle = registry.begin(approvalArgs())

    await vi.advanceTimersByTimeAsync(50)

    await expect(handle.settled).resolves.toMatchObject({ status: 'expired' })
    expect(registry.list()).toEqual([])
    expect(registry.respond('approval-1', 'allow')).toBeUndefined()
  })

  test('the end of the turn cancels its pending request', async () => {
    const registry = new CommandApprovalRegistry()
    const controller = new AbortController()
    const handle = registry.begin(approvalArgs(), controller.signal)

    controller.abort()
    await expect(handle.settled).resolves.toMatchObject({ status: 'cancelled' })
    expect(registry.list()).toEqual([])

    const ended = new AbortController()
    ended.abort()
    expect(registry.begin(approvalArgs({ id: 'approval-2' }), ended.signal).approval.status).toBe(
      'cancelled',
    )
  })

  test('refuses a second pending request with the same id', () => {
    const registry = new CommandApprovalRegistry()
    registry.begin(approvalArgs())
    expect(() => registry.begin(approvalArgs())).toThrow(/duplicate shell approval id/)
  })
})
