import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { resolvePaths } from '../../src/core/index.ts'
import { loadSessionHead } from '../../src/runtime/pi/session.ts'

// Minimal ResolvedAgent shape loadSessionHead actually reads — we don't need
// a real spawn + provider wiring for this unit test, only the agent.id (used
// to resolve the session dir). loadSessionHead itself doesn't touch the
// group, but the type still requires it.
function fakeAgent(id: string, dir: string) {
  return {
    agent: { id, dir, name: id, status: 'idle' as const },
    group: { id: 'g', name: 'g', path: dir, userMd: '', createdAt: 0 },
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

test('returns the newest .jsonl basename + its byte size', () => {
  const paths = resolvePaths(home)
  const sessionDir = join(paths.agentsDir, 'agent-c', 'sessions')
  mkdirSync(sessionDir, { recursive: true })

  writeFileSync(join(sessionDir, 'old.jsonl'), 'old entry\n', 'utf8')
  const now = Date.now() / 1000
  // Backdate 'old' so 'newer' is unambiguously most-recent regardless of the
  // order mkdir stamps mtime.
  utimesSync(join(sessionDir, 'old.jsonl'), now - 60, now - 60)

  const newerContent = '{"type":"session"}\n{"type":"message"}\n'
  writeFileSync(join(sessionDir, 'newer.jsonl'), newerContent, 'utf8')

  const head = loadSessionHead(fakeAgent('agent-c', join(paths.agentsDir, 'agent-c')), paths)
  expect(head.file).toBe('newer.jsonl')
  expect(head.size).toBe(Buffer.byteLength(newerContent, 'utf8'))
})

test('ignores non-jsonl files in the sessions dir', () => {
  const paths = resolvePaths(home)
  const sessionDir = join(paths.agentsDir, 'agent-d', 'sessions')
  mkdirSync(sessionDir, { recursive: true })

  writeFileSync(join(sessionDir, 'README.md'), 'not a session\n', 'utf8')
  writeFileSync(join(sessionDir, '.DS_Store'), 'mac junk', 'utf8')
  writeFileSync(join(sessionDir, 'real.jsonl'), 'entry\n', 'utf8')

  const head = loadSessionHead(fakeAgent('agent-d', join(paths.agentsDir, 'agent-d')), paths)
  expect(head.file).toBe('real.jsonl')
})

test('size grows monotonically as entries are appended — matches poll signal', () => {
  const paths = resolvePaths(home)
  const sessionDir = join(paths.agentsDir, 'agent-e', 'sessions')
  mkdirSync(sessionDir, { recursive: true })
  const file = join(sessionDir, 'session.jsonl')
  writeFileSync(file, 'a\n', 'utf8')

  const head1 = loadSessionHead(fakeAgent('agent-e', join(paths.agentsDir, 'agent-e')), paths)
  // simulate pi appending another entry — ordinary append, no rename
  writeFileSync(file, 'a\nb\n', 'utf8')
  const head2 = loadSessionHead(fakeAgent('agent-e', join(paths.agentsDir, 'agent-e')), paths)

  expect(head1.file).toBe('session.jsonl')
  expect(head2.file).toBe('session.jsonl')
  expect(head2.size).toBeGreaterThan(head1.size)
})
