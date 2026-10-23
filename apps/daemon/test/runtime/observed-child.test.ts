import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { ObservedChildWorker } from '../../src/runtime/worker/observed-child.ts'

const fixture = fileURLToPath(new URL('../fixtures/observed-worker.mjs', import.meta.url))
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'close')
  }
})
function worker(detached = true): ChildProcess {
  const child = spawn(process.execPath, [fixture], {
    detached,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin' },
  })
  children.push(child)
  child.stdout?.resume()
  child.stderr?.resume()
  return child
}

test('owned normal exit, natural output EOF and empty group settle together', async () => {
  const child = worker()
  const owner = new ObservedChildWorker(child.pid as number, child, true)
  expect(owner.matches(owner.identity)).toBe(true)
  expect(owner.exitObservation()).toEqual({ closed: false, codedExit: false, naturalEOF: false })
  child.stdin?.end('finish\n')
  await once(child, 'exit')
  expect(await owner.settled(true)).toBe(true)
  expect(owner.exitObservation()).toEqual({ closed: true, codedExit: true, naturalEOF: true })
})

test('coded nonzero exit is an observation, never a successful settlement verdict', async () => {
  const child = worker()
  const owner = new ObservedChildWorker(child.pid as number, child, false)
  child.stdin?.end('fail\n')
  await once(child, 'close')
  expect(child.exitCode).toBe(1)
  expect(owner.exitObservation()).toEqual({ closed: true, codedExit: true, naturalEOF: true })
  // The legacy observer's admission/settlement contract remains unchanged by fact extraction.
  expect(await owner.settled(true)).toBe(false)
})

test('a returned observation cannot mutate the retained live-child evidence', async () => {
  const child = worker()
  const owner = new ObservedChildWorker(child.pid as number, child, true)
  Object.assign(owner.exitObservation(), { closed: true, codedExit: true, naturalEOF: true })
  expect(owner.exitObservation()).toEqual({ closed: false, codedExit: false, naturalEOF: false })
  expect(await owner.settled(false)).toBe(false)
})

test('a delayed inherited output/group holder must settle before release', async () => {
  const child = worker()
  const owner = new ObservedChildWorker(child.pid as number, child, true)
  child.stdin?.end('holder\n')
  await once(child, 'exit')
  const start = Date.now()
  expect(await owner.settled(true)).toBe(true)
  expect(Date.now() - start).toBeGreaterThan(100)
})

test('a persisted or copied receipt is not live child authority', async () => {
  const child = worker()
  const owner = new ObservedChildWorker(child.pid as number, child, true)
  expect(owner.matches({ ...owner.identity, token: 'foreign' })).toBe(false)
  expect(owner.matches({ ...owner.identity, pid: process.pid })).toBe(false)
  expect(owner.matches({ ...owner.identity, hostCommands: false })).toBe(false)
  expect(await owner.settled(false)).toBe(false)
})

test('an attached child cannot masquerade as an isolated process group', () => {
  const child = worker(false)
  expect(() => new ObservedChildWorker(child.pid as number, child, true)).toThrow(
    'isolated process group',
  )
})

test('signalled exit remains unconfirmed and never signals a receipt PID', async () => {
  const child = worker()
  const owner = new ObservedChildWorker(child.pid as number, child, true)
  child.kill('SIGTERM')
  await once(child, 'close')
  expect(owner.exitObservation().closed).toBe(true)
  expect(owner.exitObservation().codedExit).toBe(false)
  expect(await owner.settled(true)).toBe(false)
})

test('locally destroyed output pipes do not prove remote EOF', async () => {
  const child = worker()
  const owner = new ObservedChildWorker(child.pid as number, child, true)
  child.stdout?.destroy()
  child.stderr?.destroy()
  child.stdin?.end('finish\n')
  await once(child, 'close')
  expect(owner.exitObservation().naturalEOF).toBe(false)
  expect(await owner.settled(true)).toBe(false)
})

test('unowned PID and missing child handles are refused before recording authority', () => {
  const child = worker()
  expect(() => new ObservedChildWorker(process.pid, child, true)).toThrow('ownership unavailable')
  expect(() => new ObservedChildWorker((child.pid as number) + 1, child, true)).toThrow(
    'ownership unavailable',
  )
})
