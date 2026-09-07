import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { resolvePaths } from '../../src/core/index.ts'
import { loadSessionHead } from '../../src/runtime/pi/session.ts'
import { seedConversationTarget } from '../fixtures/conversation.ts'

// Minimal ResolvedAgent shape loadSessionHead actually reads — we don't need
// a real spawn + provider wiring for this unit test, only the agent.id (used
// to resolve the session dir). loadSessionHead itself doesn't touch the
// team, but the type still requires it.
function fakeAgent(id: string, dir: string) {
  return {
    agent: { id, dir, name: id, status: 'idle' as const },
    team: { id: 'g', name: 'g', path: dir, userMd: '', createdAt: 0 },
    skills: [],
  } as unknown as Parameters<typeof loadSessionHead>[0]
}

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bazilion-session-head-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

test('returns {file:null, size:0} when no sessions dir exists (fresh agent)', () => {
  const paths = resolvePaths(home)
  mkdirSync(paths.agentsDir, { recursive: true })
  mkdirSync(join(paths.agentsDir, 'agent-a'), { recursive: true })

  const head = loadSessionHead(fakeAgent('agent-a', join(paths.agentsDir, 'agent-a')), paths)
  expect(head).toEqual({ file: null, size: 0 })
})

test('returns {file:null, size:0} when sessions dir is empty', () => {
  const paths = resolvePaths(home)
  mkdirSync(join(paths.agentsDir, 'agent-b', 'sessions'), { recursive: true })

  const head = loadSessionHead(fakeAgent('agent-b', join(paths.agentsDir, 'agent-b')), paths)
  expect(head).toEqual({ file: null, size: 0 })
})

test('head follows the explicit target despite newer unrelated files', () => {
  const paths = resolvePaths(home)
  const dir = join(paths.agentDir('agent-c'), 'sessions')
  const target = seedConversationTarget(dir, home)
  const file = join(dir, target.filename)
  const original = readFileSync(file, 'utf8')
  writeFileSync(join(dir, 'unrelated.jsonl'), 'untrusted discovery candidate')
  const future = new Date(Date.now() + 60_000)
  utimesSync(join(dir, 'unrelated.jsonl'), future, future)
  const agent = fakeAgent('agent-c', paths.agentDir('agent-c'))
  expect(loadSessionHead(agent, paths, target)).toEqual({
    file: target.filename,
    size: Buffer.byteLength(original),
  })
  expect(loadSessionHead(agent, paths)).toEqual({ file: null, size: 0 })
})

test('head reports append growth for the same canonical file', () => {
  const paths = resolvePaths(home)
  const dir = join(paths.agentDir('agent-e'), 'sessions')
  const target = seedConversationTarget(dir, home)
  const agent = fakeAgent('agent-e', paths.agentDir('agent-e'))
  const before = loadSessionHead(agent, paths, target)
  appendFileSync(
    join(dir, target.filename),
    JSON.stringify({ type: 'message', message: { role: 'user', content: 'hello' } }) + '\n',
  )
  const after = loadSessionHead(agent, paths, target)
  expect(after.file).toBe(before.file)
  expect(after.size).toBeGreaterThan(before.size)
})

test('missing or corrupt target fails instead of choosing another session', () => {
  const paths = resolvePaths(home)
  const dir = join(paths.agentDir('agent-f'), 'sessions')
  const target = seedConversationTarget(dir, home)
  seedConversationTarget(dir, home)
  const agent = fakeAgent('agent-f', paths.agentDir('agent-f'))
  writeFileSync(join(dir, target.filename), 'corrupt')
  expect(() => loadSessionHead(agent, paths, target)).toThrow()
  rmSync(join(dir, target.filename))
  expect(() => loadSessionHead(agent, paths, target)).toThrow()
})
