import { afterEach, beforeEach, expect, test } from 'vitest'
import { deleteAgent } from '../../src/core/agent/delete.ts'
import {
  agentSecretValues,
  checkSecretHosts,
  checkSecretName,
  listAgentSecrets,
  removeAgentSecret,
  setAgentSecret,
} from '../../src/core/agent-secrets.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import { openSecrets } from '../../src/core/repos/secrets.ts'
import { mergeSecretsIntoEnv } from '../../src/core/secrets.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

const PASSWORD = 'test-password'
let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  profileRepo.insert(env.db, {
    id: 'p',
    name: 'p',
    defaultModel: 'lmstudio:x',
    skillsMode: 'selected',
  })
  for (const id of ['a1', 'a2'])
    agentRepo.insert(env.db, {
      id,
      profileId: 'p',
      name: id,
      modelOverride: null,
      reasoningLevel: 'medium',
      status: 'idle',
      teamId: env.teamId,
    })
})
afterEach(() => env.cleanup())

test("a secret's name is an environment variable Bazilion and commands do not already use", () => {
  expect(checkSecretName(' GITHUB_TOKEN ')).toBe('GITHUB_TOKEN')
  for (const bad of ['github_token', '1TOKEN', 'MY-TOKEN', '', 'A'.repeat(65)])
    expect(() => checkSecretName(bad)).toThrow(/environment variable name/)
  for (const taken of ['PATH', 'LD_PRELOAD', 'BAZILION_TOKEN', 'OPENAI_API_KEY', 'MCP_TOKEN_X'])
    expect(() => checkSecretName(taken)).toThrow(/already use/)
  expect(checkSecretHosts([' API.GitHub.com. ', 'api.github.com'])).toEqual(['api.github.com'])
  expect(() => checkSecretHosts(['https://api.github.com'])).toThrow(/not a host name/)
})

test("each Agent has its own secrets, kept out of every turn's settings", () => {
  setAgentSecret(env.db, PASSWORD, 'a1', {
    name: 'GITHUB_TOKEN',
    value: 'ghp_first',
    reason: 'Open the pull request',
    hosts: ['api.github.com'],
  })
  // A replacement keeps the reason and hosts it is not given.
  setAgentSecret(env.db, PASSWORD, 'a1', { name: 'GITHUB_TOKEN', value: 'ghp_second' })
  setAgentSecret(env.db, PASSWORD, 'a2', { name: 'NPM_TOKEN', value: 'npm_value' })
  expect(listAgentSecrets(env.db, PASSWORD, 'a1')).toEqual([
    {
      name: 'GITHUB_TOKEN',
      reason: 'Open the pull request',
      hosts: ['api.github.com'],
      storedAt: expect.any(Number),
    },
  ])
  expect(agentSecretValues(env.db, PASSWORD, 'a1').map((s) => s.value)).toEqual(['ghp_second'])
  // Stored encrypted, like Bazilion's own keys, and not merged into the settings of all turns.
  openSecrets(env.db, PASSWORD).set('BRAVE_API_KEY', 'brave')
  const merged = mergeSecretsIntoEnv(env.db, PASSWORD, {})
  expect(merged.BRAVE_API_KEY).toBe('brave')
  expect(Object.values(merged).join('\n')).not.toContain('ghp_second')
  expect(JSON.stringify(env.db.raw.query('SELECT envelope FROM secrets').all())).not.toContain(
    'ghp_second',
  )
  expect(() => setAgentSecret(env.db, PASSWORD, 'a1', { name: 'X_KEY', value: '  ' })).toThrow(
    /empty/,
  )

  expect(removeAgentSecret(env.db, PASSWORD, 'a1', 'GITHUB_TOKEN')).toBe(true)
  expect(removeAgentSecret(env.db, PASSWORD, 'a1', 'GITHUB_TOKEN')).toBe(false)
  deleteAgent(env.db, 'a2')
  expect(listAgentSecrets(env.db, PASSWORD, 'a2')).toEqual([])
  expect(openSecrets(env.db, PASSWORD).get('BRAVE_API_KEY')).toBe('brave')
})
