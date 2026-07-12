// `/help` — command reference. Context-aware: when invoked inside a bound
// agent topic, the body opens with a "You're in <agent>'s topic" header
// and surfaces the topic-context commands first; in the service chat it
// shows the regular service-chat reference.

import { htmlEscape } from '../html.ts'
import type { CommandHandler } from './types.ts'

const SERVICE_BODY = [
  '<b>bazilion · service chat commands</b>',
  '',
  '<b>Available now:</b>',
  '/talk &lt;agent&gt; — Open or create the forum topic for an agent',
  '/spawn — Create a new agent from a profile (interactive)',
  '/spawn &lt;profile&gt; [&lt;name&gt;] [in &lt;team&gt;] — Create with typed args (<code>-</code> for auto-name)',
  '/spawn_team &lt;profile-team&gt; [in &lt;team&gt;] — Spawn a whole team template',
  '/list — Show all agents (alias: /agents)',
  '/teams — Show bazilion teams',
  '/health — Bot identity + polling state',
  '/whoami — Show your Telegram user id',
  '/allowed — List allowlisted users',
  '/allow &lt;user_id&gt; [label] — Allow a user (owner only)',
  '/deny &lt;user_id&gt; — Remove a user from the allowlist (owner only)',
  '/help — This message',
  '',
  '<b>Topic-context commands</b> (run inside an agent topic):',
  '/close — Close this topic (preserves the binding)',
  '/rebind &lt;agent&gt; — Point this topic at a different agent',
  '/unbind — Clear the binding (topic becomes orphan)',
].join('\n')

function topicBody(agentName: string, teamId: string): string {
  return [
    `<b>You're in <code>${htmlEscape(agentName)}</code>'s topic</b> (team <code>${htmlEscape(teamId)}</code>)`,
    '',
    '<b>Topic-context commands:</b>',
    '/close — Close this topic (preserves the binding)',
    '/rebind &lt;agent&gt; — Point this topic at a different agent',
    '/unbind — Clear the binding (topic becomes orphan)',
    '/help — This message',
    '',
    '<b>From the ⚙ bazilion service chat:</b>',
    '/talk, /spawn, /list, /teams, /health, /whoami',
  ].join('\n')
}

export const handle: CommandHandler = async (ctx) => {
  if (ctx.agent) {
    return { text: topicBody(ctx.agent.name, ctx.agent.teamId), parseMode: 'HTML' }
  }
  return { text: SERVICE_BODY, parseMode: 'HTML' }
}
