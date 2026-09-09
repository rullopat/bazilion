import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, expect, test, vi } from 'vitest'
import {
  captureWorkerProcess,
  terminateWorkerProcess,
} from '../../src/runtime/worker/process-identity.ts'

const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {}
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  }
})
async function worker(descendant = false) {
  const source = descendant
    ? `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log('ready'); setInterval(()=>{},1000)`
    : `console.log('ready'); setInterval(()=>{},1000)`
  const child = spawn(process.execPath, ['-e', source], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  children.push(child)
  if (!child.stdout) throw new Error('No worker stdout')
  await once(child.stdout, 'data')
  if (!child.pid) throw new Error('No worker PID')
  return { child, identity: captureWorkerProcess(child.pid) }
}

test('terminates a recorded detached worker and its inherited process group', async () => {
  const { child, identity } = await worker(true)
  expect(await terminateWorkerProcess(identity)).toBe(true)
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  expect(child.signalCode).not.toBeNull()
  expect(await terminateWorkerProcess(identity)).toBe(true)
})

test('a mismatched process start time stays blocked without signalling the current process', async () => {
  const { child, identity } = await worker()
  expect(await terminateWorkerProcess({ ...identity, startTicks: '1' })).toBe(false)
  expect(child.exitCode).toBeNull()
  expect(child.signalCode).toBeNull()
  expect(await terminateWorkerProcess(identity)).toBe(true)
})

test('a detached holder of worker output prevents cleanup confirmation after the worker exits', async () => {
  const source = `
    const {spawn}=require('node:child_process');
    const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});
    console.log(descendant.pid);
    process.stdin.once('data',()=>process.exit(0));
  `
  const child = spawn(process.execPath, ['-e', source], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  if (!child.stdout || !child.pid) throw new Error('No worker stdout/PID')
  const [chunk] = await once(child.stdout, 'data')
  const descendant = Number(String(chunk).trim())
  const identity = captureWorkerProcess(child.pid)
  try {
    const exited = once(child, 'exit')
    child.stdin?.end('exit')
    await exited
    expect(await terminateWorkerProcess(identity)).toBe(false)
    process.kill(descendant, 0)
    process.kill(-descendant, 'SIGKILL')
    await vi.waitFor(async () => expect(await terminateWorkerProcess(identity)).toBe(true))
  } finally {
    try {
      process.kill(-descendant, 'SIGKILL')
    } catch {}
    child.stdout?.destroy()
    child.stderr?.destroy()
  }
})

test('rejects the daemon itself and treats an earlier boot as already terminated', async () => {
  expect(() => captureWorkerProcess(process.pid)).toThrow()
  const { child, identity } = await worker()
  expect(await terminateWorkerProcess({ ...identity, bootId: 'earlier-machine-boot' })).toBe(true)
  expect(child.signalCode).toBeNull()
  expect(await terminateWorkerProcess(identity)).toBe(true)
})

test('host-command cleanup requires an observed normal exit or proof of a different boot', async () => {
  const { child, identity } = await worker()
  const host = { ...identity, hostCommands: true }
  expect(await terminateWorkerProcess(host)).toBe(false)
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  expect(child.signalCode).not.toBeNull()
  expect(await terminateWorkerProcess(host)).toBe(false)
  expect(await terminateWorkerProcess(host, true)).toBe(true)
  expect(await terminateWorkerProcess({ ...host, bootId: 'earlier-boot' })).toBe(true)
})
