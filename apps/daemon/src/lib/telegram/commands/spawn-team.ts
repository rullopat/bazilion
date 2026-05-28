// `/spawn-team` — spawn a whole profile group (team template) at once.
//
// Call shapes:
//   /spawn-team                       — inline keyboard of profile groups.
//   /spawn-team <pg-id>               — spawn into the default group.
//   /spawn-team <pg-id> in <group>    — spawn into a named group (auto-created
//                                       if the slug doesn't exist).
//
// Reuses the daemon's transactional spawnProfileGroup, then auto-binds a forum
// topic for each created agent (same per-supergroup outbound queue as /spawn).

import type { InlineKeyboardButton, InlineKeyboardMarkup } from 'grammy/types'
import { profileGroupRepo, spawnProfileGroup } from '../../../core/index.ts'
import { notifyDirectoryDirty } from '../directory.ts'
import { htmlEscape } from '../html.ts'
import { ensureAgentTopic } from '../topic-autocreate.ts'
import type { CommandCtx, CommandHandler, CommandResult } from './types.ts'

/** Callback_data prefix for profile-group-pick buttons. Parsed by routing.ts. */
export const SPAWN_TEAM_CALLBACK_PREFIX = 'spawn:team:'

export const handle: CommandHandler = async (ctx) => {
  let args = ctx.args.trim()
  if (!args) return renderTeamPicker(ctx)

  // Optional trailing ` in <group-slug>` — the group is auto-created by
  // spawnProfileGroup if it doesn't exist, so we don't pre-validate it.
  let groupSlug: string | null = null
  const inMatch = args.match(/\s+in\s+(\S+)$/i)
  if (inMatch) {
    groupSlug = inMatch[1] ?? null
    args = args.slice(0, inMatch.index).trim()
  }

  const pg = profileGroupRepo.get(ctx.db, args)
  if (!pg) {
    return {
      text:
        `No profile group named <code>${htmlEscape(args)}</code>.\n` +
        'Run <code>/spawn-team</code> (no args) to see the picker.',
      parseMode: 'HTML',
    }
  }
  return await spawnTeamAndBind(ctx, pg.id, groupSlug)
}

function renderTeamPicker(ctx: CommandCtx): CommandResult {
  const eligible = profileGroupRepo.list(ctx.db).filter((g) => g.memberCount > 0)
  if (eligible.length === 0) {
    return {
      text: 'No profile groups with members yet. Build one in the web UI (/profile-groups) first.',
      parseMode: 'HTML',
    }
  }
  const rows = eligible.map((g) => [
    {
      text: `${g.name} (${g.memberCount} member${g.memberCount === 1 ? '' : 's'})`,
      callback_data: `${SPAWN_TEAM_CALLBACK_PREFIX}${g.id}`,
    },
  ])
  const replyMarkup: InlineKeyboardMarkup = { inline_keyboard: rows }
  return { text: 'Pick a profile group to spawn as a team:', parseMode: 'HTML', replyMarkup }
}

/**
 * Spawn the profile group + auto-bind a topic per created agent. Shared by the
 * typed form and the keyboard callback (routing.ts). Returns the reply.
 */
export async function spawnTeamAndBind(
  ctx: Pick<CommandCtx, 'db' | 'paths' | 'api' | 'chatId'>,
  profileGroupId: string,
  groupSlug: string | null,
): Promise<CommandResult> {
  let result: Awaited<ReturnType<typeof spawnProfileGroup>>
  try {
    result = await spawnProfileGroup(ctx.db, ctx.paths, {
      profileGroupId,
      ...(groupSlug ? { groupSlug } : {}),
    })
  } catch (e) {
    return {
      text: `Failed to spawn team: ${htmlEscape(e instanceof Error ? e.message : String(e))}`,
      parseMode: 'HTML',
    }
  }

  // New agents should appear in the directory even if topic binding fails.
  notifyDirectoryDirty()

  const buttons: InlineKeyboardButton[] = []
  for (const a of result.agents) {
    const ensured = await ensureAgentTopic({
      db: ctx.db,
      paths: ctx.paths,
      api: ctx.api,
      chatId: ctx.chatId,
      agentId: a.id,
    })
    if (ensured.kind === 'ok') buttons.push({ text: a.name, url: ensured.deepLink })
  }
  notifyDirectoryDirty()

  const names = result.agents.map((a) => htmlEscape(a.name)).join(', ')
  return {
    text: `Spawned ${result.agents.length} agent${result.agents.length === 1 ? '' : 's'} into <code>${htmlEscape(result.groupSlug)}</code>: ${names}.`,
    parseMode: 'HTML',
    disableWebPagePreview: true,
    ...(buttons.length > 0 ? { replyMarkup: { inline_keyboard: buttons.map((b) => [b]) } } : {}),
  }
}
