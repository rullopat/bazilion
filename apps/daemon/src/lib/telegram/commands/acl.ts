// `/allow`, `/deny`, `/allowed` — manage the per-user allowlist from Telegram
// (Phase 7). /allow and /deny require the caller to be an owner; /allowed (the
// listing) is available to any allowlisted user. User ids come from /whoami —
// username resolution isn't available (Telegram doesn't expose a username→id
// lookup to bots), so these take numeric ids.

import { telegramAclRepo } from '../../../core/index.ts'
import { htmlEscape } from '../html.ts'
import type { CommandCtx, CommandHandler } from './types.ts'

function isOwner(ctx: CommandCtx): boolean {
  return telegramAclRepo.get(ctx.db, ctx.from.id)?.role === 'owner'
}

const OWNER_ONLY = {
  text: 'Only an owner can manage the allowlist.',
  parseMode: 'HTML' as const,
}

export const handleAllow: CommandHandler = async (ctx) => {
  if (!isOwner(ctx)) return OWNER_ONLY
  const parts = ctx.args.trim().split(/\s+/).filter(Boolean)
  const userId = Number(parts[0])
  if (!Number.isInteger(userId)) {
    return {
      text: 'Usage: <code>/allow &lt;user_id&gt; [label]</code> — the user can get their id via /whoami.',
      parseMode: 'HTML',
    }
  }
  const label = parts.slice(1).join(' ') || null
  const u = telegramAclRepo.add(ctx.db, { userId, label, role: 'member' })
  return {
    text: `Allowed <code>${u.userId}</code>${u.label ? ` (${htmlEscape(u.label)})` : ''}.`,
    parseMode: 'HTML',
  }
}

export const handleDeny: CommandHandler = async (ctx) => {
  if (!isOwner(ctx)) return OWNER_ONLY
  const userId = Number(ctx.args.trim())
  if (!Number.isInteger(userId)) {
    return { text: 'Usage: <code>/deny &lt;user_id&gt;</code>.', parseMode: 'HTML' }
  }
  const ok = telegramAclRepo.remove(ctx.db, userId)
  return {
    text: ok
      ? `Removed <code>${userId}</code> from the allowlist.`
      : `Couldn't remove <code>${userId}</code> — unknown user, or it's the last owner.`,
    parseMode: 'HTML',
  }
}

export const handleAllowed: CommandHandler = async (ctx) => {
  const users = telegramAclRepo.list(ctx.db)
  if (users.length === 0) {
    return { text: 'Telegram is unpaired and closed. Generate an owner pairing code in Bazilion.' }
  }
  const lines = users.map((u) => {
    const who = u.label ? htmlEscape(u.label) : u.username ? `@${htmlEscape(u.username)}` : '—'
    return `<code>${u.userId}</code> · ${who} · ${u.role}`
  })
  return { text: ['<b>Allowlisted users</b>', ...lines].join('\n'), parseMode: 'HTML' }
}
