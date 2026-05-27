// Parse the agent reference users pass to `/talk` (and future `/rebind`,
// `/adopt`, ...). Three forms:
//
//   bare         "/talk researcher"               — agent name only
//   qualified    "/talk home-reno/researcher"     — group/agent qualifier
//   quoted       "/talk \"Patrizio's Coder\""      — agent name with spaces
//
// Resolution outcomes:
//
//   ok           — exactly one matching agent
//   ambiguous    — multiple agents share the bare name across groups
//   not-found    — no matching agent
//   bad-input    — empty / malformed reference (e.g. "/" with no parts)
//
// The caller renders an appropriate Telegram reply for each. Step 3 ships
// the bare + qualified parsers; quoted-with-spaces is a doc-listed nicety
// we defer until anyone actually needs it.

import type { Agent } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo } from '../../core/index.ts'

export type AgentResolution =
  | { kind: 'ok'; agent: Agent }
  | { kind: 'ambiguous'; matches: Agent[] }
  | { kind: 'not-found' }
  | { kind: 'bad-input'; message: string }

export interface ParsedRef {
  /** Group slug when the reference was qualified, else null. */
  groupId: string | null
  /** Agent name portion of the reference. */
  name: string
}

/**
 * Parse a raw `/talk` argument into `{ groupId, name }`. Returns null for
 * obviously malformed input (empty, slash-only, etc.) so the caller can
 * render a "bad input" reply.
 */
export function parseAgentRef(raw: string): ParsedRef | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Strip surrounding double-quotes if the user wrapped a name with spaces.
  const unquoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed
  if (!unquoted) return null

  const slashIdx = unquoted.indexOf('/')
  if (slashIdx < 0) {
    // bare name
    return { groupId: null, name: unquoted }
  }
  const groupId = unquoted.slice(0, slashIdx).trim()
  const name = unquoted.slice(slashIdx + 1).trim()
  if (!groupId || !name) return null
  return { groupId, name }
}

/**
 * Resolve a parsed reference against the database. The caller has already
 * parsed (or knows the input was empty); this just runs the DB lookup.
 */
export function resolveAgentRef(db: BazilionDb, ref: ParsedRef): AgentResolution {
  if (ref.groupId !== null) {
    const found = agentRepo.findByNameInGroup(db, ref.groupId, ref.name)
    return found ? { kind: 'ok', agent: found } : { kind: 'not-found' }
  }
  // Bare name — may match multiple agents across groups.
  const matches = agentRepo.findByName(db, ref.name)
  if (matches.length === 0) return { kind: 'not-found' }
  if (matches.length === 1) return { kind: 'ok', agent: matches[0]! }
  return { kind: 'ambiguous', matches }
}

/**
 * End-to-end convenience: parse and resolve in one call. Returns a single
 * AgentResolution covering parse errors and lookup outcomes alike.
 */
export function parseAndResolveAgent(db: BazilionDb, raw: string): AgentResolution {
  const parsed = parseAgentRef(raw)
  if (!parsed) {
    return {
      kind: 'bad-input',
      message: 'Usage: /talk <agent> — or /talk <group>/<agent> when ambiguous.',
    }
  }
  return resolveAgentRef(db, parsed)
}
