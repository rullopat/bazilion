import { afterEach, expect, test } from 'vitest'
import {
  AgentTurnActiveError,
  cancelAgent,
  isActiveAgent,
  registerAgent,
  runAgentLifecycleMutation,
  unregisterAgent,
} from '../../src/lib/agent-cancel.ts'

const touched = new Set<string>()
afterEach(() => {
  for (const id of touched) unregisterAgent(id)
  touched.clear()
})

test('a turn that starts during a lifecycle mutation is refused as busy', async () => {
  const id = 'lifecycle-first'
  touched.add(id)
  let finish: () => void = () => {}
  const mutation = runAgentLifecycleMutation(
    id,
    () => new Promise<string>((resolve) => (finish = () => resolve('mutated'))),
  )
  expect(isActiveAgent(id)).toBe(true)
  expect(() => registerAgent(id, new AbortController())).toThrow(AgentTurnActiveError)
  finish()
  await expect(mutation).resolves.toBe('mutated')
  expect(isActiveAgent(id)).toBe(false)
})

test('lifecycle rejects during a turn and remains rejected through cancellation settlement', async () => {
  const id = 'turn-first'
  touched.add(id)
  const controller = new AbortController()
  registerAgent(id, controller)

  await expect(runAgentLifecycleMutation(id, () => 'mutated')).rejects.toThrow(AgentTurnActiveError)
  expect(cancelAgent(id)).toBe(true)
  expect(controller.signal.aborted).toBe(true)
  expect(isActiveAgent(id)).toBe(true)
  await expect(runAgentLifecycleMutation(id, () => 'mutated')).rejects.toThrow(AgentTurnActiveError)

  unregisterAgent(id)
  await expect(runAgentLifecycleMutation(id, () => 'mutated')).resolves.toBe('mutated')
})

test('a second turn registration cannot overwrite the active cancellation controller', () => {
  const id = 'duplicate-turn'
  touched.add(id)
  const first = new AbortController()
  registerAgent(id, first)
  expect(() => registerAgent(id, new AbortController())).toThrow(AgentTurnActiveError)
  expect(cancelAgent(id)).toBe(true)
  expect(first.signal.aborted).toBe(true)
})
