import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TeamPolicy, TeamTemplate } from '@bazilion/api-types'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
let scratch: string

beforeAll(async () => {
  server = await startTestServer()
  scratch = mkdtempSync(join(tmpdir(), 'bazilion-team-policy-cli-'))
})
afterAll(async () => {
  await server.stop()
  rmSync(scratch, { recursive: true, force: true })
})
beforeEach(() => server.reset())

async function ok(args: string[]): Promise<string> {
  const result = await server.cli(args)
  expect(result.exitCode, result.stderr).toBe(0)
  return result.stdout
}

function file(name: string, value: unknown): string {
  const path = join(scratch, name)
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}

async function policy(team: string): Promise<TeamPolicy> {
  return JSON.parse(await ok(['team', 'policy', 'show', team, '--json'])) as TeamPolicy
}

test('team policy sets the mode and adds or removes edges by member name or outside', async () => {
  await ok(['profile', 'create', 'worker', '--model', 'lmstudio:test-model'])
  await ok(['team', 'add', 'ops'])
  const lead = extractAgentId(
    await ok(['agent', 'spawn', '--profile', 'worker', '--team', 'ops', '--name', 'lead']),
  )
  const peer = extractAgentId(
    await ok(['agent', 'spawn', '--profile', 'worker', '--team', 'ops', '--name', 'peer']),
  )
  expect(await policy('ops')).toMatchObject({ mode: 'open', edges: [] })

  expect(await ok(['team', 'policy', 'mode', 'ops', 'restricted'])).toContain('restricted')
  expect(await ok(['team', 'policy', 'allow', 'ops', 'lead', 'peer'])).toContain(
    'allowed lead -> peer',
  )
  await ok(['team', 'policy', 'allow', 'ops', 'peer', 'outside'])
  expect(await policy('ops')).toMatchObject({
    mode: 'restricted',
    edges: expect.arrayContaining([
      { from: lead, to: peer },
      { from: peer, to: 'outside' },
    ]),
  })
  const shown = await ok(['team', 'policy', 'show', 'ops'])
  expect(shown).toContain('mode:    restricted')
  expect(shown).toMatch(/peer\s+outside/)

  expect(await ok(['team', 'policy', 'allow', 'ops', 'lead', 'peer'])).toContain(
    'lead -> peer is already allowed',
  )
  expect(await ok(['team', 'policy', 'deny', 'ops', 'lead', 'peer'])).toContain(
    'removed lead -> peer',
  )
  expect((await policy('ops')).edges).toEqual([{ from: peer, to: 'outside' }])
  expect(await ok(['team', 'policy', 'deny', 'ops', 'lead', 'peer'])).toContain(
    'no edge lead -> peer; nothing changed',
  )
  expect((await policy('ops')).edges).toEqual([{ from: peer, to: 'outside' }])
  expect(
    (await server.cli(['team', 'policy', 'allow', 'ops', 'lead', 'nobody'])).exitCode,
  ).not.toBe(0)
  expect((await server.cli(['team', 'policy', 'mode', 'ops', 'closed'])).exitCode).not.toBe(0)
})

test('team-template create, import, export, spawn, save and rm cover the template lifecycle', async () => {
  await ok(['profile', 'create', 'worker', '--model', 'lmstudio:test-model'])
  expect(await ok(['team-template', 'create', 'empty', '--name', 'Empty'])).toContain(
    'created Team template empty',
  )
  const document = {
    id: 'pair',
    name: 'Pair',
    userMd: '# Pair',
    policyMode: 'restricted',
    slots: [
      { profileId: 'worker', agentName: 'Lead' },
      { profileId: 'worker', agentName: 'Peer' },
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 'outside' },
    ],
  }
  expect(await ok(['team-template', 'import', file('pair.json', document)])).toContain(
    'created Team template pair (2 slots, 2 edges)',
  )
  expect(
    await ok(['team-template', 'import', file('pair.json', { ...document, name: 'Pair v2' })]),
  ).toContain('replaced Team template pair')
  expect(JSON.parse(await ok(['team-template', 'export', 'pair']))).toMatchObject({
    ...document,
    name: 'Pair v2',
  })
  const listed = JSON.parse(await ok(['team-template', 'list', '--json'])) as TeamTemplate[]
  expect(listed.map((template) => template.id).sort()).toEqual(['empty', 'pair'])

  expect(await ok(['team-template', 'spawn', 'pair', 'duo'])).toContain(
    'spawned 2 agent(s) into Team duo: Lead, Peer',
  )
  const duo = await policy('duo')
  expect(duo.mode).toBe('restricted')
  expect(duo.edges).toHaveLength(2)

  expect(await ok(['team-template', 'save', 'duo', 'duo-copy', '--name', 'Duo copy'])).toContain(
    'saved Team duo as template duo-copy (2 slots)',
  )
  const copy = JSON.parse(await ok(['team-template', 'show', 'duo-copy', '--json'])) as TeamTemplate
  expect(copy).toMatchObject({ userMd: '# Pair', policyMode: 'restricted', edges: document.edges })

  await ok(['team-template', 'rm', 'pair'])
  expect((await server.cli(['team-template', 'show', 'pair'])).exitCode).not.toBe(0)
  expect((await policy('duo')).members).toHaveLength(2)
})

test('an invalid template document is refused without creating anything', async () => {
  const result = await server.cli([
    'team-template',
    'import',
    file('bad.json', { id: 'bad', name: 'Bad', slots: [{ profileId: 'missing', agentName: 'x' }] }),
  ])
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr + result.stdout).toMatch(/profile not found: missing/)
  expect(JSON.parse(await ok(['team-template', 'list', '--json']))).toEqual([])
})
