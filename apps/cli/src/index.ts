import { defineCommand, runCommand, showUsage } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import { agentCommand } from './commands/agent.ts'
import { attentionCommand } from './commands/attention.ts'
import { authCommand } from './commands/auth.ts'
import { backupCommand } from './commands/backup.ts'
import { completionCommand } from './commands/completion.ts'
import { configCommand } from './commands/config.ts'
import { conversationCommand } from './commands/conversation.ts'
import { dashboardCommand } from './commands/dashboard.ts'
import { doctorCommand } from './commands/doctor.ts'
import { inboxCommand } from './commands/inbox.ts'
import { loginCommand } from './commands/login.ts'
import { mcpCommand } from './commands/mcp.ts'
import { memoryCommand } from './commands/memory.ts'
import { notificationCommand } from './commands/notification.ts'
import { profileCommand } from './commands/profile.ts'
import { providerCommand } from './commands/provider.ts'
import { questionCommand } from './commands/question.ts'
import { queueCommand } from './commands/queue.ts'
import { resultCommand } from './commands/result.ts'
import { sendCommand } from './commands/send.ts'
import { serveCommand } from './commands/serve.ts'
import { sessionCommand } from './commands/session.ts'
import { skillCommand } from './commands/skill.ts'
import { teamCommand } from './commands/team.ts'
import { teamTemplateCommand } from './commands/team-template.ts'
import { telegramCommand } from './commands/telegram.ts'
import { tokenCommand } from './commands/token.ts'
import { triggerCommand } from './commands/trigger.ts'
import { uninstallCommand } from './commands/uninstall.ts'
import { exitCodeForError, printError } from './errors.ts'

const VERSION = pkg.version

const main = defineCommand({
  meta: {
    name: 'bazilion',
    version: VERSION,
    description: 'Multi-agent runtime',
  },
  subCommands: {
    login: loginCommand,
    profile: profileCommand,
    team: teamCommand,
    'team-template': teamTemplateCommand,
    agent: agentCommand,
    attention: attentionCommand,
    result: resultCommand,
    conversation: conversationCommand,
    queue: queueCommand,
    question: questionCommand,
    notification: notificationCommand,
    skill: skillCommand,
    memory: memoryCommand,
    mcp: mcpCommand,
    provider: providerCommand,
    send: sendCommand,
    session: sessionCommand,
    inbox: inboxCommand,
    config: configCommand,
    serve: serveCommand,
    dashboard: dashboardCommand,
    doctor: doctorCommand,
    backup: backupCommand,
    trigger: triggerCommand,
    token: tokenCommand,
    auth: authCommand,
    telegram: telegramCommand,
    uninstall: uninstallCommand,
  },
})

// Mutate the command tree after definition so `completion` can introspect its
// own siblings without a circular import. Cast is safe — citty keeps the
// object reference on `main` after defineCommand, and we know its shape.
;(main.subCommands as Record<string, unknown>).completion = completionCommand(main as never)

// Resolve `bazilion <a> <b> --help` to the right subcommand for showUsage.
// citty's built-in version is private, so we re-implement it for plain
// subCommands objects (the shape we use throughout the tree).
type AnyCmd = Parameters<typeof showUsage>[0]
type CmdWithSubs = AnyCmd & { subCommands?: Record<string, AnyCmd> }
async function resolveSubCommand(
  cmd: CmdWithSubs,
  rawArgs: string[],
  parent?: AnyCmd,
): Promise<[AnyCmd, AnyCmd | undefined]> {
  const subs = cmd.subCommands
  if (subs && Object.keys(subs).length > 0) {
    const idx = rawArgs.findIndex((a) => !a.startsWith('-'))
    const name = idx >= 0 ? rawArgs[idx] : undefined
    if (name && subs[name]) {
      return resolveSubCommand(subs[name] as CmdWithSubs, rawArgs.slice(idx + 1), cmd)
    }
  }
  return [cmd, parent]
}

// Top-level `bazilion --help` groups the commands by their own descriptions; `bazilion <command>
// --help` uses citty's renderer. A command missing from these groups is listed under "other".
const HELP_GROUPS: Record<string, string[]> = {
  setup: ['serve', 'dashboard', 'doctor', 'backup', 'uninstall'],
  catalog: ['profile', 'team-template', 'team', 'skill', 'provider', 'config', 'auth', 'mcp'],
  agents: [
    'attention',
    'agent',
    'conversation',
    'result',
    'queue',
    'question',
    'memory',
    'send',
    'inbox',
    'trigger',
  ],
  integrations: ['telegram', 'notification'],
  remote: ['login', 'token', 'session'],
  shell: ['completion'],
}

function printTopLevelHelp(): void {
  const commands = main.subCommands as Record<string, { meta?: { description?: string } }>
  const grouped = new Set(Object.values(HELP_GROUPS).flat())
  const other = Object.keys(commands).filter((name) => !grouped.has(name))
  console.log(`Multi-agent runtime (bazilion v${VERSION})`)
  console.log('')
  console.log('USAGE bazilion <command> [args]')
  console.log('')
  for (const [title, names] of Object.entries({ ...HELP_GROUPS, other })) {
    const listed = names.filter((name) => commands[name])
    if (listed.length === 0) continue
    console.log(`  ${title}`)
    for (const name of listed) {
      console.log(`    ${name.padEnd(15)}${commands[name]?.meta?.description ?? ''}`)
    }
    console.log('')
  }
  console.log('Use `bazilion <command> --help` for more information about a command.')
}

async function entry(): Promise<void> {
  // package.json `engines` is the Node contract; this only turns another Node into a clear message.
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split('.').map(Number)
  if (major !== 26 || minor < 12 || (minor === 12 && patch < 1)) {
    console.error(`bazilion requires Node.js ^26.12.1; this is ${process.versions.node}.`)
    process.exit(1)
  }
  const rawArgs = process.argv.slice(2)
  try {
    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
      // For the top-level `bazilion --help`, render our grouped layout.
      // Subcommand help still goes through citty (preserves native formatting).
      const firstPositional = rawArgs.find((a) => !a.startsWith('-'))
      if (!firstPositional) {
        printTopLevelHelp()
        process.exit(0)
      }
      const [target, parent] = await resolveSubCommand(main as CmdWithSubs, rawArgs)
      await showUsage(target, parent)
      process.exit(0)
    }
    if (rawArgs.length === 1 && (rawArgs[0] === '--version' || rawArgs[0] === '-v')) {
      console.log(VERSION)
      return
    }
    await runCommand(main, { rawArgs })
  } catch (err) {
    printError(err)
    process.exit(exitCodeForError(err))
  }
}

entry()
