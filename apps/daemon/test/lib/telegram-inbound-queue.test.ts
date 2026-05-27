// Inbound-queue tests — queue ordering, concatenation, single-drain
// invariant. The drain loop calls runAgentTurn which spawns a real worker
// subprocess; for unit-test purposes we monkey-patch the module so the
// loop sees a controllable async iterator.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

describe('inbound-queue', () => {
  // Mock the runAgentTurn import so we don't try to spawn workers in tests.
  // `vi.doMock` is dynamic so we can swap implementations across tests.

  let runAgentTurnCalls: { agentId: string; message: string }[] = []
  let frameOutput: AsyncGenerator<unknown> | null = null

  beforeEach(async () => {
    runAgentTurnCalls = []
    vi.resetModules()
    // Returns an async generator; declaring as a non-generator function
    // that returns one avoids biome's `useYield` rule firing on the
    // branch where frameOutput is null (which is the common case in these
    // tests — the inbound-queue drain loop only cares about completion).
    vi.doMock('../../src/lib/agent-turn.ts', () => ({
      runAgentTurn: (agentId: string, message: string) => {
        runAgentTurnCalls.push({ agentId, message })
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
    enqueueAgentMessage('a1', 'hello')
    // Drain runs on the microtask — give it a tick.
    await new Promise((r) => setTimeout(r, 5))
    expect(runAgentTurnCalls).toEqual([{ agentId: 'a1', message: 'hello' }])
  })

  test('messages queued during a turn concatenate into the next turn input', async () => {
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
    enqueueAgentMessage('a1', 'first')
    await new Promise((r) => setTimeout(r, 5))
    expect(runAgentTurnCalls).toHaveLength(1)
    expect(runAgentTurnCalls[0]).toEqual({ agentId: 'a1', message: 'first' })

    // Enqueue two more while the turn is "running" (blocked).
    enqueueAgentMessage('a1', 'second')
    enqueueAgentMessage('a1', 'third')

    // Now release the first turn — drain loop should pick up the queued
    // messages and call runAgentTurn again with them concatenated.
    releaseTurn()
    await new Promise((r) => setTimeout(r, 20))

    expect(runAgentTurnCalls).toHaveLength(2)
    expect(runAgentTurnCalls[1]).toEqual({ agentId: 'a1', message: 'second\n\nthird' })
  })

  test('queue isolation between different agents', async () => {
    const { enqueueAgentMessage, _resetInboundQueueForTest } = await import(
      '../../src/lib/telegram/inbound-queue.ts'
    )
    _resetInboundQueueForTest()

    enqueueAgentMessage('a1', 'agent-1 message')
    enqueueAgentMessage('a2', 'agent-2 message')
    await new Promise((r) => setTimeout(r, 10))

    expect(runAgentTurnCalls).toHaveLength(2)
    const a1Calls = runAgentTurnCalls.filter((c) => c.agentId === 'a1')
    const a2Calls = runAgentTurnCalls.filter((c) => c.agentId === 'a2')
    expect(a1Calls).toEqual([{ agentId: 'a1', message: 'agent-1 message' }])
    expect(a2Calls).toEqual([{ agentId: 'a2', message: 'agent-2 message' }])
  })

  test('turn failure does not stall the queue — next message still drains', async () => {
    // Make the first call throw, the second succeed.
    let callCount = 0
    vi.resetModules()
    vi.doMock('../../src/lib/agent-turn.ts', () => ({
      runAgentTurn: (agentId: string, message: string) => {
        callCount += 1
        runAgentTurnCalls.push({ agentId, message })
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

    enqueueAgentMessage('a1', 'first')
    await new Promise((r) => setTimeout(r, 10))
    enqueueAgentMessage('a1', 'second')
    await new Promise((r) => setTimeout(r, 10))

    expect(runAgentTurnCalls).toEqual([
      { agentId: 'a1', message: 'first' },
      { agentId: 'a1', message: 'second' },
    ])
  })
})
