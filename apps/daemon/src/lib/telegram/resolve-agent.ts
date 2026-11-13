// Resolve the agent reference `/talk` and `/rebind` take: a bare name ("researcher") or a
// team-qualified one ("home-reno/researcher").

import type { Agent } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo } from '../../core/index.ts'
import type { CommandResult } from './commands/types.ts'
import { htmlEscape } from './html.ts'

export type AgentResolution =
  | { kind: 'ok'; agent: Agent }
  | { kind: 'ambiguous'; matches: Agent[] }
  | { kind: 'not-found' }
  | { kind: 'bad-input'; message: string }

export interface ParsedRef {
  /** Team slug when the reference was qualified, else null. */
  teamId: string | null
  /** Agent name portion of the reference. */
  name: string
}

/**
 * Parse a raw `/talk` argument into `{ teamId, name }`. Returns null for
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
    return { teamId: null, name: unquoted }
  }
  const teamId = unquoted.slice(0, slashIdx).trim()
  const name = unquoted.slice(slashIdx + 1).trim()
  if (!teamId || !name) return null
  return { teamId, name }
}

/**
 * Resolve a parsed reference against the database. The caller has already
 * parsed (or knows the input was empty); this just runs the DB lookup.
 */
export function resolveAgentRef(db: BazilionDb, ref: ParsedRef): AgentResolution {
  if (ref.teamId !== null) {
    const found = agentRepo.findByNameInTeam(db, ref.teamId, ref.name)
    return found ? { kind: 'ok', agent: found } : { kind: 'not-found' }
  }
  // Bare name — may match multiple agents across teams.
  const matches = agentRepo.findByName(db, ref.name)
  const [only] = matches
  if (!only) return { kind: 'not-found' }
  if (matches.length === 1) return { kind: 'ok', agent: only }
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
      message: 'Usage: /talk <agent> — or /talk <team>/<agent> when ambiguous.',
    }
  }
  return resolveAgentRef(db, parsed)
}

/** The agent a command argument names, or the reply explaining why it names none. */
export function resolveAgentArg(
  db: BazilionDb,
  raw: string,
  command: string,
): { agent: Agent } | { reply: CommandResult } {
  const resolution = parseAndResolveAgent(db, raw)
  const ref = htmlEscape(raw.trim())
  switch (resolution.kind) {
    case 'ok':
      return { agent: resolution.agent }
    case 'bad-input':
      return { reply: { text: htmlEscape(resolution.message), parseMode: 'HTML' } }
    case 'not-found':
      return {
        reply: {
          text: `No agent matches <code>${ref}</code>. Try /list to see available agents, or /spawn to create one.`,
          parseMode: 'HTML',
        },
      }
    case 'ambiguous':
      return {
        reply: {
          text: [
            `Multiple agents match <code>${ref}</code>:`,
            ...resolution.matches.map(
              (a) => `  • <code>${htmlEscape(a.teamId)}/${htmlEscape(a.name)}</code>`,
            ),
            '',
            `Use <code>/${command} &lt;team&gt;/&lt;agent&gt;</code> to disambiguate.`,
          ].join('\n'),
          parseMode: 'HTML',
        },
      }
  }
}
