// `/spawn-team` — spawn a reusable Team Template at once.
//
// Call shapes:
//   /spawn-team                         — inline keyboard of Team Templates.
//   /spawn-team <template>              — spawn into the default team.
//   /spawn-team <template> in <team>    — spawn into a named team (created if
//                                         the slug doesn't exist yet).
//
// Reuses the daemon's transactional spawnTeamTemplate, then auto-binds a forum
// topic for each created agent (same per-supergroup outbound queue as /spawn).

import type { InlineKeyboardButton, InlineKeyboardMarkup } from 'grammy/types'
import { spawnTeamTemplate, teamTemplateRepo } from '../../../core/index.ts'
import { notifyDirectoryDirty } from '../directory.ts'
import { htmlEscape } from '../html.ts'
import { ensureAgentTopic } from '../topic-autocreate.ts'
import type { CommandCtx, CommandHandler, CommandResult } from './types.ts'

/** Callback_data prefix for template-pick buttons. Parsed by routing.ts. */
export const SPAWN_TEAM_CALLBACK_PREFIX = 'spawn:team:'

export const handle: CommandHandler = async (ctx) => {
  let args = ctx.args.trim()
  if (!args) return renderTeamPicker(ctx)

  // Optional trailing ` in <team-slug>`. spawnTeamTemplate validates the slug and
  // creates the Team when it doesn't exist yet.
  let teamSlug: string | null = null
  const inMatch = args.match(/\s+in\s+(\S+)$/i)
  if (inMatch) {
    teamSlug = inMatch[1] ?? null
    args = args.slice(0, inMatch.index).trim()
  }

  const template = teamTemplateRepo.get(ctx.db, args)
  if (!template) {
    return {
      text:
        `No Team Template named <code>${htmlEscape(args)}</code>.\n` +
        'Run <code>/spawn-team</code> (no args) to see the picker.',
      parseMode: 'HTML',
    }
  }
  return await spawnTeamAndBind(ctx, template.id, teamSlug)
}

function renderTeamPicker(ctx: CommandCtx): CommandResult {
  const eligible = teamTemplateRepo
    .list(ctx.db)
    .map((template) => ({ ...template, memberCount: template.slots.length }))
    .filter((template) => template.memberCount > 0)
  if (eligible.length === 0) {
    return {
      text: 'No Team Templates with members yet. Build one in the web UI (/templates/teams) first.',
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
  return { text: 'Pick a Team Template to spawn:', parseMode: 'HTML', replyMarkup }
}

/**
 * Spawn the template + auto-bind a topic per created agent. Shared by the
 * typed form and the keyboard callback (routing.ts). Returns the reply.
 */
export async function spawnTeamAndBind(
  ctx: Pick<CommandCtx, 'db' | 'paths' | 'api' | 'chatId'>,
  templateId: string,
  teamSlug: string | null,
): Promise<CommandResult> {
  let result: ReturnType<typeof spawnTeamTemplate>
  try {
    result = spawnTeamTemplate(ctx.db, ctx.paths, { templateId, teamId: teamSlug ?? 'default' })
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
    text: `Spawned ${result.agents.length} agent${result.agents.length === 1 ? '' : 's'} into <code>${htmlEscape(result.team.teamId)}</code>: ${names}.`,
    parseMode: 'HTML',
    disableWebPagePreview: true,
    ...(buttons.length > 0 ? { replyMarkup: { inline_keyboard: buttons.map((b) => [b]) } } : {}),
  }
}
