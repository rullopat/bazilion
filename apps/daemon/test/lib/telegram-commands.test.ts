// Guards the command registry against the class of bug that broke the slash
// menu in Phase 6: Telegram's setMyCommands rejects any command name outside
// [a-z0-9_]{1,32}, and one bad name fails the WHOLE batch (no menu at all).

import { describe, expect, test } from 'vitest'
import { ALL_COMMANDS, SERVICE_COMMANDS } from '../../src/lib/telegram/commands/index.ts'

const VALID = /^[a-z0-9_]{1,32}$/

describe('SERVICE_COMMANDS (registered via setMyCommands)', () => {
  test('every registered command name is a valid Telegram command', () => {
    for (const c of SERVICE_COMMANDS) {
      expect(c.name, `command "${c.name}" must match ${VALID}`).toMatch(VALID)
    }
  })

  test('descriptions are within Telegram’s 256-char limit', () => {
    for (const c of SERVICE_COMMANDS) {
      expect(c.description.length).toBeLessThanOrEqual(256)
    }
  })
})

describe('aliases', () => {
  test('hyphenated aliases are allowed (parsed by our lenient parser, not registered)', () => {
    const spawnTeam = ALL_COMMANDS.find((c) => c.name === 'spawn_team')
    expect(spawnTeam?.aliases).toContain('spawn-team')
    // The alias itself must NOT appear in the setMyCommands list.
    expect(SERVICE_COMMANDS.some((c) => c.name === 'spawn-team')).toBe(false)
  })
})
