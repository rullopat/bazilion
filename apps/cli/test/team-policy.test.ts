import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
let scratch: string

beforeAll(async () => {
  server = await startTestServer()
  scratch = mkdtempSync(join(tmpdir(), 'bazilion-teamPolicy-cli-'))
})
afterAll(async () => {
  await server.stop()
  rmSync(scratch, { recursive: true, force: true })
})
beforeEach(() => server.reset())

async function profile(id: string): Promise<void> {
  const result = await server.cli(['profile', 'create', id, '--model', 'lmstudio:test-model'])
  expect(result.exitCode).toBe(0)
}

function file(name: string, value: unknown): string {
  const path = join(scratch, name)
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}

test('Team import requires review/apply, allocates server ids, and exports portable JSON', async () => {
  await profile('worker')
  const document = {
    version: 1,
    kind: 'bazilion.team-template',
    template: { id: 'ops', name: 'Ops', userMd: null },
    slots: [
      {
        key: 'lead',
        profileId: 'worker',
        agentName: 'Lead',
        modelOverride: null,
        reasoningLevel: null,
        layoutPosition: null,
        display: null,
      },
      {
        key: 'peer',
        profileId: 'worker',
        agentName: 'Peer',
        modelOverride: null,
        reasoningLevel: null,
        layoutPosition: null,
        display: null,
      },
    ],
    edges: [
      {
        sourceKind: 'slot',
        sourceKey: 'lead',
        targetKind: 'slot',
        targetKey: 'peer',
      },
    ],
  }
  const path = file('team.json', document)
  let result = await server.cli(['team-template', 'import', path, '--dry-run'])
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('valid: no changes applied')

  result = await server.cli(['team-template', 'import', path])
  expect(result.exitCode).toBe(2)
  expect(result.stderr).toContain('refusing mutation')

  result = await server.cli(['team-template', 'import', path, '--apply'])
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('created Team ops at revision 1')

  result = await server.cli(['team-template', 'export', 'ops'])
  expect(result.exitCode).toBe(0)
  const exported = JSON.parse(result.stdout) as typeof document
  expect(exported).toMatchObject({
    version: 1,
    kind: 'bazilion.team-template',
    template: document.template,
    slots: document.slots.map(({ key: _key, ...slot }, index) => ({
      key: `slot-${index + 1}`,
      ...slot,
    })),
  })
  expect(exported.edges).toEqual([
    {
      sourceKind: 'slot',
      sourceKey: 'slot-1',
      targetKind: 'slot',
      targetKey: 'slot-2',
      posture: 'allow',
    },
  ])
  expect(result.stdout).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/)

  result = await server.cli(['team-template', 'show', 'ops', '--json'])
  const aggregate = JSON.parse(result.stdout) as { slots: Array<{ slotId: string }> }
  expect(aggregate.slots.every((slot) => /^[0-9a-f-]{36}$/.test(slot.slotId))).toBe(true)
})

test('existing Team replacement requires an expected revision and stale writes fail', async () => {
  await profile('worker')
  const path = file('replace.json', {
    version: 1,
    kind: 'bazilion.team-template',
    template: { id: 'replace', name: 'Replace', userMd: null },
    slots: [
      {
        key: 'slot-1',
        profileId: 'worker',
        agentName: 'One',
        modelOverride: null,
        reasoningLevel: null,
        layoutPosition: null,
        display: null,
      },
    ],
    edges: [],
  })
  expect((await server.cli(['team-template', 'import', path, '--apply'])).exitCode).toBe(0)

  let result = await server.cli(['team-template', 'import', path, '--apply'])
  expect(result.exitCode).toBe(2)
  expect(result.stderr).toContain('--expected-revision is required')

  result = await server.cli([
    'team-template',
    'import',
    path,
    '--apply',
    '--expected-revision',
    '99',
  ])
  expect(result.exitCode).toBe(3)
  expect(result.stderr).toContain('template_revision_conflict')

  result = await server.cli(['team-template', 'import', path, '--apply', '--force'])
  expect(result.exitCode).toBe(2)
  expect(result.stderr).toContain('--confirm-current-revision 1')

  result = await server.cli([
    'team-template',
    'import',
    path,
    '--apply',
    '--force',
    '--confirm-current-revision',
    '1',
  ])
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('updated Team replace')
})

test('Team policy dry-run/apply is revision-safe and diagnostic evaluation creates no block', async () => {
  const exported = await server.cli(['team', 'policy', 'export', 'default'])
  expect(exported.exitCode).toBe(0)
  const document = JSON.parse(exported.stdout) as {
    expectedRevision: number
    edges: unknown[]
  }
  const path = file('team.json', document)
  let result = await server.cli(['team', 'policy', 'import', 'default', path, '--dry-run'])
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('valid: no changes applied')

  result = await server.cli(['team', 'policy', 'import', 'default', path, '--apply'])
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('updated Team default policy')

  result = await server.cli(['team', 'policy', 'import', 'default', path, '--apply'])
  expect(result.exitCode).toBe(3)
  expect(result.stderr).toContain('team_revision_conflict')

  result = await server.cli([
    'team',
    'policy',
    'evaluate',
    'default',
    '--source',
    'user',
    '--target',
    'agent:missing',
    '--json',
  ])
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({
    decision: 'deny',
    reasonCode: 'agent_not_found',
  })

  const blocks = await server.cli(['team', 'policy', 'blocks', 'default', '--json'])
  expect(blocks.exitCode).toBe(0)
  expect(JSON.parse(blocks.stdout)).toEqual({ blocks: [], nextCursor: null })
})

test('invalid interchange fails with a non-zero exit and no mutation', async () => {
  const path = file('invalid.json', {
    version: 99,
    kind: 'bazilion.team-template',
    template: { id: 'invalid', name: 'Invalid', userMd: null },
    slots: [],
    edges: [],
  })
  const result = await server.cli(['team-template', 'import', path, '--apply'])
  expect(result.exitCode).toBe(2)
  expect(result.stderr).toContain('unsupported Team Policy document version')
  const list = await server.cli(['team-template', 'list', '--json'])
  expect(JSON.parse(list.stdout)).toEqual([])
})

test('authentication failures have a stable automation exit code', async () => {
  const result = await server.cli(['team', 'list'], { BAZILION_TOKEN: 'invalid-token' })
  expect(result.exitCode).toBe(4)
  expect(result.stderr).toContain('token mismatch')
  expect(result.stdout).not.toContain('invalid-token')
})
