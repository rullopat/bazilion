import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

test('profile create + list + show', async () => {
  let r = await server.cli([
    'profile',
    'create',
    'researcher',
    '--model',
    'anthropic:claude-opus-4-6',
    '--skills-mode',
    'selected',
    '--skills',
    's1,s2',
  ])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('created profile researcher')

  r = await server.cli(['profile', 'list'])
  expect(r.stdout).toContain('researcher')
  expect(r.stdout).toContain('claude-opus-4-6')

  r = await server.cli(['profile', 'show', 'researcher'])
  expect(r.stdout).toContain('researcher')
  expect(r.stdout).toContain('default skills: s1, s2')
  expect(r.stdout).toContain('skills mode:    selected')
  expect(r.stdout).toContain('bootstrap: yes')
})

test('profile create with invalid slug fails', async () => {
  const r = await server.cli(['profile', 'create', 'Bad Id', '--model', 'm'])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('invalid slug')
})

test('profile update switches model and skills-mode', async () => {
  await server.cli(['profile', 'create', 'to-update', '--model', 'anthropic:claude-opus-4-6'])
  const r = await server.cli([
    'profile',
    'update',
    'to-update',
    '--model',
    'anthropic:claude-opus-4-7',
    '--skills-mode',
    'all',
  ])
  expect(r.exitCode).toBe(0)
  const show = await server.cli(['profile', 'show', 'to-update'])
  expect(show.stdout).toContain('claude-opus-4-7')
  expect(show.stdout).toContain('skills mode:    all')

  const json = JSON.parse(
    readFileSync(join(server.home, 'profiles', 'to-update', 'profile.json'), 'utf8'),
  )
  expect(json.defaultModel).toBe('anthropic:claude-opus-4-7')
  expect(json.skillsMode).toBe('all')
})

test('PUT /api/profiles/:id/files/:file edits SOUL.md post-creation', async () => {
  await server.cli(['profile', 'create', 'editable', '--model', 'anthropic:claude-opus-4-6'])
  const res = await fetch(`${server.url}/api/profiles/editable/files/SOUL.md`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${server.token}`,
      origin: server.url,
    },
    body: JSON.stringify({ content: '# edited post-creation\nnew rules' }),
  })
  expect(res.status).toBe(204)
  const soul = readFileSync(join(server.home, 'profiles', 'editable', 'SOUL.md'), 'utf8')
  expect(soul).toBe('# edited post-creation\nnew rules')
})

test('profile create --soul-file and --skip-bootstrap write custom templates', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'bazilion-tmpl-'))
  const soulPath = join(scratch, 'soul.md')
  writeFileSync(soulPath, '# custom soul\nmake it yours')
  try {
    const r = await server.cli([
      'profile',
      'create',
      'custom-tmpl',
      '--model',
      'anthropic:claude-opus-4-6',
      '--soul-file',
      soulPath,
      '--skip-bootstrap',
    ])
    expect(r.exitCode).toBe(0)

    const soul = readFileSync(join(server.home, 'profiles', 'custom-tmpl', 'SOUL.md'), 'utf8')
    expect(soul).toBe('# custom soul\nmake it yours')

    const show = await server.cli(['profile', 'show', 'custom-tmpl'])
    expect(show.stdout).toContain('bootstrap: no')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
