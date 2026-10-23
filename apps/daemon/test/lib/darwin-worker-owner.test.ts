import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import type { DarwinProcessMember } from '../../src/lib/process/darwin.ts'
import { OwnedDarwinWorker } from '../../src/lib/process/worker.ts'

// Pure owner/control tests with injected process facts, not actual Darwin qualification.

const fixture = fileURLToPath(new URL('../fixtures/observed-worker.mjs', import.meta.url))
const children: ChildProcess[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'close')
  }
})
function worker(hostCommands: boolean) {
  const child = spawn(process.execPath, [fixture], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {},
  })
  children.push(child)
  child.stdout?.resume()
  child.stderr?.resume()
  const pid = child.pid
  if (!pid) throw new Error('fixture did not spawn')
  const members = new Map<number, DarwinProcessMember>([
    [
      pid,
      { pid, parent: process.pid, group: pid, session: pid, uid: 501, start: '1:2:3', state: '3' },
    ],
  ])
  const inspection = {
    member: (id: number) => {
      const member = members.get(id)
      return member ? { ...member } : null
    },
    group: () => [...members.values()].map((member) => ({ ...member })),
  }
  child.once('exit', () => members.delete(pid))
  return {
    child,
    owner: new OwnedDarwinWorker(pid, child, hostCommands, inspection),
    inspection,
    members,
  }
}

test('native worker receipts match only the exact live owner contract', () => {
  const { owner } = worker(true)
  expect(owner.matches(JSON.parse(JSON.stringify(owner.identity)))).toBe(true)
  for (const update of [
    { token: 'copied' },
    { start: '1:2:4' },
    { uid: 0 },
    { hostCommands: false },
    { extra: true },
  ])
    expect(owner.matches({ ...owner.identity, ...update })).toBe(false)
  expect(owner.matches(null)).toBe(false)
})

test('a coded worker failure may confirm cleanup without becoming a success verdict', async () => {
  const { child, owner } = worker(true)
  child.stdin?.end('fail\n')
  await once(child, 'close')
  expect(child.exitCode).toBe(1)
  expect(await owner.settled()).toBe(true)
})

test.each([
  false,
  true,
])('forced worker exit preserves the host-command limitation: %s', async (host) => {
  const { child, owner } = worker(host)
  owner.beforeSignal()
  child.kill('SIGTERM')
  await once(child, 'close')
  expect(await owner.settled()).toBe(!host)
})

test('a stored native receipt cannot replace the actual ChildProcess at admission', () => {
  const { owner, inspection } = worker(false)
  expect(
    () =>
      new OwnedDarwinWorker(
        owner.identity.pid,
        { pid: owner.identity.pid } as ChildProcess,
        false,
        inspection,
      ),
  ).toThrow('Live worker ownership unavailable')
})

test('Darwin worker birth reuse cannot authorize signalling or cleanup', async () => {
  const { owner, members } = worker(false)
  const member = members.get(owner.identity.pid)
  if (!member) throw new Error('missing controlled process')
  member.start = '1:2:4'
  const signal = vi.spyOn(process, 'kill')
  expect(await owner.settled()).toBe(false)
  expect(signal).not.toHaveBeenCalled()
})

test('Darwin worker anchor drift at the signalling boundary refuses escalation and release', async () => {
  const { owner, inspection } = worker(false)
  const member = inspection.member
  let calls = 0
  vi.spyOn(inspection, 'member').mockImplementation((pid) => {
    const current = member(pid)
    return ++calls === 4 && current ? { ...current, start: '1:2:4' } : current
  })
  const signal = vi.spyOn(process, 'kill')
  expect(await owner.settled()).toBe(false)
  expect(signal).not.toHaveBeenCalled()
})

test('unknown native inspection cannot authorize group signalling or release', async () => {
  const { child, owner, inspection } = worker(false)
  child.stdin?.end('finish\n')
  await once(child, 'close')
  vi.spyOn(inspection, 'member').mockImplementation(() => {
    throw new Error('inspection unavailable')
  })
  const signal = vi.spyOn(process, 'kill')
  expect(await owner.settled()).toBe(false)
  expect(signal).not.toHaveBeenCalled()
})
