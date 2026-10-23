import { afterEach, expect, test } from 'vitest'
import {
  isActiveAgent,
  registerAgent,
  stopAgentTurns,
  unregisterAgent,
} from '../../src/lib/agent-cancel.ts'

const key = Symbol.for('bazilion.agent-cancel.registry')
afterEach(() => {
  // Isolate the process-lifetime shutdown fence between unit cases, never in production.
  delete (globalThis as unknown as Record<symbol, unknown>)[key]
})

test('shutdown fences new turns and waits for synchronous and asynchronous owner settlement', async () => {
  const immediate = new AbortController()
  const deferred = new AbortController()
  registerAgent('immediate', immediate)
  registerAgent('deferred', deferred)
  immediate.signal.addEventListener('abort', () => unregisterAgent('immediate'))
  const stopped = stopAgentTurns()
  expect(immediate.signal.aborted).toBe(true)
  expect(deferred.signal.aborted).toBe(true)
  expect(isActiveAgent('immediate')).toBe(false)
  expect(isActiveAgent('deferred')).toBe(true)
  expect(stopAgentTurns()).toBe(stopped)
  expect(() => registerAgent('late', new AbortController())).toThrow('daemon_shutting_down')
  let settled = false
  void stopped.then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  unregisterAgent('deferred')
  await stopped
  expect(isActiveAgent('deferred')).toBe(false)
  expect(() => registerAgent('late', new AbortController())).toThrow('daemon_shutting_down')
})

test('an idle daemon remains admission-fenced after shutdown settles', async () => {
  await stopAgentTurns()
  expect(() => registerAgent('late', new AbortController())).toThrow('daemon_shutting_down')
})
