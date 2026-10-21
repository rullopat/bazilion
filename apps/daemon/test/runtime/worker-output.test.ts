import { spawn } from 'node:child_process'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { WorkerOutput } from '../../src/runtime/worker/output.ts'

const fixture = fileURLToPath(new URL('../fixtures/worker-drain-entry.ts', import.meta.url))
const content = '日本語🌍'.repeat(160_000)

async function childOutput(mode: string) {
  const child = spawn(process.execPath, ['--experimental-strip-types', fixture, mode], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH },
  })
  const chunks: Buffer[] = []
  const closed = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code))
  })
  let resume: ReturnType<typeof setTimeout> | undefined
  if (mode !== 'blocked') {
    child.stderr.once('data', () => {
      if (mode === 'cancel') child.kill('SIGTERM')
      // The fixture has queued its large frame. Force actual backpressure
      // before the parent begins consuming, even on a slow test machine.
      resume = setTimeout(() => child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk)), 100)
    })
  }
  const limit = setTimeout(() => child.kill('SIGKILL'), 8_000)
  try {
    const code = await closed
    return { code, text: Buffer.concat(chunks).toString('utf8') }
  } finally {
    clearTimeout(limit)
    clearTimeout(resume)
    child.kill('SIGKILL')
    child.stdout.destroy()
    child.stderr.destroy()
  }
}

test.each([
  'done',
  'fatal',
  'cancel',
])('bounded output drain preserves large %s frames with a slow reader', async (mode) => {
  const result = await childOutput(mode)
  expect(result.code).toBe(mode === 'fatal' ? 1 : 0)
  const frames = result.text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  if (mode === 'done')
    expect(frames).toEqual([{ kind: 'done', messages: [{ role: 'assistant', content }] }])
  else if (mode === 'fatal') expect(frames).toEqual([{ kind: 'fatal', error: content }])
  else
    expect(frames).toEqual([
      { kind: 'event', event: { type: 'assistant_delta', delta: content } },
      { kind: 'event', event: { type: 'error', error: 'cancelled' } },
    ])
}, 12_000)

test('a blocked protocol reader cannot pin the worker or produce a successful exit', async () => {
  const result = await childOutput('blocked')
  expect(result.code).toBe(1)
}, 12_000)

test('output errors fail draining without an unhandled error or payload disclosure', async () => {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('EPIPE'))
    },
  })
  const output = new WorkerOutput(stream)
  output.write('private fixture bytes\n')
  expect(await output.finish(100)).toBe(false)
})

test('drain seals late output and repeated finish calls share one bounded result', async () => {
  const writes: string[] = []
  let unblock: (() => void) | undefined
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(chunk.toString())
      unblock = () => callback()
    },
  })
  const output = new WorkerOutput(stream)
  output.write('first\n')
  const result = output.finish(20)
  expect(output.finish(10_000)).toBe(result)
  output.write('too late\n')
  expect(await result).toBe(false)
  expect(writes).toEqual(['first\n'])
  unblock?.()
  stream.destroy()
})
