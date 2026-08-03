import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { resolveAgent } from '../../src/core/agent/resolve.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { agentLessonProposalRepo, agentRepo, agentReviewRepo } from '../../src/core/index.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { buildSystemPrompt, loadPromptSkills } from '../../src/runtime/session/prompt.ts'
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
