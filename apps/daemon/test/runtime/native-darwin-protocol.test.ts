import { expect, test } from 'vitest'
import {
  DARWIN_JOB_MAX_COMMAND_BYTES,
  nextDarwinJobPhase,
  parseDarwinJobRequest,
} from '../../src/runtime/shell/native/darwin-protocol.ts'

test('private Darwin job requests carry no backend/profile/cwd/env/PID override', () => {
  const execute = { type: 'execute', id: 1, command: 'printf private-job' }
  expect(parseDarwinJobRequest(execute)).toEqual(execute)
  expect(Object.isFrozen(parseDarwinJobRequest(execute))).toBe(true)
  for (const extra of ['backend', 'profile', 'cwd', 'env', 'pid', 'helper', 'timeoutMs']) {
    expect(() => parseDarwinJobRequest({ ...execute, [extra]: 'unadmitted' })).toThrow(
      'protocol unavailable',
    )
  }
})

test.each([
  null,
  [],
  {},
  { type: 'execute', id: 0, command: 'x' },
  { type: 'execute', id: 1.5, command: 'x' },
  { type: 'execute', id: 0x80000000, command: 'x' },
  { type: 'invoke', id: 1 },
  { type: 'execute', id: 1, command: '' },
  { type: 'execute', id: 1, command: ' \n' },
  { type: 'execute', id: 1, command: 'x\0y' },
  { type: 'execute', id: 1, command: '\ud800' },
])('malformed private request refuses: %j', (value) => {
  expect(() => parseDarwinJobRequest(value)).toThrow('protocol unavailable')
})

test('command admission is bounded before any spawn and signal selection is closed', () => {
  expect(() =>
    parseDarwinJobRequest({
      type: 'execute',
      id: 1,
      command: 'x'.repeat(DARWIN_JOB_MAX_COMMAND_BYTES + 1),
    }),
  ).toThrow()
  expect(parseDarwinJobRequest({ type: 'signal', id: 2, signal: 'SIGTERM' })).toEqual({
    type: 'signal',
    id: 2,
    signal: 'SIGTERM',
  })
  for (const signal of ['SIGSTOP', 'SIGINT', 9, null])
    expect(() => parseDarwinJobRequest({ type: 'signal', id: 2, signal })).toThrow()
  expect(() =>
    parseDarwinJobRequest({ type: 'signal', id: 2, signal: 'SIGKILL', pid: 100 }),
  ).toThrow()
})

test('scope envelopes stay bounded; row/identity semantics belong to the closed shared reader', () => {
  expect(
    parseDarwinJobRequest({ type: 'scope', id: 3, inventory: { kind: 'inventory', rows: [{}] } })
      .type,
  ).toBe('scope')
  for (const inventory of [
    { kind: 'inventory', rows: [] },
    { kind: 'inventory', rows: Array(16385).fill({}) },
    { kind: 'inventory', rows: [{}], selector: 'any-process' },
    { kind: 'unknown', rows: [{}] },
  ]) {
    expect(() => parseDarwinJobRequest({ type: 'scope', id: 3, inventory })).toThrow()
  }
})

test('one command and a permanent spawn fence forbid replay and scope before sealing', () => {
  const execute = parseDarwinJobRequest({ type: 'execute', id: 1, command: 'true' })
  const seal = parseDarwinJobRequest({ type: 'seal', id: 2 })
  const scope = parseDarwinJobRequest({
    type: 'scope',
    id: 3,
    inventory: { kind: 'inventory', rows: [{}] },
  })
  const exit = parseDarwinJobRequest({ type: 'exit', id: 4, scopeId: 3 })
  expect(nextDarwinJobPhase('waiting', execute)).toBe('running')
  expect(() => nextDarwinJobPhase('running', seal)).toThrow()
  expect(() => nextDarwinJobPhase('running', scope)).toThrow()
  expect(nextDarwinJobPhase('completed', seal)).toBe('sealed')
  expect(nextDarwinJobPhase('sealed', scope)).toBe('sealed')
  expect(() => nextDarwinJobPhase('sealed', execute)).toThrow()
  expect(() => nextDarwinJobPhase('completed', execute)).toThrow()
  expect(nextDarwinJobPhase('sealed', exit)).toBe('closing')
  expect(() => nextDarwinJobPhase('closing', scope)).toThrow()
  expect(() => nextDarwinJobPhase('closing', execute)).toThrow()
})
