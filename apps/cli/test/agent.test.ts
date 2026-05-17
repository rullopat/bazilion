import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// Scheduler disabled — this suite exercises agent-CRUD only (spawn / show /
// skill / move / archive / delete). Running the scheduler alongside adds
// tick-rate DB reads and potential background worker spawns for any
// leftover unread-inbox state from prior tests, which can push a busy
// full-suite run past the 30s per-test timeout.
let server: TestServer
beforeAll(async () => {
  server = await startTestServer({ BAZILION_SCHEDULER: 'off' })
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

test('scaffold profile, spawn three agents, inspect', async () => {
  let r = await server.cli([
    'profile',
    'create',
    'p',
    '--model',
    'anthropic:claude-opus-4-6',
    '--skills',
    's1,s2',
  ])
  expect(r.exitCode).toBe(0)

  await server.cli(['group', 'add', 'g1'])
  await server.cli(['group', 'add', 'g2'])

  // A1: group g1, default skills
  r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'A1', '--group', 'g1'])
  expect(r.exitCode).toBe(0)
  const id1 = extractAgentId(r.stdout)

  // A2: group g2, attach an extra skill post-spawn
  r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'A2', '--group', 'g2'])
  expect(r.exitCode).toBe(0)
  const id2 = extractAgentId(r.stdout)
  await server.cli(['agent', 'skill', 'add', id2, 'extra'])

  // A3: default-group fallback, default skills, model override
  r = await server.cli([
    'agent',
    'spawn',
    '--profile',
    'p',
    '--name',
    'A3',
    '--model',
    'openai:gpt-5',
  ])
  expect(r.exitCode).toBe(0)
  const id3 = extractAgentId(r.stdout)

  // List sees all three
  r = await server.cli(['agent', 'list'])
  expect(r.stdout).toContain('A1')
  expect(r.stdout).toContain('A2')
  expect(r.stdout).toContain('A3')

  // Show A1: inherits default skills s1,s2 and is in g1
  r = await server.cli(['agent', 'show', id1])
  expect(r.stdout).toContain('A1')
  expect(r.stdout).toContain('group:')
  expect(r.stdout).toContain('g1')
  expect(r.stdout).toContain('s1')
  expect(r.stdout).toContain('s2')

  // Show A2: has 'extra' skill, in g2
  r = await server.cli(['agent', 'show', id2])
  expect(r.stdout).toContain('extra')
  expect(r.stdout).toContain('g2')

  // Show A3: model override + lands in the seeded default group
  r = await server.cli(['agent', 'show', id3])
  expect(r.stdout).toContain('openai:gpt-5')
  expect(r.stdout).toContain('default')

  // Archive A3 → list excludes it by default
  r = await server.cli(['agent', 'archive', id3])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['agent', 'list'])
  expect(r.stdout).toContain('A1')
  expect(r.stdout).toContain('A2')
  expect(r.stdout).not.toContain('A3')

  // --all reveals it again
  r = await server.cli(['agent', 'list', '--all'])
  expect(r.stdout).toContain('A3')
})

test('agent skill add/rm on the fly', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  let r = await server.cli(['agent', 'spawn', '--profile', 'p'])
  const id = extractAgentId(r.stdout)

  await server.cli(['agent', 'skill', 'add', id, 'new-skill'])
  r = await server.cli(['agent', 'show', id])
  expect(r.stdout).toContain('new-skill')

  await server.cli(['agent', 'skill', 'rm', id, 'new-skill'])
  r = await server.cli(['agent', 'show', id])
  expect(r.stdout).not.toContain('new-skill')
})

test('agent lifecycle: spawn -> archive -> unarchive -> delete', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  let r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'lifecycle'])
  const id = extractAgentId(r.stdout)

  // archive -> hidden from default list, visible under --all
  r = await server.cli(['agent', 'archive', id])
  expect(r.exitCode).toBe(0)
  r = await server.cli(['agent', 'list'])
  expect(r.stdout).not.toContain('lifecycle')
  r = await server.cli(['agent', 'list', '--all'])
  expect(r.stdout).toContain('lifecycle')

  // unarchive -> back in default list
  r = await server.cli(['agent', 'unarchive', id])
  expect(r.exitCode).toBe(0)
  r = await server.cli(['agent', 'list'])
  expect(r.stdout).toContain('lifecycle')

  // double unarchive is rejected (already idle)
  r = await server.cli(['agent', 'unarchive', id])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('not archived')

  // delete -> gone completely
  r = await server.cli(['agent', 'delete', id])
  expect(r.exitCode).toBe(0)
  r = await server.cli(['agent', 'list', '--all'])
  expect(r.stdout).not.toContain('lifecycle')

  // second delete fails
  r = await server.cli(['agent', 'delete', id])
  expect(r.exitCode).not.toBe(0)
})

test('deleting an agent with a mailbox history succeeds', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  let r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'sender'])
  const a = extractAgentId(r.stdout)
  r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'receiver'])
  const b = extractAgentId(r.stdout)

  await server.cli(['send', a, b, 'hello'])
  await server.cli(['send', b, a, 'hi back'])

  // Delete the receiver — would fail before the FK-aware delete fix
  r = await server.cli(['agent', 'delete', b])
  expect(r.exitCode).toBe(0)

  // Sender still exists; their inbox is now empty (message from b was purged)
  r = await server.cli(['inbox', 'list', a])
  expect(r.stdout).toContain('(inbox empty)')
})

test('agent commands accept an unambiguous UUID prefix (8 chars)', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  const r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'prefixed'])
  const fullId = extractAgentId(r.stdout)
  const prefix = fullId.slice(0, 8)

  // show
  const show = await server.cli(['agent', 'show', prefix])
  expect(show.exitCode).toBe(0)
  expect(show.stdout).toContain('prefixed')

  // archive/unarchive via prefix
  const archR = await server.cli(['agent', 'archive', prefix])
  expect(archR.exitCode).toBe(0)
  const unarchR = await server.cli(['agent', 'unarchive', prefix])
  expect(unarchR.exitCode).toBe(0)

  // bogus prefix still 404s cleanly
  const bad = await server.cli(['agent', 'show', 'zzzzzzzz'])
  expect(bad.exitCode).not.toBe(0)
})

test('agent list short format shows 8-char prefix, --long shows full id + profile', async () => {
  await server.cli(['profile', 'create', 'myprofile', '--model', 'm'])
  const r = await server.cli(['agent', 'spawn', '--profile', 'myprofile', '--name', 'alpha'])
  const fullId = extractAgentId(r.stdout)

  const short = await server.cli(['agent', 'list'])
  expect(short.stdout).toContain(fullId.slice(0, 8))
  expect(short.stdout).toContain('alpha')
  // Short form omits the profile column
  expect(short.stdout).not.toContain('myprofile')

  const long = await server.cli(['agent', 'list', '--long'])
  expect(long.stdout).toContain(fullId)
  expect(long.stdout).toContain('myprofile')
})

test('agent move changes group membership', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  let r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'wanderer'])
  const id = extractAgentId(r.stdout)

  await server.cli(['group', 'add', 'elsewhere'])

  r = await server.cli(['agent', 'move', id, 'elsewhere'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['agent', 'show', id])
  expect(r.stdout).toContain('elsewhere')
})
