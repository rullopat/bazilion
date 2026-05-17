import { expect, test } from 'vitest'
import {
  HEARTBEAT_PROMPT,
  isHeartbeatContentEffectivelyEmpty,
  resolveHeartbeatPrompt,
} from '../../src/runtime/auto-reply/heartbeat.ts'

test('resolveHeartbeatPrompt falls back to the canned prompt when raw is empty', () => {
  expect(resolveHeartbeatPrompt()).toBe(HEARTBEAT_PROMPT)
  expect(resolveHeartbeatPrompt('')).toBe(HEARTBEAT_PROMPT)
  expect(resolveHeartbeatPrompt('   \n  ')).toBe(HEARTBEAT_PROMPT)
  expect(resolveHeartbeatPrompt(null)).toBe(HEARTBEAT_PROMPT)
})

test('resolveHeartbeatPrompt preserves a custom non-empty prompt', () => {
  expect(resolveHeartbeatPrompt('do a thing')).toBe('do a thing')
})

test('isHeartbeatContentEffectivelyEmpty treats comments/bullets as empty', () => {
  expect(isHeartbeatContentEffectivelyEmpty('')).toBe(true)
  expect(isHeartbeatContentEffectivelyEmpty('# only header\n\n## subheader\n')).toBe(true)
  expect(isHeartbeatContentEffectivelyEmpty('- [ ]\n- [x]\n* [ ]\n+ \n')).toBe(true)
})

test('isHeartbeatContentEffectivelyEmpty detects actionable content', () => {
  expect(isHeartbeatContentEffectivelyEmpty('- [ ] check inbox')).toBe(false)
  expect(isHeartbeatContentEffectivelyEmpty('follow up with user')).toBe(false)
  expect(isHeartbeatContentEffectivelyEmpty('#TODO sneaky')).toBe(false) // not an ATX header (no space)
})

test('isHeartbeatContentEffectivelyEmpty treats non-strings as non-empty (let the LLM decide)', () => {
  expect(isHeartbeatContentEffectivelyEmpty(null)).toBe(false)
  expect(isHeartbeatContentEffectivelyEmpty(undefined)).toBe(false)
})
