import type { NativeExecutionFailureObservation } from '@bazilion/api-types'

/** Portable closed metadata validation. No process, native-reader or resource authority. */
export function snapshotNativeFailureObservation(
  value: unknown,
): NativeExecutionFailureObservation {
  const fields = [
    'backend',
    'phase',
    'ownerLive',
    'commandCompleted',
    'commandNaturalEOF',
    'fenced',
    'terminalProof',
    'captures',
  ]
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error('Invalid native failure observation')
  const item = value as Record<string, unknown>
  if (
    item.backend !== 'darwin-seatbelt' ||
    typeof item.phase !== 'string' ||
    ![
      'idle',
      'ready',
      'term',
      'kill',
      'command-eof',
      'census',
      'exit',
      'group',
      'settled',
    ].includes(item.phase) ||
    ['ownerLive', 'commandCompleted', 'commandNaturalEOF', 'fenced', 'terminalProof'].some(
      (key) => typeof item[key] !== 'boolean',
    ) ||
    !Array.isArray(item.captures) ||
    item.captures.length > 2 ||
    !Array.from(item.captures).every((capture) =>
      ['empty_at_capture', 'busy', 'drift', 'unknown'].includes(capture),
    )
  )
    throw new Error('Invalid native failure observation')
  return Object.freeze({
    ...item,
    captures: Object.freeze([...item.captures]),
  }) as unknown as NativeExecutionFailureObservation
}
