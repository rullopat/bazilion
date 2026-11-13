import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { readSessionFile, readSessionHeader } from '../../src/runtime/pi/session-file.ts'
import { deliverFileTool } from '../../src/runtime/tools/deliver-file.ts'

// Bounded reads: deliver_file's workspace read and the session-file reader.

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
  const path = mkdtempSync(join(tmpdir(), 'baz-reads-'))
  directories.push(path)
  return path
}
afterEach(() => {
  hooks.afterStat = undefined
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

test('deliver_file rejects a file that grows beyond the cap after fstat', async () => {
  const workspace = temporary()
  const file = join(workspace, 'report.txt')
  writeFileSync(file, 'small')
  hooks.afterStat = () => writeFileSync(file, Buffer.alloc(25 * 1024 * 1024 + 1, 65))
  const sink = vi.fn()
  await expect(
    deliverFileTool(workspace, sink).invoke({ path: 'report.txt' }, { toolCallId: 'call' }),
  ).rejects.toThrow(/25 MB|25 MiB|too large/)
  expect(sink).not.toHaveBeenCalled()
})

test('deliver_file reports a storage refusal instead of a saved result', async () => {
  const workspace = temporary()
  writeFileSync(join(workspace, 'report.txt'), 'report')
  const sink = vi.fn().mockRejectedValue(new Error('Result storage is full (1 GiB)'))
  await expect(
    deliverFileTool(workspace, sink).invoke({ path: 'report.txt' }, { toolCallId: 'call' }),
  ).rejects.toThrow('storage is full')
})

test('session files: symlinks and foreign headers are refused; a line still being written is left out', () => {
  const directory = join(temporary(), 'sessions')
  mkdirSync(directory)
  const id = randomUUID()
  const header = `${JSON.stringify({ type: 'session', id })}\n`
  const outside = join(temporary(), 'outside.jsonl')
  writeFileSync(outside, header)
  const linked = randomUUID()
  symlinkSync(outside, join(directory, `${linked}.jsonl`))
  expect(() => readSessionFile(directory, linked)).toThrow()
  expect(() => readSessionHeader(directory, linked)).toThrow()

  const file = join(directory, `${id}.jsonl`)
  writeFileSync(file, `${header}{"type":"message","id":"a"}\n{"type":"mes`)
  expect(readSessionFile(directory, id).map((entry) => entry.type)).toEqual(['session', 'message'])
  // Growth after the size was read is ignored, not an error.
  hooks.afterStat = () =>
    writeFileSync(file, `${header}{"type":"message","id":"b"}\n`, { flag: 'a' })
  expect(readSessionFile(directory, id)).toHaveLength(2)
  readSessionHeader(directory, id)
  expect(() => readSessionHeader(directory, randomUUID())).toThrow()
  writeFileSync(file, `${JSON.stringify({ type: 'session', id: randomUUID() })}\n`)
  expect(() => readSessionFile(directory, id)).toThrow('does not belong')
  expect(() => readSessionFile(directory, '../escape')).toThrow('Invalid conversation id')
})
