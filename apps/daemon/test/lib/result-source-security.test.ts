import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import { readResultSession } from '../../src/lib/result-source.ts'
import { deliverFileTool } from '../../src/runtime/tools/deliver-file.ts'

const hooks = vi.hoisted(() => ({ afterStat: undefined as (() => void) | undefined }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    fstatSync: (...args: Parameters<typeof fs.fstatSync>) => {
      const stat = fs.fstatSync(...args)
      const hook = hooks.afterStat
      hooks.afterStat = undefined
      hook?.()
      return stat
    },
  }
})
const directories: string[] = []
function temporary() {
  const path = mkdtempSync(join(tmpdir(), 'baz034-source-'))
  directories.push(path)
  return path
}
afterEach(() => {
  hooks.afterStat = undefined
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

test('actual-byte enforcement rejects a file that grows beyond the cap after fstat', async () => {
  const workspace = temporary()
  const file = join(workspace, 'report.txt')
  writeFileSync(file, 'small')
  hooks.afterStat = () => writeFileSync(file, Buffer.alloc(25 * 1024 * 1024 + 1, 65))
  const sink = vi.fn()
  await expect(
    deliverFileTool(workspace, sink, 'session').invoke(
      { path: 'report.txt' },
      { toolCallId: 'call' },
    ),
  ).rejects.toThrow(/25 MB|25 MiB|too large/)
  expect(sink).not.toHaveBeenCalled()
})

test('storage rejection never returns a successful durable reference', async () => {
  const workspace = temporary()
  writeFileSync(join(workspace, 'report.txt'), 'report')
  const sink = vi.fn().mockRejectedValue(new Error('Result storage is full (1 GiB)'))
  await expect(
    deliverFileTool(workspace, sink, 'session').invoke(
      { path: 'report.txt' },
      { toolCallId: 'call' },
    ),
  ).rejects.toThrow('storage is full')
})

test('source display and publication reject file and owner-directory symlinks', () => {
  const paths = resolvePaths(temporary())
  const owner = randomUUID()
  const sessionId = randomUUID()
  const directory = join(paths.agentDir(owner), 'sessions')
  mkdirSync(directory, { recursive: true })
  const outside = temporary()
  const file = join(outside, 'outside.jsonl')
  writeFileSync(file, `${JSON.stringify({ type: 'session', id: sessionId })}\n`)
  symlinkSync(file, join(directory, 'linked.jsonl'))
  expect(() => readResultSession(paths, owner, 'linked.jsonl', sessionId)).toThrow()
  rmSync(directory, { recursive: true })
  symlinkSync(outside, directory)
  expect(() => readResultSession(paths, owner, 'outside.jsonl', sessionId)).toThrow('escaped')
})

test('source reads reject a concurrent append and a substituted session header', () => {
  const paths = resolvePaths(temporary())
  const owner = randomUUID()
  const sessionId = randomUUID()
  const directory = join(paths.agentDir(owner), 'sessions')
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'current.jsonl')
  const header = `${JSON.stringify({ type: 'session', id: sessionId })}\n`
  writeFileSync(file, header)
  hooks.afterStat = () => writeFileSync(file, `${header}{"extra":true}\n`)
  expect(() => readResultSession(paths, owner, 'current.jsonl', sessionId)).toThrow('changed')
  expect(() => readResultSession(paths, owner, 'current.jsonl', randomUUID())).toThrow(
    'does not match',
  )
})
