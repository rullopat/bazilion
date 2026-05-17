import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

function fixtureSkillsDir(skills: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-skill-fixture-'))
  for (const name of skills) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---
name: ${name}
description: Test skill ${name}.
---

body of ${name}
`,
    )
  }
  return root
}

test('skill list shows nothing when none installed', async () => {
  const r = await server.cli(['skill', 'list'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('no skills installed')
})

test('skill import + list + rm round-trip', async () => {
  const source = fixtureSkillsDir(['alpha', 'beta'])

  let r = await server.cli(['skill', 'import', '--from', source])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('imported alpha')
  expect(r.stdout).toContain('imported beta')

  r = await server.cli(['skill', 'list'])
  expect(r.stdout).toContain('alpha')
  expect(r.stdout).toContain('beta')
  expect(r.stdout).toContain('Test skill')

  r = await server.cli(['skill', 'rm', 'alpha'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['skill', 'list'])
  expect(r.stdout).not.toContain('alpha')
  expect(r.stdout).toContain('beta')
})

test('skill import skips existing without --force', async () => {
  const source = fixtureSkillsDir(['dup'])
  await server.cli(['skill', 'import', '--from', source])

  const r = await server.cli(['skill', 'import', '--from', source])
  expect(r.stdout).toContain('skipped dup')
})

test('skill import --from openclaw resolves to ~/.openclaw/skills', async () => {
  // We don't assume the user actually has skills there. We just check that
  // when ~/.openclaw/skills doesn't exist, the error message references the
  // path that the server (not the client) would resolve.
  const r = await server.cli(['skill', 'import', '--from', 'openclaw'])
  if (r.exitCode !== 0) {
    expect(r.stderr + r.stdout).toMatch(/\.openclaw/)
  }
})

test('skill list --agent shows attached skills with descriptions', async () => {
  const source = fixtureSkillsDir(['s1', 's2'])
  await server.cli(['skill', 'import', '--from', source])

  await server.cli(['profile', 'create', 'p', '--model', 'm', '--skills', 's1,s2'])
  let r = await server.cli(['agent', 'spawn', '--profile', 'p'])
  const id = extractAgentId(r.stdout)

  r = await server.cli(['skill', 'list', '--agent', id])
  expect(r.stdout).toContain('s1')
  expect(r.stdout).toContain('s2')
  expect(r.stdout).toContain('Test skill s1')
})

test('skill list --agent reports missing skills', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm', '--skills', 'ghost'])
  let r = await server.cli(['agent', 'spawn', '--profile', 'p'])
  const id = extractAgentId(r.stdout)

  r = await server.cli(['skill', 'list', '--agent', id])
  expect(r.stdout).toContain('missing: ghost')
})

function fixtureSkillsZip(skills: string[]): string {
  const zip = new AdmZip()
  for (const name of skills) {
    zip.addFile(
      `${name}/SKILL.md`,
      Buffer.from(`---\nname: ${name}\ndescription: Test skill ${name}.\n---\n\nbody of ${name}\n`),
    )
  }
  const dir = mkdtempSync(join(tmpdir(), 'bazilion-skill-zip-fixture-'))
  const zipPath = join(dir, 'skills.zip')
  zip.writeZip(zipPath)
  return zipPath
}

test('skill import --from <local.zip> uploads via multipart and installs every skill', async () => {
  const zipPath = fixtureSkillsZip(['zapha', 'zbeta'])

  let r = await server.cli(['skill', 'import', '--from', zipPath])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('imported zapha')
  expect(r.stdout).toContain('imported zbeta')

  r = await server.cli(['skill', 'list'])
  expect(r.stdout).toContain('zapha')
  expect(r.stdout).toContain('zbeta')
})
