import { expect, test } from 'vitest'
import { decodeDarwinProcessArguments } from '../fixtures/browser-managed-darwin.ts'

function evidence(argv: string[], environment: string[], trailer = '') {
  const count = Buffer.alloc(4)
  count.writeInt32LE(argv.length)
  return Buffer.concat([
    count,
    Buffer.from(`/native/browser\0\0\0${argv.join('\0')}\0${environment.join('\0')}\0\0${trailer}`),
  ])
}

test('native browser evidence separates environment from padded Darwin apple-vector metadata', () => {
  const argv = ['/native/browser', '--profile=/controlled/profile', '', 'two words']
  const environ = ['PATH=/usr/bin:/bin', 'HOME=/controlled/home', 'LANG=C.UTF-8', 'EMPTY=']
  const decoded = decodeDarwinProcessArguments(
    evidence(argv, environ, 'ptr_munge=0x123\0main_stack=0x456\0security_config=0x0\0'),
  )
  expect(decoded).toEqual({ argv, environ })
})

test('native browser evidence never removes an unexpected real environment variable', () => {
  const environ = [
    'HOME=/controlled/home',
    'AMBIENT_SECRET=must-not-be-admitted',
    'ptr_munge=real-env',
  ]
  expect(decodeDarwinProcessArguments(evidence(['/browser'], environ)).environ).toEqual(environ)
})

test('native browser evidence preserves equals signs and an empty environment', () => {
  expect(decodeDarwinProcessArguments(evidence(['/browser'], ['VALUE=a=b'])).environ).toEqual([
    'VALUE=a=b',
  ])
  expect(
    decodeDarwinProcessArguments(evidence(['/browser'], [], 'main_stack=0x123\0')).environ,
  ).toEqual([])
})

test('native browser evidence refuses malformed native arguments and environment', () => {
  expect(() => decodeDarwinProcessArguments(Buffer.alloc(3))).toThrow(/argc/)
  expect(() => decodeDarwinProcessArguments(evidence([], []))).toThrow(/argc/)
  const truncated = evidence(['/browser'], ['VALUE=abc']).subarray(0, -3)
  expect(() => decodeDarwinProcessArguments(truncated)).toThrow(/environment/)
  expect(() => decodeDarwinProcessArguments(evidence(['/browser'], ['not-an-env-entry']))).toThrow(
    /environment entry/,
  )
})
