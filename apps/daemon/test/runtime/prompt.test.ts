import { mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { resolveAgent } from '../../src/core/agent/resolve.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { agentLessonProposalRepo, agentRepo, agentReviewRepo } from '../../src/core/index.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import {
  buildSystemPrompt,
  loadPromptSkills,
  loadProtectedHomeDocuments,
} from '../../src/runtime/session/prompt.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv

beforeEach(() => {
  env = makeTestEnv()
})

afterEach(() => env.cleanup())

test('buildSystemPrompt ignores a legacy on-disk HEARTBEAT.md', () => {
  createProfile(env.db, env.paths, { id: 'profile', defaultModel: 'm' })
  const agent = spawnAgent(env.db, env.paths, {
    profileId: 'profile',
    teamId: env.teamId,
  })
  writeFileSync(
    join(agent.dir, 'HEARTBEAT.md'),
    '# HEARTBEAT.md\n\nLEGACY_HEARTBEAT_PROMPT_SENTINEL\n',
  )

  const prompt = buildSystemPrompt(resolveAgent(env.db, env.paths, agent.id))

  expect(prompt).toContain('## SOUL.md')
  expect(prompt).not.toContain('HEARTBEAT.md')
  expect(prompt).not.toContain('LEGACY_HEARTBEAT_PROMPT_SENTINEL')
})

test('attached SKILL.md instructions and runtime sidecar path reach the prompt', () => {
  const skillDir = join(env.paths.skillsDir, 'reporting')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: reporting',
      'description: Build the standard report.',
      '---',
      'Follow REPORTING_SKILL_INSTRUCTION and run scripts/render.sh when needed.',
    ].join('\n'),
  )
  createProfile(env.db, env.paths, { id: 'profile', defaultModel: 'm' })
  const agent = spawnAgent(env.db, env.paths, {
    profileId: 'profile',
    teamId: env.teamId,
  })
  agentRepo.attachSkill(env.db, agent.id, 'reporting')
  const resolved = resolveAgent(env.db, env.paths, agent.id)
  const skills = loadPromptSkills(env.paths.skillsDir, resolved.skills)

  const hostPrompt = buildSystemPrompt(resolved, { skills, sandboxMode: 'off' })
  expect(hostPrompt).toContain('REPORTING_SKILL_INSTRUCTION')
  expect(hostPrompt).toContain(`Runtime directory: \`${skillDir}\``)

  const dockerPrompt = buildSystemPrompt(resolved, { skills, sandboxMode: 'docker' })
  expect(dockerPrompt).toContain('REPORTING_SKILL_INSTRUCTION')
  expect(dockerPrompt).toContain('Runtime directory: `/skills/0-reporting`')
  expect(dockerPrompt).toContain(`- ${resolved.team.id} (${resolved.team.name}): /workspace`)
  expect(dockerPrompt).not.toContain(resolved.team.path)
})

test('only approved private reviewed lessons reach the agent prompt', () => {
  createProfile(env.db, env.paths, { id: 'profile', defaultModel: 'm' })
  const agent = spawnAgent(env.db, env.paths, {
    profileId: 'profile',
    teamId: env.teamId,
  })
  const review = agentReviewRepo.enqueueManual(env.db, agent.id)
  const privateProposal = agentLessonProposalRepo.insert(env.db, {
    reviewId: review.id,
    agentId: agent.id,
    scope: 'private',
    text: 'PRIVATE_APPROVED_LESSON',
    evidence: [{ sessionId: 's', entryOrdinal: 1 }],
  })
  agentLessonProposalRepo.approve(env.db, privateProposal.id, 1, null)
  const sharedProposal = agentLessonProposalRepo.insert(env.db, {
    reviewId: review.id,
    agentId: agent.id,
    scope: 'shared',
    text: 'SHARED_LESSON_NOT_IN_PRIVATE_PROMPT',
    evidence: [{ sessionId: 's', entryOrdinal: 2 }],
  })
  agentLessonProposalRepo.approve(env.db, sharedProposal.id, 1, `lessons/${sharedProposal.id}.md`)

  const prompt = buildSystemPrompt(resolveAgent(env.db, env.paths, agent.id))
  expect(prompt).toContain('# Reviewed lessons')
  expect(prompt).toContain('PRIVATE_APPROVED_LESSON')
  expect(prompt).not.toContain('SHARED_LESSON_NOT_IN_PRIVATE_PROMPT')
})

test('Agent prompt documents never follow fixed-name symbolic links', () => {
  createProfile(env.db, env.paths, { id: 'profile', defaultModel: 'm' })
  const agent = spawnAgent(env.db, env.paths, {
    profileId: 'profile',
    teamId: env.teamId,
  })
  const resolved = resolveAgent(env.db, env.paths, agent.id)
  const original = loadProtectedHomeDocuments(agent.dir)
  const secretPath = join(env.paths.home, 'auth-sentinel')
  writeFileSync(secretPath, 'BOOTSTRAP_TOKEN_SENTINEL', 'utf8')
  unlinkSync(join(agent.dir, 'SOUL.md'))
  symlinkSync(secretPath, join(agent.dir, 'SOUL.md'))

  expect(() => buildSystemPrompt(resolved)).toThrow('private Agent home is unsafe at SOUL.md')
  const protectedPrompt = buildSystemPrompt(resolved, { homeDocuments: original })
  expect(protectedPrompt).not.toContain('BOOTSTRAP_TOKEN_SENTINEL')
  expect(protectedPrompt).toContain(original['SOUL.md']?.trim() ?? '')
})

test('attached skill prompt loading refuses a symlinked SKILL.md', () => {
  const skillDir = join(env.paths.skillsDir, 'unsafe')
  mkdirSync(skillDir, { recursive: true })
  const secretPath = join(env.paths.home, 'skill-secret')
  writeFileSync(secretPath, '---\nname: stolen\ndescription: SECRET_SENTINEL\n---\nSECRET', 'utf8')
  symlinkSync(secretPath, join(skillDir, 'SKILL.md'))

  expect(loadPromptSkills(env.paths.skillsDir, ['unsafe'])).toEqual([])
})

test('native research guidance is conditional and not a browser-search fallback', () => {
  createProfile(env.db, env.paths, { id: 'search-profile', defaultModel: 'openai:gpt-6-astra' })
  const spawned = spawnAgent(env.db, env.paths, { profileId: 'search-profile', teamId: env.teamId })
  const agent = resolveAgent(env.db, env.paths, spawned.id)
  const prompt = buildSystemPrompt(agent, { searchGuide: true })
  expect(prompt).toContain('# Public web research')
  expect(prompt).toContain('effective URL')
  expect(prompt).toContain('not proof that you read a source')
  expect(prompt).toContain('site: query text alone is not enforcement')
  expect(prompt).not.toContain('# Browser research')
  expect(buildSystemPrompt(agent)).not.toContain('# Public web research')
})

describe('browser operating guide (BAZ-069 T10)', () => {
  function spawnTestAgent(): string {
    createProfile(env.db, env.paths, { id: 'profile', defaultModel: 'm' })
    const agent = spawnAgent(env.db, env.paths, { profileId: 'profile', teamId: env.teamId })
    return agent.id
  }

  test('the guide is included only when the browser tools are admitted', () => {
    const agent = resolveAgent(env.db, env.paths, spawnTestAgent())
    const withGuide = buildSystemPrompt(agent, { browserGuide: true })
    const withoutGuide = buildSystemPrompt(agent, {})
    expect(withGuide).toContain('# Browser research (guide v6)')
    expect(withoutGuide).not.toContain('# Browser research')
  })

  test('the guide covers the story teaching: status first, observe-act-observe, tabs, cursors, non-replay, citation, blockers, untrusted content', () => {
    const agent = resolveAgent(env.db, env.paths, spawnTestAgent())
    const guide = buildSystemPrompt(agent, { browserGuide: true })
    // 1. availability first; no API key does not mean no browser
    expect(guide).toContain('browser_status')
    expect(guide).toMatch(/No search API key does not mean no browser/i)
    expect(guide).toContain('web_search')
    expect(guide).toContain('Prefer admitted `web_search` for default discovery')
    expect(guide).toContain('disclose it rather than silently running browser search')
    // 2. observe-act-observe; current refs; observationId; stale refusal
    expect(guide).toMatch(/Observe, act, observe again/i)
    expect(guide).toContain('observationId')
    // 3. tabs + cursors + uncertain-action non-replay
    expect(guide).toMatch(/browser_tabs/)
    expect(guide).toMatch(/cursor/i)
    expect(guide).toMatch(/never replay a submission blindly/i)
    expect(guide).toContain('no action was dispatched')
    expect(guide).toContain('Other action failures may have taken effect')
    // 4. citations and observed-vs-inferred distinction
    expect(guide).toMatch(/Cite the URL/i)
    // 5. blockers: CAPTCHA/consent; report, don't poll; unattended turns
    expect(guide).toMatch(/CAPTCHA/i)
    expect(guide).toMatch(/do not promise success|report the blocker/i)
    // 6. untrusted data, research is not permission
    expect(guide).toMatch(/untrusted data/i)
    expect(guide).toMatch(/never post, purchase/i)
  })

  test('delegated cookie rejection does not authorize CAPTCHA or broader consent', () => {
    const agent = resolveAgent(env.db, env.paths, spawnTestAgent())
    const guide = buildSystemPrompt(agent, { browserGuide: true })
    expect(guide).toContain('operator has already authorized rejecting optional cookies')
    expect(guide).toContain('carry out that exact choice autonomously')
    expect(guide).toContain('Judge the visible consent text and effect, not an exact button label')
    expect(guide).toContain('“Reject” that declines the optional advertising/analytics uses')
    expect(guide).toContain('If the operator explicitly required a specific label, site or purpose')
    expect(guide).toContain('If the scope of rejection is unclear or the choice is absent, stop')
    expect(guide).toContain('After a stale ref, re-observe before acting')
    expect(guide).toContain('Never substitute “Accept”, “Accept all”')
    expect(guide).toContain('not permission to solve CAPTCHA, log in, pay')
    expect(guide).toContain('Verify the effective destination URL')
  })

  test('bounded semantic recovery is read-only and keeps blocker and freshness rules', () => {
    const agent = resolveAgent(env.db, env.paths, spawnTestAgent())
    const guide = buildSystemPrompt(agent, { browserGuide: true })
    expect(guide).toContain('browser_snapshot {"scope":"dialog"}')
    expect(guide).toContain('exactly one accessible region')
    expect(guide).toContain('never old refs or screenshot coordinates')
    expect(guide).toContain('Scoping grants no consent, CAPTCHA or permission bypass')
  })

  test('the guide is bounded prompt content', () => {
    const agent = resolveAgent(env.db, env.paths, spawnTestAgent())
    const withGuide = buildSystemPrompt(agent, { browserGuide: true })
    const withoutGuide = buildSystemPrompt(agent, {})
    const guideLength = withGuide.length - withoutGuide.length
    expect(guideLength).toBeGreaterThan(0)
    expect(guideLength).toBeLessThan(6_000)
  })
})
