import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createProfile } from '../../src/core/profile/create.ts'
import { loadProfile } from '../../src/core/profile/load.ts'
import { updateProfile } from '../../src/core/profile/update.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

test('createProfile scaffolds dir, files, and DB row', () => {
  const profile = createProfile(env.db, env.paths, {
    id: 'researcher',
    name: 'Researcher',
    defaultModel: 'anthropic:claude-opus-4-6',
    defaultSkills: ['web-search', 'note-taking'],
  })

  expect(profile.id).toBe('researcher')
  expect(profile.name).toBe('Researcher')
  expect(profile.dir).toBe(env.paths.profileDir('researcher'))
  expect(existsSync(join(profile.dir, 'SOUL.md'))).toBe(true)
  expect(existsSync(join(profile.dir, 'IDENTITY.md'))).toBe(true)
  expect(existsSync(join(profile.dir, 'BOOTSTRAP.md'))).toBe(true)
  expect(existsSync(join(profile.dir, 'profile.json'))).toBe(true)

  const fromDb = profileRepo.get(env.db, 'researcher')
  expect(fromDb?.defaultModel).toBe('anthropic:claude-opus-4-6')
  expect(fromDb?.skillsMode).toBe('selected')

  const skills = profileRepo.getDefaultSkills(env.db, 'researcher')
  expect(skills).toEqual(['note-taking', 'web-search'])
})

test('createProfile rejects invalid slug', () => {
  expect(() =>
    createProfile(env.db, env.paths, {
      id: 'NotASlug!',
      defaultModel: 'x',
    }),
  ).toThrow(/invalid slug/)
})

test('loadProfile returns profile, default skills, and file contents', () => {
  createProfile(env.db, env.paths, {
    id: 'p1',
    defaultModel: 'm',
    defaultSkills: ['a', 'b'],
  })
  const loaded = loadProfile(env.db, 'p1')
  expect(loaded.profile.id).toBe('p1')
  expect(loaded.defaultSkills).toEqual(['a', 'b'])
  expect(loaded.files.soul).toContain('SOUL.md')
  expect(loaded.files.identity).toContain('IDENTITY.md')
  expect(loaded.files.bootstrap).toContain('BOOTSTRAP.md')
  // Optional files default to absent — profiles opt in via templates.
  expect(loaded.files.agents).toBeNull()
  expect(loaded.files.tools).toBeNull()
  expect(loaded.files.heartbeat).toBeNull()
  expect(loaded.identity).toBeNull()
})

test('createProfile seeds AGENTS.md / TOOLS.md / HEARTBEAT.md when provided', () => {
  const profile = createProfile(env.db, env.paths, {
    id: 'felix',
    defaultModel: 'm',
    templates: {
      identity: '# IDENTITY\n- Name: Felix\n- Emoji: 🐾\n',
      agents: '# AGENTS\n- peer-a: does stuff\n',
      tools: '# TOOLS\n- run_skill before shell\n',
      heartbeat: '# HEARTBEAT\n- check inbox\n',
    },
  })
  expect(existsSync(join(profile.dir, 'AGENTS.md'))).toBe(true)
  expect(existsSync(join(profile.dir, 'TOOLS.md'))).toBe(true)
  expect(existsSync(join(profile.dir, 'HEARTBEAT.md'))).toBe(true)
  const loaded = loadProfile(env.db, 'felix')
  expect(loaded.files.agents).toContain('peer-a')
  expect(loaded.files.tools).toContain('run_skill')
  expect(loaded.files.heartbeat).toContain('check inbox')
  expect(loaded.identity).toEqual({ name: 'Felix', emoji: '🐾' })
})

test('createProfile skips AGENTS/TOOLS/HEARTBEAT when omitted', () => {
  const profile = createProfile(env.db, env.paths, {
    id: 'bare',
    defaultModel: 'm',
  })
  expect(existsSync(join(profile.dir, 'AGENTS.md'))).toBe(false)
  expect(existsSync(join(profile.dir, 'TOOLS.md'))).toBe(false)
  expect(existsSync(join(profile.dir, 'HEARTBEAT.md'))).toBe(false)
})

test('loadProfile throws on missing profile', () => {
  expect(() => loadProfile(env.db, 'ghost')).toThrow(/profile not found/)
})

test('createProfile writes custom soul/identity content when provided', () => {
  const profile = createProfile(env.db, env.paths, {
    id: 'custom',
    defaultModel: 'm',
    templates: {
      soul: '# my soul\nbe bold',
      identity: '# my identity\nname: bazyl',
    },
  })
  const loaded = loadProfile(env.db, profile.id)
  expect(loaded.files.soul).toBe('# my soul\nbe bold')
  expect(loaded.files.identity).toBe('# my identity\nname: bazyl')
  // Bootstrap unspecified → default kicks in.
  expect(loaded.files.bootstrap).toContain('BOOTSTRAP.md')
})

test('createProfile with templates.bootstrap = null skips bootstrap file', () => {
  const profile = createProfile(env.db, env.paths, {
    id: 'no-bootstrap',
    defaultModel: 'm',
    templates: { bootstrap: null },
  })
  expect(existsSync(join(profile.dir, 'BOOTSTRAP.md'))).toBe(false)
  const loaded = loadProfile(env.db, 'no-bootstrap')
  expect(loaded.files.bootstrap).toBeNull()
})

test('updateProfile changes DB, profile.json, and skills in lockstep', () => {
  createProfile(env.db, env.paths, {
    id: 'p',
    defaultModel: 'old:model',
    defaultSkills: ['a'],
  })
  const updated = updateProfile(env.db, env.paths, 'p', {
    name: 'Renamed',
    defaultModel: 'new:model',
    defaultSkills: ['b', 'c'],
  })
  expect(updated.name).toBe('Renamed')
  expect(updated.defaultModel).toBe('new:model')

  const fromDb = profileRepo.get(env.db, 'p')
  expect(fromDb?.defaultModel).toBe('new:model')
  expect(profileRepo.getDefaultSkills(env.db, 'p')).toEqual(['b', 'c'])

  const json = JSON.parse(readFileSync(join(env.paths.profileDir('p'), 'profile.json'), 'utf8'))
  expect(json.defaultModel).toBe('new:model')
  expect(json.name).toBe('Renamed')
  expect(json.defaultSkills).toEqual(['b', 'c'])
})

test('updateProfile skillsMode persists', () => {
  createProfile(env.db, env.paths, {
    id: 'r',
    defaultModel: 'm',
    defaultSkills: ['x'],
  })
  expect(profileRepo.get(env.db, 'r')?.skillsMode).toBe('selected')
  updateProfile(env.db, env.paths, 'r', { skillsMode: 'all' })
  expect(profileRepo.get(env.db, 'r')?.skillsMode).toBe('all')
})

test('updateProfile throws on missing profile', () => {
  expect(() => updateProfile(env.db, env.paths, 'ghost', { name: 'x' })).toThrow(
    /profile not found/,
  )
})

test('listing profiles returns insertion order', () => {
  createProfile(env.db, env.paths, {
    id: 'a',
    defaultModel: 'm',
  })
  createProfile(env.db, env.paths, {
    id: 'b',
    defaultModel: 'm',
  })
  const ids = profileRepo.list(env.db).map((p) => p.id)
  expect(ids).toEqual(['a', 'b'])
})
