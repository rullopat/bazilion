import { expect, test } from 'vitest'
import { snapshotNativeFailureObservation } from '../../src/core/coding-environment/native-failure.ts'
import {
  NativeCommandError,
  nativeCommandFailureObservation,
} from '../../src/lib/native-execution/command.ts'

const observation = () => ({
  backend: 'darwin-seatbelt',
  phase: 'census',
  ownerLive: true,
  commandCompleted: true,
  commandNaturalEOF: true,
  fenced: true,
  terminalProof: false,
  captures: ['drift', 'drift'],
})
test('closed failure facts are frozen copies, never resource or process authority', () => {
  const source = observation(),
    copy = snapshotNativeFailureObservation(source)
  source.captures[0] = 'unknown'
  expect(copy.captures).toEqual(['drift', 'drift'])
  expect(Object.isFrozen(copy)).toBe(true)
  expect(Object.isFrozen(copy.captures)).toBe(true)
  expect(Object.keys(copy).sort()).toEqual([
    'backend',
    'captures',
    'commandCompleted',
    'commandNaturalEOF',
    'fenced',
    'ownerLive',
    'phase',
    'terminalProof',
  ])
})
test.each([
  { pid: 123 },
  { phase: 'private/path' },
  { phase: { toString: (): string => 'census' } },
  { ownerLive: 1 },
  { captures: ['drift', 'drift', 'drift'] },
  { captures: ['private diagnostic'] },
  { captures: Array(2) },
  { backend: 'linux-bwrap' },
])('unknown or nonclosed diagnostic facts refuse: %j', (invalid) => {
  expect(() => snapshotNativeFailureObservation({ ...observation(), ...invalid })).toThrow(
    'Invalid native failure observation',
  )
})
test('daemon projection strips native-only details and bounds reason strings before IPC', () => {
  const domain = {
    ...observation(),
    pid: 123,
    privatePath: 'controlled-never-disclose',
    captures: [
      { kind: 'unknown', reason: 'first_drift' },
      { kind: 'observation', state: 'empty_at_capture' },
    ],
  }
  const error = new NativeCommandError('recovery_required', false, {
    backend: 'darwin-seatbelt',
    domain: domain as never,
  })
  expect(nativeCommandFailureObservation(error)).toEqual({
    ...observation(),
    captures: ['drift', 'empty_at_capture'],
  })
  expect(JSON.stringify(nativeCommandFailureObservation(error))).not.toContain('123')
  expect(JSON.stringify(nativeCommandFailureObservation(error))).not.toContain(
    'controlled-never-disclose',
  )
  expect(
    nativeCommandFailureObservation(new NativeCommandError('cancelled', true, error.observation)),
  ).toBeUndefined()
})
