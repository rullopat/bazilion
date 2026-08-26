import type { HealthReport } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

export const doctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Diagnose your bazilion install' },
  async run() {
    const client = createClient()
    const r = await client.get<HealthReport>('/api/health/details')

    function check(label: string, condition: boolean, hint?: string): void {
      const mark = condition ? '✓' : '✗'
      const tail = !condition && hint ? ` — ${hint}` : ''
      console.log(`  ${mark} ${label}${tail}`)
    }

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
    console.log('web search (at least one needed for web_search tool)')
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
      console.log('  ⚠ no search backend — web_search will error until one is configured')
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
    for (const line of executionSecurityDoctorLines(r)) console.log(line)

    console.log()
    console.log('operational counts')
    console.log(`  ${r.triggers.active} active trigger(s), ${r.triggers.disabled} disabled`)
    console.log(`  ${r.tokens.active} active web token(s)`)

    const anyCloudProvider = r.providers.configured.length > 0
    const hasProfiles = (r.database?.ok ? r.database.profiles : 0) > 0
    const hasAgents = (r.database?.ok ? r.database.totalAgents : 0) > 0

    console.log()
    if (doctorHasIssues(r)) {
      console.log('issues found ✗')
      process.exit(1)
    }
    // Install is structurally healthy. Differentiate "ready to use" from "just
    // initialized" so a fresh install doesn't masquerade as fully configured.
    // (Local providers — lmstudio/ollama — are reported with default URLs
    // whether or not they're actually running, so we can only advise; cloud
    // providers have api keys we can check.)
    if (!hasProfiles || !hasAgents) {
      console.log('install is healthy, but not yet ready to run ⚠')
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
    } else {
      console.log('all good ✓')
    }
  },
})

export function executionSecurityDoctorLines(
  report: Pick<HealthReport, 'executionSecurity' | 'shellSecurity'>,
): string[] {
  const configured = report.executionSecurity.configuredOperatorHttp
  const protectedTurns = report.executionSecurity.protectedUnattendedTurns
  const lines = ['configured operator HTTP (legacy · unprotected)']

  if (!report.shellSecurity.ok) {
    lines.push(checkLine('valid shell-security configuration', false, report.shellSecurity.error))
  } else {
    if (report.shellSecurity.approvalMode === 'dangerous') {
      lines.push(
        '  - dangerous-command approval enabled',
        '    web and TTY CLI turns can allow once; non-interactive operator requests auto-deny',
      )
    } else {
      lines.push(
        '  - dangerous-command approval off',
        '    set BAZILION_BASH_APPROVAL=dangerous to opt in',
      )
    }

    if (report.shellSecurity.sandboxMode === 'docker') {
      lines.push(
        `  - coding surface: Docker only (${report.shellSecurity.sandboxImage})`,
        '    workspace-only writable mount · bounded inputs/skills/memory read-only · network disabled',
        '    host coding tools hidden',
        '    policy syntax is valid; Docker and image availability are checked on execution',
        '    commands fail closed if either is unavailable',
      )
    } else {
      lines.push(
        '  - coding surface: host tools',
        '    approval is a host-execution tripwire, not a filesystem sandbox',
        '    set BAZILION_BASH_SANDBOX=docker to opt in',
      )
    }
  }
  lines.push(`  - browser: ${configured.browser}`, `  - MCP: ${configured.mcp}`, '')

  lines.push(
    'protected unattended turns baseline (Telegram, schedules, inbox, approvals)',
    checkLine('protected base runtime ready', protectedTurns.baseRuntimeReady),
    '  - coding surface: Docker only',
    checkLine(
      `Docker ready (${protectedTurns.docker.image})`,
      protectedTurns.docker.ready,
      protectedTurns.docker.reason ?? undefined,
    ),
    checkLine('OpenAI Codex enabled', protectedTurns.openaiCodex.enabled),
    checkLine('ChatGPT connected', protectedTurns.openaiCodex.connected),
    `  - OpenAI access: ${openAIAccessStatus(protectedTurns.openaiCodex)}`,
    checkLine('OpenAI Codex baseline eligible', protectedTurns.openaiCodex.baselineEligible),
    `  ✓ browser: ${protectedTurns.browser}`,
    `  ✓ MCP: ${protectedTurns.mcp}`,
    '  - every turn separately validates its selected normal/review model, bound OAuth refresh, and mounts/paths',
  )
  if (protectedTurns.remediation) {
    lines.push(`  remediation: ${protectedTurns.remediation}`)
  }
  return lines
}

export function doctorHasIssues(
  report: Pick<HealthReport, 'ok' | 'protectedWorkBaselineReady'>,
): boolean {
  return !report.ok || !report.protectedWorkBaselineReady
}

function openAIAccessStatus(
  status: ExecutionSecurityReportOpenAIStatus,
): 'current' | 'refresh on next turn' | 'unavailable' {
  if (status.accessCurrent) return 'current'
  if (status.refreshOnNextTurn) return 'refresh on next turn'
  return 'unavailable'
}

type ExecutionSecurityReportOpenAIStatus =
  HealthReport['executionSecurity']['protectedUnattendedTurns']['openaiCodex']

function checkLine(label: string, condition: boolean, hint?: string): string {
  const mark = condition ? '✓' : '✗'
  const tail = !condition && hint ? ` — ${hint}` : ''
  return `  ${mark} ${label}${tail}`
}
