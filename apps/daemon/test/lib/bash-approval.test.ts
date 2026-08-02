import { afterEach, describe, expect, test, vi } from 'vitest'
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
        severity: 'danger',
        message: 'Accesses a path that commonly contains credentials.',
        matchedText: '~/.ssh/id_rsa',
        span: { start: 4, end: 17 },
      },
    ],
    mode: 'interactive',
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CommandApprovalRegistry', () => {
  test('auto-denies non-interactive commands without creating a pending request', async () => {
    const audits: unknown[] = []
    const registry = new CommandApprovalRegistry({ audit: (entry) => audits.push(entry) })

    const handle = registry.begin(approvalArgs({ mode: 'auto_deny' }))

    expect(handle.approval.status).toBe('auto_denied')
    await expect(handle.decision).resolves.toEqual({ decision: 'deny', reason: 'auto_deny' })
    expect(registry.list()).toEqual([])
    expect(audits).toEqual([
      {
        approvalId: 'approval-1',
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        agentId: 'agent-1',
        teamId: 'team-1',
        riskCodes: ['sensitive-path-read'],
        status: 'auto_denied',
      },
    ])
    expect(JSON.stringify(audits)).not.toContain('id_rsa')
    registry.cancelAll()
  })

  test('allows exactly one interactive response and makes same-decision retries idempotent', async () => {
    const registry = new CommandApprovalRegistry({ audit: () => {} })
    const controller = new AbortController()
    const handle = registry.begin(approvalArgs(), controller.signal)

    expect(registry.list('agent-1')).toEqual([handle.approval])
    expect(registry.respond('approval-1', 'allow')).toMatchObject({
      kind: 'accepted',
      approval: { status: 'allowed' },
    })
    await expect(handle.decision).resolves.toEqual({ decision: 'allow', reason: 'user' })
    expect(registry.respond('approval-1', 'allow')).toMatchObject({ kind: 'already_applied' })
    expect(registry.respond('approval-1', 'deny')).toMatchObject({ kind: 'conflict' })
    expect(() =>
      registry.begin(approvalArgs({ id: 'approval-replay' }), controller.signal),
    ).toThrow(/already decided/)
    registry.cancelAll()
  })

  test.each([
    'allow',
    'deny',
  ] as const)('keeps a %s tuple claimed after its response tombstone expires', async (decision) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const registry = new CommandApprovalRegistry({
      tombstoneTtlMs: 25,
      audit: () => {},
    })
    const handle = registry.begin(approvalArgs(), controller.signal)

    expect(registry.respond('approval-1', decision)).toMatchObject({ kind: 'accepted' })
    await expect(handle.decision).resolves.toEqual({ decision, reason: 'user' })
    await vi.advanceTimersByTimeAsync(25)
    expect(registry.respond('approval-1', decision)).toEqual({ kind: 'not_found' })
    expect(() =>
      registry.begin(approvalArgs({ id: 'approval-replay' }), controller.signal),
    ).toThrow(/already decided/)

    controller.abort()
    const nextLifetime = new AbortController()
    const next = registry.begin(approvalArgs({ id: 'approval-next-lifetime' }), nextLifetime.signal)
    expect(next.approval.status).toBe('pending')
    nextLifetime.abort()
    registry.cancelAll()
  })

  test('keeps timed-out and auto-denied tuples claimed for the worker lifetime', async () => {
    vi.useFakeTimers()
    const timedOutLifetime = new AbortController()
    const timedOutRegistry = new CommandApprovalRegistry({
      timeoutMs: 10,
      tombstoneTtlMs: 10,
      audit: () => {},
    })
    const timedOut = timedOutRegistry.begin(approvalArgs(), timedOutLifetime.signal)

    await vi.advanceTimersByTimeAsync(20)
    await expect(timedOut.decision).resolves.toEqual({ decision: 'deny', reason: 'timeout' })
    expect(() =>
      timedOutRegistry.begin(
        approvalArgs({ id: 'approval-timeout-replay' }),
        timedOutLifetime.signal,
      ),
    ).toThrow(/already decided/)

    const autoDenyLifetime = new AbortController()
    const autoDenyRegistry = new CommandApprovalRegistry({
      tombstoneTtlMs: 10,
      audit: () => {},
    })
    const autoDenied = autoDenyRegistry.begin(
      approvalArgs({ id: 'approval-auto', mode: 'auto_deny' }),
      autoDenyLifetime.signal,
    )
    await expect(autoDenied.decision).resolves.toEqual({
      decision: 'deny',
      reason: 'auto_deny',
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(() =>
      autoDenyRegistry.begin(
        approvalArgs({ id: 'approval-auto-replay', mode: 'auto_deny' }),
        autoDenyLifetime.signal,
      ),
    ).toThrow(/already decided/)

    timedOutLifetime.abort()
    autoDenyLifetime.abort()
    timedOutRegistry.cancelAll()
    autoDenyRegistry.cancelAll()
  })

  test('expires a pending request and removes it from the recovery list', async () => {
    vi.useFakeTimers()
    const registry = new CommandApprovalRegistry({ timeoutMs: 50, audit: () => {} })
    const handle = registry.begin(approvalArgs())

    await vi.advanceTimersByTimeAsync(50)

    await expect(handle.decision).resolves.toEqual({ decision: 'deny', reason: 'timeout' })
    expect(registry.list()).toEqual([])
    expect(registry.respond('approval-1', 'allow')).toMatchObject({
      kind: 'conflict',
      approval: { status: 'expired' },
    })
    registry.cancelAll()
  })

  test('cancellation releases a waiter and its worker-lifetime tuple claim', async () => {
    const registry = new CommandApprovalRegistry({ audit: () => {} })
    const controller = new AbortController()
    const handle = registry.begin(approvalArgs(), controller.signal)

    expect(() =>
      registry.begin(
        approvalArgs({
          id: 'approval-2',
        }),
      ),
    ).toThrow(/already pending/)

    controller.abort()
    await expect(handle.decision).resolves.toEqual({ decision: 'deny', reason: 'cancelled' })
    expect(registry.list()).toEqual([])

    const nextLifetime = new AbortController()
    const next = registry.begin(approvalArgs({ id: 'approval-2' }), nextLifetime.signal)
    expect(next.approval.status).toBe('pending')
    nextLifetime.abort()
    registry.cancelAll()
  })

  test('cancelAll clears a settled tuple claim', async () => {
    const registry = new CommandApprovalRegistry({ audit: () => {} })
    const controller = new AbortController()
    const handle = registry.begin(approvalArgs(), controller.signal)
    registry.respond('approval-1', 'allow')
    await expect(handle.decision).resolves.toEqual({ decision: 'allow', reason: 'user' })

    registry.cancelAll()

    const next = registry.begin(approvalArgs({ id: 'approval-2' }))
    expect(next.approval.status).toBe('pending')
    registry.cancelAll()
  })
})
