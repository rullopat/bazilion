import type { HealthReport } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

export const doctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Diagnose your bazilion install' },
  async run() {
    const client = createClient()
    const r = await client.get<HealthReport>('/api/health')

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
      `  ✓ lmstudio: ${r.providers.lmstudio.baseURL}${
        r.providers.lmstudio.hasKey ? ' (api key set)' : ''
      }`,
    )
    console.log(`  ✓ ollama:   ${r.providers.ollama.baseURL}`)

    console.log()
    console.log('web search (at least one needed for web_search tool)')
    if (r.webSearch.bravePreview) {
      console.log(`  ✓ Brave Search (BRAVE_API_KEY set, ${r.webSearch.bravePreview})`)
    } else {
      console.log('  - Brave Search (set BRAVE_API_KEY — free at https://brave.com/search/api/)')
    }
    if (r.webSearch.searxngUrl) {
      console.log(`  ✓ SearXNG: ${r.webSearch.searxngUrl}`)
    } else {
      console.log('  - SearXNG (set SEARXNG_URL if you self-host one)')
    }
    if (!r.webSearch.bravePreview && !r.webSearch.searxngUrl) {
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
    console.log('agent shell security')
    if (!r.shellSecurity.ok) {
      check('valid shell-security configuration', false, r.shellSecurity.error)
    } else {
      if (r.shellSecurity.approvalMode === 'dangerous') {
        console.log('  - dangerous-command approval enabled')
        console.log(
          '    web and TTY CLI turns can allow once; background and non-TTY turns auto-deny',
        )
      } else {
        console.log('  - dangerous-command approval off')
        console.log('    set BAZILION_BASH_APPROVAL=dangerous to opt in')
      }
      if (r.shellSecurity.sandboxMode === 'docker') {
        console.log(`  - Docker sandbox configured (${r.shellSecurity.sandboxImage})`)
        console.log(
          '    workspace-only writable mount · bounded inputs/skills/memory read-only · network disabled',
        )
        console.log('    host coding tools hidden')
        console.log(
          '    policy syntax is valid; Docker and image availability are checked on execution',
        )
        console.log('    commands fail closed if either is unavailable')
      } else {
        console.log('  - sandbox off (agent shell and coding tools run on the host)')
        console.log('    approval is a host-execution tripwire, not a filesystem sandbox')
        console.log('    set BAZILION_BASH_SANDBOX=docker to opt in')
      }
    }

    console.log()
    console.log('operational counts')
    console.log(`  ${r.triggers.active} active trigger(s), ${r.triggers.disabled} disabled`)
    console.log(`  ${r.tokens.active} active web token(s)`)

    const anyCloudProvider = r.providers.configured.length > 0
    const hasProfiles = (r.database?.ok ? r.database.profiles : 0) > 0
    const hasAgents = (r.database?.ok ? r.database.totalAgents : 0) > 0

    console.log()
    if (!r.ok) {
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
