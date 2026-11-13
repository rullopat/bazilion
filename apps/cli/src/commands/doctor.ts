import type { HealthReport } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

export const doctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Diagnose your bazilion install' },
  async run() {
    const r = await createClient().get<HealthReport>('/api/health/details')
    const check = (label: string, condition: boolean, hint?: string) =>
      console.log(checkLine(label, condition, hint))

    console.log(`bazilion home: ${r.home}`)
    console.log()
    console.log('paths')
    check('home dir exists', r.paths.home)
    check('database exists', r.paths.db, 'run: bazilion serve (auto-bootstraps on first run)')
    check('auth.json exists', r.paths.auth, 'run: bazilion serve (auto-bootstraps on first run)')
    check('profiles dir exists', r.paths.profiles)
    check('agents dir exists', r.paths.agents)
    check('skills dir exists', r.paths.skills)

    if (r.database) {
      console.log()
      console.log('database')
      if (r.database.ok) {
        console.log(`  ${r.database.profiles} profile(s)`)
        console.log(
          `  ${r.database.activeAgents} active agent(s) (${r.database.totalAgents} total)`,
        )
        console.log(`  ${r.database.teams} team(s)`)
      } else {
        check('open database', false, r.database.error)
      }
    }

    console.log()
    console.log('skills library')
    console.log(`  ${r.skills.installed} skill(s) installed`)
    if (r.skills.parseErrors > 0) {
      check('all skills parse', false, `${r.skills.parseErrors} skill(s) have errors`)
    }

    console.log()
    console.log('providers (enable one and save at least one model for chat)')
    if (r.providers.configured.length === 0) {
      console.log('  - no cloud providers configured')
      console.log('    (set e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY)')
    } else {
      for (const name of r.providers.configured) {
        console.log(`  ✓ ${name}`)
      }
    }
    console.log(
      `  ✓ lmstudio: ${
        r.providers.lmstudio.customEndpointConfigured
          ? 'custom endpoint configured'
          : 'default local endpoint'
      }${r.providers.lmstudio.keyConfigured ? ' (API key configured)' : ''}`,
    )
    console.log(
      `  ✓ ollama:   ${
        r.providers.ollama.customEndpointConfigured
          ? 'custom endpoint configured'
          : 'default local endpoint'
      }`,
    )

    console.log()
    console.log('web search')
    if (r.webSearch.braveConfigured) {
      console.log('  ✓ Brave Search configured')
    } else {
      console.log('  - Brave Search (set BRAVE_API_KEY — free at https://brave.com/search/api/)')
    }
    if (r.webSearch.searxngConfigured) {
      console.log('  ✓ SearXNG configured')
    } else {
      console.log('  - SearXNG (set SEARXNG_URL if you self-host one)')
    }
    if (!r.webSearch.braveConfigured && !r.webSearch.searxngConfigured) {
      console.log('  - no Brave/SearXNG: Agents on OpenAI/ChatGPT models use hosted search')
      console.log('    backend (BAZILION_WEB_SEARCH_ROUTE) and status: bazilion config list')
    }

    console.log()
    console.log('openclaw integration')
    if (r.openclaw.exists) {
      console.log(`  ✓ ${r.openclaw.path} found`)
      console.log('    try: bazilion skill import --from openclaw')
    } else {
      console.log(`  - ${r.openclaw.path} not found (fine if you don't use OpenClaw)`)
    }

    console.log()
    console.log('background jobs')
    console.log(
      `  ${r.scheduler.enabled ? '✓' : '-'} scheduler${
        r.scheduler.enabled ? ` (tick ${r.scheduler.tickMs}ms)` : ' (BAZILION_SCHEDULER=off)'
      }`,
    )

    console.log()
    for (const line of runtimeDoctorLines(r)) console.log(line)

    console.log()
    console.log('operational counts')
    console.log(`  ${r.triggers.active} active trigger(s), ${r.triggers.disabled} disabled`)
    console.log(`  ${r.tokens.active} active web token(s)`)

    const anyCloudProvider = r.providers.configured.length > 0
    const hasProfiles = (r.database?.ok ? r.database.profiles : 0) > 0
    const hasAgents = (r.database?.ok ? r.database.totalAgents : 0) > 0

    console.log()
    if (!r.ok) {
      console.log('installation issues found ✗')
      process.exitCode = 1
      return
    }
    console.log('install is healthy ✓')
    if (!hasProfiles || !hasAgents) {
      console.log('next steps')
      const todo: string[] = []
      if (!anyCloudProvider) {
        todo.push('  - set a cloud api key (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY)')
        todo.push('    or make sure LMStudio / Ollama is running locally')
      }
      if (!hasProfiles) {
        todo.push('  - enable a provider: bazilion provider enable <provider>')
        todo.push('  - save a model: bazilion provider models-set <provider> <model-id>')
      }
      if (!hasAgents) todo.push('  - spawn an agent: bazilion agent spawn --profile <id>')
      for (const line of todo) console.log(line)
    }
  },
})

/** Sandbox and approval apply the same way to every turn: chat, Telegram, schedules and inbox. */
export function runtimeDoctorLines(report: Pick<HealthReport, 'shellSecurity'>): string[] {
  const shell = report.shellSecurity
  const lines = ['agent runtime (every turn: chat, Telegram, schedules, inbox)']
  if (!shell.ok) {
    lines.push(checkLine('valid shell-security configuration', false, shell.error))
    return lines
  }
  if (shell.sandboxMode === 'docker') {
    lines.push(
      `  - sandbox: docker (${shell.sandboxImage}) — bash runs in a network-disabled container; host file tools hidden`,
    )
    if (shell.docker) {
      lines.push(
        checkLine(
          `Docker ready (${shell.docker.image})`,
          shell.docker.ready,
          shell.docker.reason ?? undefined,
        ),
      )
      if (shell.docker.remediation) lines.push(`    remediation: ${shell.docker.remediation}`)
    }
  } else {
    lines.push(
      '  - sandbox: off — bash and file tools run on the host, unisolated',
      '    set BAZILION_BASH_SANDBOX=docker to sandbox bash',
    )
  }
  lines.push(
    shell.approvalMode === 'dangerous'
      ? '  - dangerous-command approval: on — chat can allow once; unattended turns auto-deny'
      : '  - dangerous-command approval: off — set BAZILION_BASH_APPROVAL=dangerous to opt in',
  )
  return lines
}

function checkLine(label: string, condition: boolean, hint?: string): string {
  const mark = condition ? '✓' : '✗'
  const tail = !condition && hint ? ` — ${hint}` : ''
  return `  ${mark} ${label}${tail}`
}
