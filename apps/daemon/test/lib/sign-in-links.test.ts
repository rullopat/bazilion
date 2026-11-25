import { afterEach, expect, test } from 'vitest'
import {
  _resetSignInCodesForTest,
  consumeSignInCode,
  createSignInCode,
  SIGN_IN_LINK_TTL_MS,
} from '../../src/lib/sign-in-links.ts'

afterEach(() => _resetSignInCodesForTest())

test('a code is used once, and not after two minutes', () => {
  const now = 1_000_000
  const first = createSignInCode('token-a', now)
  expect(first.expiresAt).toBe(now + SIGN_IN_LINK_TTL_MS)
  expect(consumeSignInCode(first.code, now + 1_000)).toBe('token-a')
  expect(consumeSignInCode(first.code, now + 2_000)).toBeNull()

  const late = createSignInCode('token-a', now)
  expect(consumeSignInCode(late.code, now + SIGN_IN_LINK_TTL_MS)).toBeNull()
  expect(consumeSignInCode('never-made', now)).toBeNull()
})

test('codes are random, and only the latest twenty are kept', () => {
  const now = 1_000_000
  const codes = Array.from({ length: 25 }, () => createSignInCode('token-a', now).code)
  expect(new Set(codes).size).toBe(25)
  expect(codes.every((code) => /^[\w-]{43}$/.test(code))).toBe(true)
  expect(consumeSignInCode(codes[0] as string, now)).toBeNull()
  expect(consumeSignInCode(codes[24] as string, now)).toBe('token-a')
})
