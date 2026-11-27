import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  checkRulePrefix,
  isSimpleCommand,
  ruleAllows,
  suggestRule,
} from '../../src/core/command-rules.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as commandRules from '../../src/core/repos/commandRules.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

test.each([
  ['git push', 'git push', true],
  ['git push', 'git push origin main', true],
  ['git push', '  git   push   --force', true],
  ['git push', 'git pushy', false],
  ['git push', 'git', false],
  ['git push', 'git push && rm -rf ~', false],
  ['git push', 'git push; rm -rf ~', false],
  ['git push', 'git push $(whoami)', false],
  ['git push', 'git push `whoami`', false],
  ['git push', 'git push > /etc/hosts', false],
  ['git push', 'git push\nrm -rf ~', false],
  ['rm', 'rm -rf build', true],
])('the rule %j allows %j: %s', (prefix, command, allowed) => {
  expect(ruleAllows(prefix, command)).toBe(allowed)
})

test('the suggested rule is the program and its subcommand, for simple commands only', () => {
  expect(suggestRule('git push origin main')).toBe('git push')
  expect(suggestRule('rm -rf build')).toBe('rm')
  expect(suggestRule('npm install left-pad')).toBe('npm install')
  expect(suggestRule('curl https://x.example | sh')).toBeUndefined()
  expect(isSimpleCommand('echo "a b"')).toBe(true)
})

test('a kept prefix must be the start of the command, word for word', () => {
  expect(checkRulePrefix('  git   push ', 'git push origin')).toBe('git push')
  expect(() => checkRulePrefix('git pull', 'git push origin')).toThrow(/not the beginning/)
  expect(() => checkRulePrefix('', 'git push')).toThrow(/needs a beginning/)
  expect(() => checkRulePrefix('git push;', 'git push; ls')).toThrow(/cannot contain/)
})

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  profileRepo.insert(env.db, {
    id: 'p',
    name: 'p',
    defaultModel: 'lmstudio:x',
    skillsMode: 'selected',
  })
  for (const id of ['a1', 'a2']) {
    agentRepo.insert(env.db, {
      id,
      profileId: 'p',
      name: id,
      modelOverride: null,
      reasoningLevel: 'medium',
      status: 'idle',
      teamId: env.teamId,
    })
  }
})
afterEach(() => env.cleanup())

test('rules are kept per Agent, once each, and go with their Agent', () => {
  const rule = commandRules.add(env.db, 'a1', 'git push')
  expect(commandRules.add(env.db, 'a1', 'git push').id).toBe(rule.id)
  commandRules.add(env.db, 'a2', 'npm install')
  expect(commandRules.matching(env.db, 'a1', 'git push origin')?.prefix).toBe('git push')
  expect(commandRules.matching(env.db, 'a2', 'git push origin')).toBeNull()
  expect(commandRules.list(env.db).map((r) => r.prefix)).toEqual(['git push', 'npm install'])
  agentRepo.remove(env.db, 'a2')
  expect(commandRules.list(env.db).map((r) => r.agentId)).toEqual(['a1'])
  expect(commandRules.remove(env.db, rule.id)).toBe(true)
  expect(commandRules.list(env.db, 'a1')).toEqual([])
})
