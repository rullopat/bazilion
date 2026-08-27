// Inbound-queue tests — queue ordering, attempt isolation, single-drain
// invariant. The drain loop calls runAgentTurn which spawns a real worker
// subprocess; for unit-test purposes we monkey-patch the module so the
// loop sees a controllable async iterator.

import type { Attachment } from '@bazilion/api-types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TelegramIngressAttempt } from '../../src/lib/telegram/ingress-attempt.ts'

interface CapturedTurn {
  invocation: {
    kind: 'telegram'
    authorization: TelegramIngressAttempt
    turn: { agentId: string; message: string; attachments: Attachment[] }
    bashApprovalMode: 'auto_deny'
  }
}

function attempt(
  agentId: string,
  messageId: number,
  text: string,
  attachment?: Attachment,
): TelegramIngressAttempt {
  return {
    origin: 'telegram_agent_topic',
    attemptKind: 'telegram_ingress',
    attemptId: `-100:${messageId}`,
    approvalPayloadKind: 'telegram_ingress',
    approvalPayload: {
      agentId,
      text,
      media: attachment
        ? {
            kind: 'document',
            fileId: `file-${messageId}`,
            fileName: attachment.name ?? null,
            mimeType: attachment.mimeType,
            fileSize: null,
          }
        : null,
      chatId: -100,
      threadId: 42,
      messageId,
    },
    requester: 'telegram:11',
  }
}

const ignoreNotice = async (): Promise<void> => {}

describe('inbound-queue', () => {
  // Mock the runAgentTurn import so we don't try to spawn workers in tests.
  // `vi.doMock` is dynamic so we can swap implementations across tests.

  let runAgentTurnCalls: CapturedTurn[] = []
  let frameOutput: AsyncGenerator<unknown> | null = null
  let prepareBehavior: ((turn: CapturedTurn) => Promise<CapturedTurn>) | null = null

  beforeEach(async () => {
    runAgentTurnCalls = []
    prepareBehavior = null
    vi.resetModules()
    // Returns an async generator; declaring as a non-generator function
    // that returns one avoids biome's `useYield` rule firing on the
    // branch where frameOutput is null (which is the common case in these
    // tests — the inbound-queue drain loop only cares about completion).
    vi.doMock('../../src/lib/agent-turn.ts', () => ({
      prepareAgentTurn: async (turn: CapturedTurn) => {
        if (prepareBehavior) return prepareBehavior(turn)
        runAgentTurnCalls.push(turn)
        return turn
      },
      runAgentTurn: () => {
        return (async function* () {
          if (frameOutput) {
            for await (const f of frameOutput) yield f
          }
        })()
      },
    }))
  })
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('../../src/lib/agent-turn.ts')
    frameOutput = null
  })

  test('single message → one runAgentTurn call', async () => {
    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()
    enqueueAgentMessage('a1', 'hello', [], attempt('a1', 1, 'hello'), ignoreNotice)
    // Drain runs on the microtask — give it a tick.
    await new Promise((r) => setTimeout(r, 5))
    expect(runAgentTurnCalls).toEqual([
      {
        invocation: {
          kind: 'telegram',
          authorization: attempt('a1', 1, 'hello'),
          turn: { agentId: 'a1', message: 'hello', attachments: [] },
          bashApprovalMode: 'auto_deny',
        },
      },
    ])
  })

  test('messages queued during a turn remain separate FIFO turns with exact identity', async () => {
    // Give the turn a controllable lifetime so we can enqueue while it's running.
    let releaseTurn: () => void = () => {}
    const turnGate = new Promise<void>((r) => {
      releaseTurn = r
    })
    // Generator deliberately yields nothing — the inbound-queue drain
    // loop only cares about completion. The dead `if (false) yield`
    // satisfies biome's useYield rule without changing semantics.
    frameOutput = (async function* () {
      if (false as boolean) yield undefined
      await turnGate
    })() as AsyncGenerator<unknown>

    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()

    // Kick off — turn starts and blocks on turnGate.
    enqueueAgentMessage('a1', 'first', [], attempt('a1', 1, 'first'), ignoreNotice)
    await new Promise((r) => setTimeout(r, 5))
    expect(runAgentTurnCalls).toHaveLength(1)
    expect(runAgentTurnCalls[0]).toMatchObject({
      invocation: { turn: { agentId: 'a1', message: 'first' } },
    })

    // Enqueue two more while the turn is "running" (blocked).
    const secondAttachment = { name: 'second.txt', mimeType: 'text/plain', data: 'Mg==' }
    const thirdAttachment = { name: 'third.txt', mimeType: 'text/plain', data: 'Mw==' }
    enqueueAgentMessage(
      'a1',
      'second',
      [secondAttachment],
      attempt('a1', 2, 'second', secondAttachment),
      ignoreNotice,
    )
    enqueueAgentMessage(
      'a1',
      'third',
      [thirdAttachment],
      attempt('a1', 3, 'third', thirdAttachment),
      ignoreNotice,
    )

    // Now release the first turn — each queued update gets its own turn.
    releaseTurn()
    await new Promise((r) => setTimeout(r, 20))

    expect(runAgentTurnCalls).toHaveLength(3)
    expect(runAgentTurnCalls[1]).toMatchObject({
      invocation: {
        kind: 'telegram',
        authorization: { attemptId: '-100:2', approvalPayload: { messageId: 2 } },
        turn: { agentId: 'a1', message: 'second', attachments: [secondAttachment] },
      },
    })
    expect(runAgentTurnCalls[2]).toMatchObject({
      invocation: {
        kind: 'telegram',
        authorization: { attemptId: '-100:3', approvalPayload: { messageId: 3 } },
        turn: { agentId: 'a1', message: 'third', attachments: [thirdAttachment] },
      },
    })
  })

  test('a real cross-source busy registration retains and eventually drains the exact FIFO head', async () => {
    const agentId = 'cross-source-busy-agent'
    const { isActiveAgent, registerAgent, unregisterAgent } = await import(
      '../../src/lib/agent-cancel.ts'
    )
    const { enqueueAgentMessage, isDraining, pendingMessageCount, _resetInboundQueueForTest } =
      await import('../../src/lib/telegram/inbound-queue.ts')
    _resetInboundQueueForTest()
    const notices: string[] = []
    const notify = async (text: string) => {
      notices.push(text)
    }

    registerAgent(agentId, new AbortController())
    try {
      enqueueAgentMessage(agentId, 'first', [], attempt(agentId, 11, 'first'), notify)
      enqueueAgentMessage(agentId, 'second', [], attempt(agentId, 12, 'second'), notify)

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(isActiveAgent(agentId)).toBe(true)
      expect(isDraining(agentId)).toBe(true)
      expect(pendingMessageCount(agentId)).toBe(2)
      // Waiting happens before final preparation/authorization. A busy Agent
      // therefore causes neither a retry loop nor duplicate authorization.
      expect(runAgentTurnCalls).toEqual([])

      unregisterAgent(agentId)
      await vi.waitFor(() => {
        expect(runAgentTurnCalls).toHaveLength(2)
        expect(pendingMessageCount(agentId)).toBe(0)
      })

      expect(runAgentTurnCalls).toMatchObject([
        {
          invocation: {
            authorization: { attemptId: '-100:11', approvalPayload: { messageId: 11 } },
            turn: { agentId, message: 'first', attachments: [] },
          },
        },
        {
          invocation: {
            authorization: { attemptId: '-100:12', approvalPayload: { messageId: 12 } },
            turn: { agentId, message: 'second', attachments: [] },
          },
        },
      ])
      expect(notices).toEqual([])
    } finally {
      unregisterAgent(agentId)
    }
  })

  test('queue isolation between different agents', async () => {
    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()

    enqueueAgentMessage(
      'a1',
      'agent-1 message',
      [],
      attempt('a1', 1, 'agent-1 message'),
      ignoreNotice,
    )
    enqueueAgentMessage(
      'a2',
      'agent-2 message',
      [],
      attempt('a2', 2, 'agent-2 message'),
      ignoreNotice,
    )
    await new Promise((r) => setTimeout(r, 10))

    expect(runAgentTurnCalls).toHaveLength(2)
    const a1Calls = runAgentTurnCalls.filter((c) => c.invocation.turn.agentId === 'a1')
    const a2Calls = runAgentTurnCalls.filter((c) => c.invocation.turn.agentId === 'a2')
    expect(a1Calls).toHaveLength(1)
    expect(a1Calls[0]).toMatchObject({
      invocation: { turn: { agentId: 'a1', message: 'agent-1 message' } },
    })
    expect(a2Calls).toHaveLength(1)
    expect(a2Calls[0]).toMatchObject({
      invocation: { turn: { agentId: 'a2', message: 'agent-2 message' } },
    })
  })

  test('turn failure does not stall the queue — next message still drains', async () => {
    // Make the first call throw, the second succeed.
    let callCount = 0
    vi.resetModules()
    vi.doMock('../../src/lib/agent-turn.ts', () => ({
      prepareAgentTurn: async (turn: CapturedTurn) => {
        runAgentTurnCalls.push(turn)
        return turn
      },
      runAgentTurn: () => {
        callCount += 1
        return (async function* () {
          if (false as boolean) yield undefined
          if (callCount === 1) {
            throw new Error('first turn boom')
          }
          // Second call ends without yielding — simulates a quiet turn.
        })()
      },
    }))

    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()

    // Silence the expected warning.
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    enqueueAgentMessage('a1', 'first', [], attempt('a1', 1, 'first'), ignoreNotice)
    enqueueAgentMessage('a1', 'second', [], attempt('a1', 2, 'second'), ignoreNotice)
    await new Promise((r) => setTimeout(r, 10))

    expect(
      runAgentTurnCalls.map(({ invocation }) => ({
        agentId: invocation.turn.agentId,
        message: invocation.turn.message,
      })),
    ).toEqual([
      { agentId: 'a1', message: 'first' },
      { agentId: 'a1', message: 'second' },
    ])
  })

  test('policy failures notify the owning topic and do not stall later items', async () => {
    let callCount = 0
    let pendingError: unknown
    let deniedError: unknown
    const { CommunicationDeniedError, CommunicationPendingError } = await import(
      '../../src/lib/communication.ts'
    )
    pendingError = new CommunicationPendingError({ id: 'approval-1' } as never)
    deniedError = new CommunicationDeniedError(
      {
        decision: 'deny',
        channel: 'user',
        reasonCode: 'no_allow_edge',
        reason: 'blocked',
        policyRefs: [],
        componentOutcomes: [],
        matchedEdgeIds: [],
        requiredEdgeIds: [],
      },
      'telegram_ingress',
      '-100:2',
    )
    prepareBehavior = async (turn) => {
      callCount += 1
      if (callCount === 1) throw pendingError
      if (callCount === 2) throw deniedError
      return turn
    }
    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notices: string[] = []
    const notify = async (text: string) => {
      notices.push(text)
    }

    enqueueAgentMessage('a1', 'first', [], attempt('a1', 1, 'first'), notify)
    enqueueAgentMessage('a1', 'second', [], attempt('a1', 2, 'second'), notify)
    enqueueAgentMessage('a1', 'third', [], attempt('a1', 3, 'third'), notify)
    await new Promise((r) => setTimeout(r, 20))

    expect(callCount).toBe(3)
    expect(notices).toEqual([
      'Communication is pending approval (approval-1).',
      'Communication blocked by Team policy (no_allow_edge).',
    ])
  })

  test('protected preflight failure sends one bounded secret-free owning-topic notice', async () => {
    const secret = 'TELEGRAM_PREFLIGHT_SECRET_SENTINEL'
    let callCount = 0
    prepareBehavior = async (turn) => {
      callCount += 1
      if (callCount === 1) throw new Error(`Docker unavailable: ${secret}`)
      return turn
    }
    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()
    const warnings: unknown[][] = []
    vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args))
    const notices: string[] = []
    const notify = async (text: string) => {
      notices.push(text)
    }

    enqueueAgentMessage('a1', 'first', [], attempt('a1', 1, 'first'), notify)
    enqueueAgentMessage('a1', 'second', [], attempt('a1', 2, 'second'), notify)
    await new Promise((r) => setTimeout(r, 20))

    expect(callCount).toBe(2)
    expect(notices).toEqual([
      'This protected turn could not start. Check Bazilion Config or bazilion doctor.',
    ])
    expect(notices[0]?.length).toBeLessThan(200)
    expect(JSON.stringify(warnings)).not.toContain(secret)
  })

  test('a non-busy failure is not swallowed merely because its text resembles the busy code', async () => {
    let callCount = 0
    prepareBehavior = async (turn) => {
      callCount += 1
      if (callCount === 1) throw new Error('agent_turn_active: a1')
      runAgentTurnCalls.push(turn)
      return turn
    }
    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notices: string[] = []
    const notify = async (text: string) => {
      notices.push(text)
    }

    enqueueAgentMessage('a1', 'first', [], attempt('a1', 1, 'first'), notify)
    enqueueAgentMessage('a1', 'second', [], attempt('a1', 2, 'second'), notify)
    await vi.waitFor(() => expect(callCount).toBe(2))

    expect(runAgentTurnCalls).toMatchObject([
      {
        invocation: {
          authorization: { attemptId: '-100:2' },
          turn: { message: 'second' },
        },
      },
    ])
    expect(notices).toEqual([
      'This protected turn could not start. Check Bazilion Config or bazilion doctor.',
    ])
  })

  test('rejects a queue item whose attempt identity does not match its Telegram update', async () => {
    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()
    const mismatched = attempt('other-agent', 1, 'hello')
    expect(() => enqueueAgentMessage('a1', 'hello', [], mismatched, ignoreNotice)).toThrow(
      /telegram_ingress_invalid/,
    )
    expect(runAgentTurnCalls).toEqual([])
  })

  test('rejects turn content that is not derived from the retained Telegram payload', async () => {
    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()
    const attachment = { name: 'file.txt', mimeType: 'text/plain', data: 'ZmlsZQ==' }

    expect(() =>
      enqueueAgentMessage('a1', 'substituted', [], attempt('a1', 1, 'original'), ignoreNotice),
    ).toThrow(/invalid trusted turn invocation/)
    expect(() =>
      enqueueAgentMessage(
        'a1',
        'caption',
        [],
        attempt('a1', 2, 'caption', attachment),
        ignoreNotice,
      ),
    ).toThrow(/invalid trusted turn invocation/)
    expect(() =>
      enqueueAgentMessage('a1', 'plain', [attachment], attempt('a1', 3, 'plain'), ignoreNotice),
    ).toThrow(/invalid trusted turn invocation/)
    expect(runAgentTurnCalls).toEqual([])
  })
})
