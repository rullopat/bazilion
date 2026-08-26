import { defineCommand, runCommand, showUsage } from 'citty'
import pkg from '../package.json' with { type: 'json' }
import { ApiClientError } from './client.ts'

const VERSION = pkg.version

import { agentCommand } from './commands/agent.ts'
import { approvalCommand } from './commands/approval.ts'
import { attentionCommand } from './commands/attention.ts'
import { authCommand } from './commands/auth.ts'
import { backupCommand } from './commands/backup.ts'
import { completionCommand } from './commands/completion.ts'
import { configCommand } from './commands/config.ts'
import { dashboardCommand } from './commands/dashboard.ts'
import { doctorCommand } from './commands/doctor.ts'
import { inboxCommand } from './commands/inbox.ts'
import { loginCommand } from './commands/login.ts'
import { mcpCommand } from './commands/mcp.ts'
import { memoryCommand } from './commands/memory.ts'
import { profileCommand } from './commands/profile.ts'
import { providerCommand } from './commands/provider.ts'
import { sendCommand } from './commands/send.ts'
import { serveCommand } from './commands/serve.ts'
import { skillCommand } from './commands/skill.ts'
import { teamCommand } from './commands/team.ts'
import { teamTemplateCommand } from './commands/team-template.ts'
import { telegramCommand } from './commands/telegram.ts'
import { tokenCommand } from './commands/token.ts'
import { triggerCommand } from './commands/trigger.ts'
import { uninstallCommand } from './commands/uninstall.ts'

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
    approval: approvalCommand,
    attention: attentionCommand,
    skill: skillCommand,
    memory: memoryCommand,
    mcp: mcpCommand,
    provider: providerCommand,
    send: sendCommand,
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

function printError(err: unknown): void {
  if (err instanceof ApiClientError) {
    console.error(`error: ${err.body.error}`)
    if (err.status === 401) {
      console.error('  hint: token mismatch. Check ~/.bazilion/auth.json "token"')
      console.error('        or re-run "bazilion login" for a remote server.')
    } else if (err.status === 403) {
      console.error('  hint: request was rejected by the server. If you hit this from a')
      console.error('        fresh CLI build, check that BAZILION_SERVER matches the')
      console.error('        server origin exactly (scheme + host + port).')
    }
    return
  }
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`error: ${msg}`)
  // Friendly hints for the most common connection failures. node's fetch
  // wraps the syscall error in err.cause.code, so we peek there too.
  const cause = err instanceof Error ? (err as { cause?: { code?: string } }).cause : undefined
  const code = cause?.code
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) {
    console.error('  hint: the bazilion server is not running. Start it with "bazilion serve"')
    console.error('        or point BAZILION_SERVER at a running instance.')
  } else if (code === 'ENOTFOUND' || /ENOTFOUND/.test(msg)) {
    console.error('  hint: host not found. Check BAZILION_SERVER / ~/.bazilion/auth.json.')
  }
}

function exitCodeForError(err: unknown): number {
  if (err instanceof ApiClientError) {
    if (err.status === 401 || err.status === 403) return 4
    if (err.status === 409) return 3
    if (err.status === 400 || err.status === 422) return 2
    return 1
  }
  const message = err instanceof Error ? err.message : String(err)
  return /invalid|unsupported|must be|require|refusing mutation|document belongs/.test(message)
    ? 2
    : 1
}

/**
 * Top-level `bazilion --help` renders a categorized layout instead of citty's
 * default `sub1|sub2|…` pipe-soup USAGE line. Subcommand `--help` still uses
 * citty's built-in renderer.
 */
function printTopLevelHelp(): void {
  console.log(`Multi-agent runtime (bazilion v${VERSION})`)
  console.log('')
  console.log('USAGE bazilion <command> [args]')
  console.log('')
  const teams: { title: string; items: [string, string][] }[] = [
    {
      title: 'setup',
      items: [
        ['serve', 'Start the bazilion daemon (auto-bootstraps ~/.bazilion on first run)'],
        ['dashboard', 'Start the daemon + bundled web UI, then open the dashboard'],
        ['doctor', 'Diagnose your bazilion install'],
        ['uninstall', 'Wipe bazilion state from ~/.bazilion (or BAZILION_HOME)'],
      ],
    },
    {
      title: 'catalog',
      items: [
        ['profile', 'Manage profiles (templates agents are spawned from)'],
        ['team-template', 'Inspect and exchange reusable Team Templates'],
        ['team', 'Manage teams (collaboration context — filesystem root + USER.md + roster)'],
        ['skill', 'Manage the skill library'],
        ['provider', 'Manage and test LLM providers'],
        ['config', 'Manage service config (credentials + URLs/IDs)'],
        ['auth', 'OAuth provider sign-in (ChatGPT account, …)'],
      ],
    },
    {
      title: 'agents',
      items: [
        ['approval', 'Review and decide communication approval attempts'],
        ['attention', 'See everything that needs operator attention'],
        ['agent', 'Spawn, list, chat, archive agents'],
        ['memory', "Read/write a team's shared memory"],
        ['send', 'Send a message from one agent to another'],
        ['inbox', 'Inspect agent inboxes'],
        ['trigger', 'Manage scheduled agent triggers'],
      ],
    },
    {
      title: 'integrations',
      items: [['telegram', 'Telegram bot setup, health, lifecycle']],
    },
    {
      title: 'ops',
      items: [['backup', 'Encrypted backup, restore, and credential recovery']],
    },
    {
      title: 'remote',
      items: [
        ['login', 'Save a remote bazilion server + token pair to auth.json'],
        ['token', 'Manage web tokens for API/CLI clients'],
      ],
    },
    {
      title: 'shell',
      items: [['completion', 'Print shell completion script (bash | zsh | fish)']],
    },
  ]
  const nameWidth = 15
  for (const g of teams) {
    console.log(`  ${g.title}`)
    for (const [name, desc] of g.items) {
      console.log(`    ${name.padEnd(nameWidth)}${desc}`)
    }
    console.log('')
  }
  console.log('Use `bazilion <command> --help` for more information about a command.')
}

async function entry(): Promise<void> {
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
