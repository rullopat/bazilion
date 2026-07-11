import { afterEach, expect, test } from 'vitest'
import {
  cancelAgent,
  isActiveAgent,
  registerAgent,
  unregisterAgent,
} from '../../src/lib/agent-cancel.ts'
import {
  acquireAgentLifecycleLease,
  runAgentLifecycleMutation,
} from '../../src/lib/agent-lifecycle-lease.ts'

const touched = new Set<string>()
afterEach(() => {
  for (const id of touched) unregisterAgent(id)
  touched.clear()
})

test('turn registration waits wholly after an in-progress lifecycle mutation', async () => {
  const id = 'lifecycle-first'
  touched.add(id)
  const releaseLifecycle = await acquireAgentLifecycleLease(id)
  let registered = false
  const queuedTurn = acquireAgentLifecycleLease(id).then((releaseTurn) => {
    registerAgent(id, new AbortController())
    registered = true
    releaseTurn()
  })

  await Promise.resolve()
  expect(registered).toBe(false)
  expect(isActiveAgent(id)).toBe(false)
  releaseLifecycle()
  await queuedTurn
  expect(registered).toBe(true)
  expect(isActiveAgent(id)).toBe(true)
})

test('lifecycle rejects after turn registration and remains rejected through cancellation settlement', async () => {
  const id = 'turn-first'
  touched.add(id)
  const releaseTurn = await acquireAgentLifecycleLease(id)
  const controller = new AbortController()
  registerAgent(id, controller)
  releaseTurn()

  await expect(runAgentLifecycleMutation(id, () => 'mutated')).rejects.toThrow(/agent_turn_active/)
  expect(cancelAgent(id)).toBe(true)
  expect(controller.signal.aborted).toBe(true)
  expect(isActiveAgent(id)).toBe(true)
  await expect(runAgentLifecycleMutation(id, () => 'mutated')).rejects.toThrow(/agent_turn_active/)

  unregisterAgent(id)
  await expect(runAgentLifecycleMutation(id, () => 'mutated')).resolves.toBe('mutated')
})

test('a second turn registration cannot overwrite the active cancellation controller', () => {
  const id = 'duplicate-turn'
  touched.add(id)
  const first = new AbortController()
  registerAgent(id, first)
  expect(() => registerAgent(id, new AbortController())).toThrow(/agent_turn_active/)
  expect(cancelAgent(id)).toBe(true)
  expect(first.signal.aborted).toBe(true)
})
