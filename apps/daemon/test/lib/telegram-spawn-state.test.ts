// Pending-spawn state map tests.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  _resetSpawnStateForTest,
  peekPendingSpawn,
  setPendingSpawn,
  takePendingSpawn,
} from '../../src/lib/telegram/spawn-state.ts'

const CHAT = -1009999
const USER_A = 11
const USER_B = 22

beforeEach(() => _resetSpawnStateForTest())
afterEach(() => _resetSpawnStateForTest())

describe('spawn-state', () => {
  test('setPendingSpawn + takePendingSpawn round-trip', () => {
    setPendingSpawn(CHAT, USER_A, 'coder')
    const taken = takePendingSpawn(CHAT, USER_A)
    expect(taken).toEqual({ profileId: 'coder' })
  })

  test('takePendingSpawn returns null after consumption', () => {
    setPendingSpawn(CHAT, USER_A, 'coder')
    takePendingSpawn(CHAT, USER_A)
    expect(takePendingSpawn(CHAT, USER_A)).toBeNull()
  })

  test('takePendingSpawn returns null for unknown user', () => {
    expect(takePendingSpawn(CHAT, USER_B)).toBeNull()
  })

  test('peekPendingSpawn does NOT consume the entry', () => {
    setPendingSpawn(CHAT, USER_A, 'coder')
    expect(peekPendingSpawn(CHAT, USER_A)).toEqual({ profileId: 'coder' })
    expect(peekPendingSpawn(CHAT, USER_A)).toEqual({ profileId: 'coder' })
    // still consumable
    expect(takePendingSpawn(CHAT, USER_A)).toEqual({ profileId: 'coder' })
    expect(takePendingSpawn(CHAT, USER_A)).toBeNull()
  })

  test('entries from different users do not collide', () => {
    setPendingSpawn(CHAT, USER_A, 'coder')
    setPendingSpawn(CHAT, USER_B, 'researcher')
    expect(takePendingSpawn(CHAT, USER_A)).toEqual({ profileId: 'coder' })
    expect(takePendingSpawn(CHAT, USER_B)).toEqual({ profileId: 'researcher' })
  })

  test('setPendingSpawn overwrites prior entry for the same user', () => {
    setPendingSpawn(CHAT, USER_A, 'coder')
    setPendingSpawn(CHAT, USER_A, 'researcher')
    expect(takePendingSpawn(CHAT, USER_A)).toEqual({ profileId: 'researcher' })
  })

  test('expired entry is treated as missing', () => {
    // Drive Date.now forward by mocking — simpler than waiting 60s.
    const realNow = Date.now
    let now = 1_000_000
    Date.now = () => now
    try {
      setPendingSpawn(CHAT, USER_A, 'coder')
      // Advance past the TTL.
      now += 61_000
      expect(takePendingSpawn(CHAT, USER_A)).toBeNull()
      // After expiry, the entry is also cleared from the map (no double-take).
      now += 1
      expect(peekPendingSpawn(CHAT, USER_A)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })
})
