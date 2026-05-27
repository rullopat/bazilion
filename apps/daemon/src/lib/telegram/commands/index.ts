// Command registry + dispatcher.
//
// Two contexts:
//   - SERVICE commands (`context: 'service'` or omitted) run inside the
//     ⚙ bazilion topic and get registered in Telegram's slash menu via
//     setMyCommands.
//   - TOPIC commands (`context: 'topic'`) run inside bound agent topics
//     and stay hidden from the autocomplete menu — they're documented in
//     /help instead.
//   - `context: 'any'` commands are callable from both surfaces. /help is
//     the only one today; the topic-context branch enriches its output
//     using ctx.agent.

import { handle as handleClose } from './close.ts'
import { handle as handleGroups } from './groups.ts'
import { handle as handleHealth } from './health.ts'
import { handle as handleHelp } from './help.ts'
import { handle as handleList } from './list.ts'
import { handle as handleRebind } from './rebind.ts'
import { handle as handleSpawn } from './spawn.ts'
import { handle as handleTalk } from './talk.ts'
import type { CommandContext, CommandCtx, CommandDescriptor, CommandResult } from './types.ts'
import { handle as handleUnbind } from './unbind.ts'
import { handle as handleWhoami } from './whoami.ts'

/**
 * Every command the bot knows about, regardless of context. SERVICE_COMMANDS
 * is derived from this list for setMyCommands.
 */
export const ALL_COMMANDS: readonly CommandDescriptor[] = [
  // Service-chat surface — registered in the slash menu.
  { name: 'talk', description: 'Open or create the topic for an agent', handle: handleTalk },
  { name: 'spawn', description: 'Create a new agent from a profile', handle: handleSpawn },
  {
    name: 'list',
    description: 'Show all agents grouped by bazilion group',
    handle: handleList,
    aliases: ['agents'],
  },
  { name: 'groups', description: 'Show bazilion groups with agent counts', handle: handleGroups },
  { name: 'health', description: 'Bot identity + polling state', handle: handleHealth },
  { name: 'whoami', description: 'Show your Telegram user id', handle: handleWhoami },

  // Cross-context — /help works in either surface; the handler reads
  // ctx.agent to decide whether to render the topic-context section.
  { name: 'help', description: 'Command reference', handle: handleHelp, context: 'any' },

  // Topic-context surface — hidden from setMyCommands per doc decision.
  { name: 'close', description: 'Close this agent topic', handle: handleClose, context: 'topic' },
  {
    name: 'rebind',
    description: 'Bind this topic to a different agent',
    handle: handleRebind,
    context: 'topic',
  },
  {
    name: 'unbind',
    description: "Clear this topic's agent binding",
    handle: handleUnbind,
    context: 'topic',
  },
]

/** The subset registered with Telegram's slash menu — service + any. */
export const SERVICE_COMMANDS: readonly CommandDescriptor[] = ALL_COMMANDS.filter(
  (c) => contextOf(c) === 'service' || contextOf(c) === 'any',
)

function contextOf(d: CommandDescriptor): CommandContext {
  return d.context ?? 'service'
}

const HANDLER_BY_NAME: Map<string, CommandDescriptor> = (() => {
  const m = new Map<string, CommandDescriptor>()
  for (const d of ALL_COMMANDS) {
    m.set(d.name, d)
    for (const alias of d.aliases ?? []) m.set(alias, d)
  }
  return m
})()

export interface ParsedCommand {
  name: string
  args: string
}

/**
 * Pull `{name, args}` out of a message body if it starts with a slash command.
 * Returns null when the body doesn't look like a command (no leading slash,
 * mention-only, etc.). Strips `@botname` suffix Telegram adds when commands
 * are issued in groups (`/talk@bazilion_bot foo` → `{name: 'talk', args: 'foo'}`).
 */
export function parseCommand(text: string | undefined): ParsedCommand | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const spaceIdx = trimmed.indexOf(' ')
  const head = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim()
  const atIdx = head.indexOf('@')
  const name = (atIdx === -1 ? head : head.slice(0, atIdx)).toLowerCase()
  if (!name) return null
  return { name, args }
}

/**
 * Dispatch a parsed command. The `surface` arg constrains which commands
 * are accepted — a /close from the service chat returns `{unknown}`, and
 * a /spawn from an agent topic also returns `{unknown}`. /help and other
 * `context: 'any'` commands work in either.
 */
export async function dispatchCommand(
  parsed: ParsedCommand,
  ctx: Omit<CommandCtx, 'args'>,
  surface: 'service' | 'topic',
): Promise<CommandResult | { unknown: true; name: string }> {
  const desc = HANDLER_BY_NAME.get(parsed.name)
  if (!desc) return { unknown: true, name: parsed.name }
  const cmdContext = contextOf(desc)
  if (cmdContext !== 'any' && cmdContext !== surface) {
    return { unknown: true, name: parsed.name }
  }
  return desc.handle({ ...ctx, args: parsed.args })
}

export type { CommandCtx, CommandResult } from './types.ts'
