// Service-chat command registry + dispatcher.
//
// Commands listed in `SERVICE_COMMANDS` get registered in Telegram's slash
// menu via `setMyCommands` at activation. Aliases route to the same handler
// but stay hidden from the menu.

import { handle as handleGroups } from './groups.ts'
import { handle as handleHealth } from './health.ts'
import { handle as handleHelp } from './help.ts'
import { handle as handleList } from './list.ts'
import { handle as handleTalk } from './talk.ts'
import type { CommandCtx, CommandDescriptor, CommandResult } from './types.ts'
import { handle as handleWhoami } from './whoami.ts'

export const SERVICE_COMMANDS: readonly CommandDescriptor[] = [
  {
    name: 'talk',
    description: 'Open or create the topic for an agent',
    handle: handleTalk,
  },
  {
    name: 'list',
    description: 'Show all agents grouped by bazilion group',
    handle: handleList,
    aliases: ['agents'],
  },
  {
    name: 'groups',
    description: 'Show bazilion groups with agent counts',
    handle: handleGroups,
  },
  {
    name: 'health',
    description: 'Bot identity + polling state',
    handle: handleHealth,
  },
  {
    name: 'whoami',
    description: 'Show your Telegram user id',
    handle: handleWhoami,
  },
  {
    name: 'help',
    description: 'Command reference',
    handle: handleHelp,
  },
]

const HANDLER_BY_NAME: Map<string, CommandDescriptor> = (() => {
  const m = new Map<string, CommandDescriptor>()
  for (const d of SERVICE_COMMANDS) {
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

export async function dispatchCommand(
  parsed: ParsedCommand,
  ctx: Omit<CommandCtx, 'args'>,
): Promise<CommandResult | { unknown: true; name: string }> {
  const desc = HANDLER_BY_NAME.get(parsed.name)
  if (!desc) return { unknown: true, name: parsed.name }
  return desc.handle({ ...ctx, args: parsed.args })
}

export type { CommandCtx, CommandResult } from './types.ts'
