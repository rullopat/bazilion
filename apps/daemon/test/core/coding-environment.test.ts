import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createProfile, resolveAgent, spawnAgent, teamRepo } from '../../src/core/index.ts'
import { getCodingEnvironment } from '../../src/core/repos/coding-environment.ts'
import {
  codingEnvironmentStatus,
  dockerTurn,
  setTeamCodingEnvironment,
} from '../../src/lib/coding-environment.ts'
import { homeContainerPrefix } from '../../src/runtime/shell/docker.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

function team() {
  const found = teamRepo.get(env.db, env.teamId, env.paths)
  if (!found) throw new Error('missing test Team')
  return found
}

test('a Team without saved defaults uses the installation image at the workspace root', () => {
  expect(getCodingEnvironment(env.db, env.teamId)).toEqual({ image: null, cwd: '.' })
  expect(
    codingEnvironmentStatus(env.db, env.teamId, {
      BAZILION_BASH_SANDBOX: 'docker',
      BAZILION_BASH_SANDBOX_IMAGE: 'local/base:1',
    }),
  ).toEqual({ image: null, cwd: '.', sandboxMode: 'docker', defaultImage: 'local/base:1' })
})

test('saved defaults select the image and working directory of each Docker turn', () => {
  mkdirSync(join(team().path, 'app'))
  expect(
    setTeamCodingEnvironment(env.db, team(), { image: 'local/node:26', cwd: 'app' }, {}),
  ).toEqual({
    image: 'local/node:26',
    cwd: 'app',
    sandboxMode: 'off',
    defaultImage: 'debian:bookworm-slim',
  })
  createProfile(env.db, env.paths, { id: 'coder', defaultModel: 'lmstudio:test-model' })
  const agent = resolveAgent(
    env.db,
    env.paths,
    spawnAgent(env.db, env.paths, { profileId: 'coder', teamId: env.teamId }).id,
  )
  const first = dockerTurn(env.db, env.paths, agent, {})
  const second = dockerTurn(env.db, env.paths, agent, {})
  expect(first).toMatchObject({ image: 'local/node:26', cwd: 'app' })
  // Each turn names its containers with a fresh prefix under this home's prefix.
  expect(first.containerPrefix.startsWith(homeContainerPrefix(env.paths.home))).toBe(true)
  expect(first.containerPrefix).not.toBe(second.containerPrefix)

  // An empty image goes back to the installation image.
  setTeamCodingEnvironment(env.db, team(), { image: null, cwd: '.' })
  expect(
    dockerTurn(env.db, env.paths, agent, { BAZILION_BASH_SANDBOX_IMAGE: 'local/base:1' }),
  ).toMatchObject({ image: 'local/base:1', cwd: '.' })
})

test.each([
  [{ image: 'local/node:26', cwd: '../outside' }, 'cwd'],
  [{ image: 'local/node:26', cwd: '/etc' }, 'cwd'],
  [{ image: 'local/node:26', cwd: '.git' }, 'cwd'],
  [{ image: '--privileged', cwd: '.' }, 'image'],
  [{ image: 'local/node:26', cwd: '.', env: { CI: 'true' } }, 'only image and cwd'],
  [null, 'Invalid coding environment'],
])('refuses invalid defaults: %j', (input, message) => {
  expect(() => setTeamCodingEnvironment(env.db, team(), input)).toThrow(message)
  expect(getCodingEnvironment(env.db, env.teamId)).toEqual({ image: null, cwd: '.' })
})

test('the working directory must be a real directory inside the Team', () => {
  mkdirSync(join(team().path, 'app'))
  writeFileSync(join(team().path, 'notes'), 'text')
  symlinkSync(join(team().path, 'app'), join(team().path, 'linked'))
  for (const cwd of ['missing', 'app/missing', 'notes', 'linked', 'linked/x'])
    expect(() => setTeamCodingEnvironment(env.db, team(), { image: null, cwd })).toThrow(
      'The directory must be an existing directory inside the Team',
    )
  expect(getCodingEnvironment(env.db, env.teamId)).toEqual({ image: null, cwd: '.' })
})
