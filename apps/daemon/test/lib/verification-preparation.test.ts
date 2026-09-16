import { expect, test, vi } from 'vitest'
import { bindVerificationCapability } from '../../src/lib/verification/preparation.ts'
import type { VerificationBrief } from '../../src/runtime/tools/verification.ts'

// BAZ-044 slice 5d: the capability is bound to one attempt on the daemon side.
//
// The worker already only sends an ordinal, but the daemon must not take the worker's word for which
// request it is acting on: the args are re-checked against this turn's own binding.

vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => {
    throw new Error('getCtx must not be reached by the capability binding')
  },
}))

const brief: VerificationBrief = {
  requestId: 'req-1',
  summary: null,
  snapshot: { id: 'snap-1', complete: true, head: 'head', baseOid: 'base' },
  environment: { image: 'debian', sandbox: 'off' },
  writablePaths: [],
  checks: [],
  applicability: 'identical',
}

function capability() {
  const ran: number[] = []
  return {
    ran,
    host: {
      read: async () => brief,
      invoke: async (ordinal: number) => {
        ran.push(ordinal)
        return {
          ordinal,
          state: 'succeeded' as const,
          commandId: 'cmd-1',
          exitCode: 0,
          output: '',
          truncated: false,
        }
      },
    },
  }
}

test('the capability refuses any identity but its own', async () => {
  const { ran, host } = capability()
  const bound = bindVerificationCapability(host, { requestId: 'req-1', attemptId: 'attempt-1' })

  // The turn's own identity works, and the ordinal travels unchanged.
  await expect(bound.run('req-1', 'attempt-1', 0)).resolves.toMatchObject({ ordinal: 0 })
  await expect(bound.read('req-1', 'attempt-1')).resolves.toMatchObject({ requestId: 'req-1' })
  expect(ran).toEqual([0])

  // Another request, another attempt, or a missing identity is refused before anything runs.
  await expect(bound.run('req-2', 'attempt-1', 1)).rejects.toThrow('bound to a different request')
  await expect(bound.run('req-1', 'attempt-2', 2)).rejects.toThrow('bound to a different request')
  await expect(bound.read('req-2', 'attempt-1')).rejects.toThrow('bound to a different request')
  expect(ran).toEqual([0])
})
