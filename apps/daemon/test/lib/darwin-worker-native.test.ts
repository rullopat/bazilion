import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import { getDarwinProcessInspector } from '../../src/lib/process/darwin.ts'
import { OwnedDarwinWorker } from '../../src/lib/process/worker.ts'

const mac = process.platform === 'darwin'
const children: { child: ChildProcess; closed: Promise<unknown> }[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const { child, closed } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await closed
  }
})

function worker(host: boolean, descendants = false) {
  getDarwinProcessInspector().assertReady()
  const fixture = fileURLToPath(
    new URL(
      descendants ? '../fixtures/owned-worker.mjs' : '../fixtures/observed-worker.mjs',
      import.meta.url,
    ),
  )
  const child = spawn(process.execPath, [fixture], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {},
  })
  const closed = once(child, 'close')
  children.push({ child, closed })
  child.stdout.resume()
  child.stderr.resume()
  if (!child.pid) throw new Error('Missing real child PID')
  const owner = new OwnedDarwinWorker(child.pid, child, host)
  return { child, owner, closed }
}

test.skipIf(!mac).each([
  ['finish', false, 0],
  ['finish', true, 0],
  ['fail', false, 1],
  ['fail', true, 1],
] as const)('native worker cleanup: %s / host %s / exit %s', async (mode, host, code) => {
  const { child, owner, closed } = worker(host)
  expect(owner.matches(JSON.parse(JSON.stringify(owner.identity)))).toBe(true)
  child.stdin.end(`${mode}\n`)
  await closed
  expect(child.exitCode).toBe(code)
  expect(await owner.settled()).toBe(true)
})

test.skipIf(!mac).each([false, true])(
  'native forced exit preserves host escape boundary: %s',
  async (host) => {
    const { child, owner, closed } = worker(host)
    owner.beforeSignal()
    child.kill('SIGKILL')
    await closed
    expect(await owner.settled()).toBe(!host)
  },
)

test.skipIf(!mac)(
  'native original descendant is retired after graceful leader exit and ignored TERM',
  async () => {
    const { child, owner, closed } = worker(true, true)
    const ready = once(child.stdout, 'data')
    child.stdin.write('start\n')
    const [data] = await ready
    const descendant = Number(JSON.parse(data.toString()).ready)
    const inspector = getDarwinProcessInspector()
    expect(inspector.group(child.pid as number).some((member) => member.pid === descendant)).toBe(
      true,
    )
    owner.beforeSignal()
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
    expect(child.exitCode).toBe(0)
    expect(await owner.settled()).toBe(true)
    await closed
    const remaining = inspector.member(descendant)
    expect(remaining === null || remaining.state === 'Z').toBe(true)
  },
)

test.skipIf(!mac)('native unknown descendant is never adopted after leader exit', async () => {
  const { child, owner, closed } = worker(false, true)
  const ready = once(child.stdout, 'data')
  child.stdin.write('start\n')
  await ready
  const exited = once(child, 'exit')
  child.stdin.end('exit\n')
  await exited
  const signal = vi.spyOn(process, 'kill')
  expect(await owner.settled()).toBe(false)
  expect(signal).not.toHaveBeenCalled()
  // The fixture expires naturally; neither a stored PID nor a failed settlement authorizes kill.
  await closed
  expect(await owner.settled()).toBe(false)
})

test.skipIf(!mac)('native empty group cannot substitute for naturally ended output', async () => {
  const { child, owner, closed } = worker(false)
  child.stdout.destroy()
  child.stderr.destroy()
  child.stdin.end('finish\n')
  await closed
  expect(await owner.settled()).toBe(false)
})
