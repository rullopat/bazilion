// `/help`: the command reference. Inside an Agent topic it leads with the topic commands.

import { htmlEscape } from '../html.ts'
import type { CommandHandler } from './types.ts'

const TOPIC_COMMANDS = [
  '/queue — List waiting messages; /queue drop &lt;n|all&gt; removes them',
  '/stop — Pause the queue and cancel the running turn',
  '/resume — Resume the queue',
  '/close — Close this topic (the agent stays bound)',
  '/rebind &lt;agent&gt; — Point this topic at a different agent',
  '/unbind — Clear the binding (the topic becomes an orphan)',
]

const SERVICE_BODY = [
  '<b>bazilion · service topic commands</b>',
  '',
  '/talk &lt;agent&gt; — Open or create the forum topic for an agent',
  '/spawn — Create a new agent from a profile (interactive)',
  '/spawn &lt;profile&gt; [&lt;name&gt;] [in &lt;team&gt;] — Create with typed args (<code>-</code> for auto-name)',
  '/spawn_team &lt;template&gt; [in &lt;team&gt;] — Spawn a whole team template',
  '/list — Show all agents (alias: /agents)',
  '/teams — Show bazilion teams',
  '/health — Bot identity + polling state',
  '/whoami — Show your Telegram user id',
  '/allowed — List allowlisted users',
  '/allow &lt;user_id&gt; [label] — Allow a user (owner only)',
  '/deny &lt;user_id&gt; — Remove a user from the allowlist (owner only)',
  '/help — This message',
  '',
  '<b>Inside an agent topic:</b>',
  ...TOPIC_COMMANDS,
].join('\n')

function topicBody(agentName: string, teamId: string): string {
  return [
    `<b>You're in <code>${htmlEscape(agentName)}</code>'s topic</b> (team <code>${htmlEscape(teamId)}</code>)`,
    'Messages here go to the agent, one turn at a time.',
    '',
    ...TOPIC_COMMANDS,
    '/help — This message',
    '',
    '<b>From the ⚙ bazilion service topic:</b>',
    '/talk, /spawn, /list, /teams, /health, /whoami',
  ].join('\n')
}

export const handle: CommandHandler = async (ctx) => {
  if (ctx.agent) {
    return { text: topicBody(ctx.agent.name, ctx.agent.teamId), parseMode: 'HTML' }
  }
  return { text: SERVICE_BODY, parseMode: 'HTML' }
}
