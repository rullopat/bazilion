// `/spawn` — create a new agent from a profile.
//
// Three call shapes:
//
//   /spawn                       — render an inline keyboard of profiles;
//                                  user taps one → callback_query handler
//                                  prompts for a name → next message completes.
//   /spawn <profile-id>          — store pending state, prompt for a name.
//   /spawn <profile-id> <name>   — spawn immediately. `<name>` may be `-` to
//                                  auto-name as `<profile-id>-<N>`.
//
// Any typed form may end with ` in <group-slug>` to target a non-default
// group (Phase 6). The keyboard flow stays default-only by design.

import type { Profile } from '@bazilion/api-types'
import type { InlineKeyboardMarkup } from 'grammy/types'
import { spawnAgent } from '../../../core/agent/spawn.ts'
import { agentRepo, groupRepo, profileRepo } from '../../../core/index.ts'
import { notifyDirectoryDirty } from '../directory.ts'
import { htmlEscape } from '../html.ts'
import { setPendingSpawn } from '../spawn-state.ts'
import { ensureAgentTopic } from '../topic-autocreate.ts'
import type { CommandCtx, CommandHandler, CommandResult } from './types.ts'

/** Callback_data prefix for profile-pick buttons. Parsed by routing.ts. */
export const SPAWN_PROFILE_CALLBACK_PREFIX = 'spawn:profile:'

/** Buttons per row in the profile picker. */
const PICKER_COLUMNS = 2

export const handle: CommandHandler = async (ctx) => {
  let args = ctx.args.trim()

  // Form 1: no args → keyboard picker.
  if (!args) return renderProfilePicker(ctx)

  // Pull an optional trailing ` in <group-slug>` (Phase 6 cross-group spawn).
  let groupSlug: string | null = null
  const inMatch = args.match(/\s+in\s+(\S+)$/i)
  if (inMatch) {
    groupSlug = inMatch[1] ?? null
    args = args.slice(0, inMatch.index).trim()
  }

  // Validate the target group up-front so the error is clear.
  if (groupSlug && !groupRepo.get(ctx.db, groupSlug, ctx.paths)) {
    return {
      text:
        `No group named <code>${htmlEscape(groupSlug)}</code>.\n` +
        'Run <code>/groups</code> to see the list.',
      parseMode: 'HTML',
    }
  }

  // Tokenize: first token is the profile id, the rest (joined back with
  // single spaces) is the optional name. Greedy-after-first.
  const firstSpace = args.indexOf(' ')
  const profileIdArg = firstSpace === -1 ? args : args.slice(0, firstSpace)
  const nameArg = firstSpace === -1 ? null : args.slice(firstSpace + 1).trim()

  const profile = profileRepo.get(ctx.db, profileIdArg)
  if (!profile) {
    return {
      text:
        `No profile named <code>${htmlEscape(profileIdArg)}</code>.\n` +
        'Run <code>/spawn</code> (no args) to see the picker.',
      parseMode: 'HTML',
    }
  }

  // Form 2: profile only → store pending state, prompt for name. (Cross-group
  // is only available on the immediate-spawn forms; the keyboard/name flow is
  // default-only, so a bare `/spawn <profile> in <group>` still spawns now.)
  if (!nameArg && !groupSlug) {
    setPendingSpawn(ctx.chatId, ctx.from.id, profile.id)
    return {
      text: namePrompt(profile),
      parseMode: 'HTML',
    }
  }

  // Form 3: profile + name (and/or group) → spawn immediately. A `-` name (or
  // a missing name with an explicit group) auto-names.
  return await spawnAndBind(ctx, profile, nameArg ?? '-', groupSlug)
}

/**
 * Build the profile-picker reply: a single message with an inline keyboard.
 * Each button's callback_data is `spawn:profile:<id>` — routing.ts parses
 * the prefix and dispatches to the callback handler.
 */
function renderProfilePicker(ctx: CommandCtx): CommandResult {
  const profiles = profileRepo.list(ctx.db)
  if (profiles.length === 0) {
    return {
      text: 'No profiles registered yet. Create one with <code>bazilion profile create</code> first.',
      parseMode: 'HTML',
    }
  }

  const buttons = profiles.map((p) => ({
    text: p.name,
    callback_data: `${SPAWN_PROFILE_CALLBACK_PREFIX}${p.id}`,
  }))
  const rows: (typeof buttons)[] = []
  for (let i = 0; i < buttons.length; i += PICKER_COLUMNS) {
    rows.push(buttons.slice(i, i + PICKER_COLUMNS))
  }
  const replyMarkup: InlineKeyboardMarkup = { inline_keyboard: rows }

  return {
    text: 'Pick a profile for the new agent:',
    parseMode: 'HTML',
    replyMarkup,
  }
}

/** Prompt text rendered after a profile is chosen (typed or tapped). */
export function namePrompt(profile: Profile): string {
  return (
    `Profile selected: <code>${htmlEscape(profile.id)}</code> · ${htmlEscape(profile.name)}\n` +
    'Reply with a name for the new agent, or <code>-</code> to auto-name.'
  )
}

/**
 * Spawn the agent + auto-bind its forum topic. Shared by the typed two-arg
 * form and the keyboard flow's name-input completion (called from
 * routing.ts:resumePendingSpawn). Returns the CommandResult the caller
 * should send back to Telegram.
 */
export async function spawnAndBind(
  ctx: Pick<CommandCtx, 'db' | 'paths' | 'api' | 'chatId'>,
  profile: Profile,
  rawName: string,
  groupSlug: string | null = null,
): Promise<CommandResult> {
  const requestedName = rawName === '-' ? autoName(ctx, profile) : rawName

  let agent: Awaited<ReturnType<typeof spawnAgent>>
  try {
    agent = spawnAgent(ctx.db, ctx.paths, {
      profileId: profile.id,
      name: requestedName,
      // groupId omitted → spawnAgent falls back to 'default'.
      ...(groupSlug ? { groupId: groupSlug } : {}),
    })
  } catch (e) {
    return {
      text: `Failed to spawn: ${htmlEscape(e instanceof Error ? e.message : String(e))}`,
      parseMode: 'HTML',
    }
  }
  // Refresh the directory even if topic auto-create fails below — the new
  // agent should still appear as `(unbound)`. coalescing makes the second
  // notify (after ensureAgentTopic binds) a no-op.
  notifyDirectoryDirty()

  const ensured = await ensureAgentTopic({
    db: ctx.db,
    paths: ctx.paths,
    api: ctx.api,
    chatId: ctx.chatId,
    agentId: agent.id,
  })

  if (ensured.kind !== 'ok') {
    // Spawn succeeded but topic create failed — the agent exists, the
    // operator can /talk to it from the web UI to retry binding. Tell them.
    return {
      text:
        `Spawned <code>${htmlEscape(agent.name)}</code>, but topic auto-create failed (${ensured.kind}).\n` +
        `Run <code>/talk ${htmlEscape(agent.name)}</code> after fixing the underlying issue.`,
      parseMode: 'HTML',
    }
  }

  return {
    text: `Spawned <code>${htmlEscape(agent.name)}</code> from profile <code>${htmlEscape(profile.id)}</code>.`,
    parseMode: 'HTML',
    disableWebPagePreview: true,
    replyMarkup: {
      inline_keyboard: [[{ text: 'Open topic →', url: ensured.deepLink }]],
    },
  }
}

/**
 * Auto-name format: `<profile-id>-<count>` where `count` is the next integer
 * after the existing agent count for this profile. Stable + greppable; the
 * doc earmarks alternative formats (adjective+noun) as a future polish.
 */
function autoName(ctx: Pick<CommandCtx, 'db'>, profile: Profile): string {
  const count = agentRepo.countByProfile(ctx.db, profile.id)
  return `${profile.id}-${count + 1}`
}
