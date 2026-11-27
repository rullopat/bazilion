import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  createJobHost,
  jobDetail,
  listJobs,
  recoverJobs,
  runningJobCount,
  stopAllJobs,
  stopJob,
} from '../../src/lib/jobs.ts'
import { _resetWakesForTest, agentsWithWakes, takeWakes } from '../../src/lib/wakes.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let workspace: string
beforeEach(() => {
  env = makeTestEnv()
  workspace = join(env.home, 'team')
  mkdirSync(workspace, { recursive: true })
  _resetWakesForTest()
})
afterEach(async () => {
  await stopAllJobs(env.paths)
  _resetWakesForTest()
  env.cleanup()
})

function host(agentId = 'a1') {
  return createJobHost({
    paths: env.paths,
    agentId,
    conversationId: 'conversation-1',
    host: { cwd: workspace, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } },
  })
}

test('a job runs past its call; job_output waits for new output and its end', async () => {
  const jobs = host()
  const started = await jobs.start({ command: 'echo first; read line; echo "got $line"' })
  expect(started.job).toMatchObject({ status: 'running', sandbox: 'host', cwd: workspace })
  expect(runningJobCount('a1')).toBe(1)

  const first = await jobs.output({ id: started.job.id, waitSeconds: 5 })
  expect(first.output + started.output).toContain('first')
  await jobs.input({ id: started.job.id, text: 'hello\n' })
  const end = await jobs.output({ id: started.job.id, waitSeconds: 5 })
  expect(end.output).toContain('got hello')
  // Read to the end, so the exit is known too.
  const last = await jobs.output({ id: started.job.id, waitSeconds: 5 })
  expect(last.job).toMatchObject({ status: 'exited', exitCode: 0 })
  expect(runningJobCount('a1')).toBe(0)
  // The Agent saw its end: no wake.
  expect(takeWakes('a1')).toEqual([])
})

test('a job that ends unseen wakes its Agent in its conversation, with the end of its output', async () => {
  const jobs = host()
  const { job } = await jobs.start({ command: 'echo built; exit 3' })
  await waitFor(() => listJobs(env.paths, 'a1')[0]?.status === 'exited')
  expect(agentsWithWakes()).toEqual(['a1'])
  const [wake] = takeWakes('a1')
  expect(wake).toMatchObject({ conversationId: 'conversation-1' })
  expect(wake?.summary).toBe(`Background job ${job.id} ended with exit code 3`)
  expect(wake?.text).toContain('built')
  expect(wake?.text).toContain('`echo built; exit 3`')
})

test('interrupt stops a job as Ctrl-C would; job_stop stops one without waking anyone', async () => {
  const jobs = host()
  const sleeper = await jobs.start({
    command: 'trap "echo interrupted; exit 130" INT; sleep 30 & wait',
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  await jobs.input({ id: sleeper.job.id, interrupt: true })
  await waitFor(
    () => listJobs(env.paths, 'a1').find((j) => j.id === sleeper.job.id)?.status !== 'running',
  )
  expect(jobDetail(env.paths, sleeper.job.id)?.output).toContain('interrupted')
  takeWakes('a1')

  const server = await jobs.start({ command: 'sleep 30' })
  const stopped = await jobs.stop({ id: server.job.id })
  expect(stopped).toMatchObject({ status: 'stopped', stoppedBy: 'agent', exitCode: null })
  expect(takeWakes('a1')).toEqual([])
  await expect(jobs.input({ id: server.job.id, text: 'x' })).rejects.toThrow(/was stopped by you/)
})

test('a job stopped by the owner wakes its Agent; another Agent cannot reach it', async () => {
  const { job } = await host().start({ command: 'sleep 30' })
  await expect(host('a2').stop({ id: job.id })).rejects.toThrow(/no job/)
  await expect(host('a2').output({ id: job.id })).rejects.toThrow(/no job/)
  await stopJob(env.paths, job.id, 'owner')
  expect(listJobs(env.paths, 'a1')[0]).toMatchObject({ status: 'stopped', stoppedBy: 'owner' })
  expect(takeWakes('a1')[0]?.summary).toBe(`Background job ${job.id} was stopped by the user`)
})

test('at startup a job a previous daemon left is stopped and its Agent is told', () => {
  const dir = join(env.paths.agentDir('a1'), 'jobs', 'job-0000beef')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'output.log'), 'half done\n')
  writeFileSync(
    join(dir, 'job.json'),
    JSON.stringify({
      id: 'job-0000beef',
      agentId: 'a1',
      conversationId: 'conversation-1',
      command: 'make all',
      cwd: workspace,
      sandbox: 'host',
      status: 'running',
      exitCode: null,
      stoppedBy: null,
      startedAt: 1,
      endedAt: null,
      // A process that no longer exists: nothing to stop, nothing else is touched.
      pid: 999_999,
      pidStartedAt: 'never',
      readOffset: 0,
      endSeen: false,
    }),
  )
  recoverJobs(env.paths)
  expect(JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8'))).toMatchObject({
    status: 'stopped',
    stoppedBy: 'restart',
  })
  const [wake] = takeWakes('a1')
  expect(wake?.summary).toBe(
    'Background job job-0000beef was stopped when Bazilion stopped or restarted',
  )
  expect(wake?.text).toContain('half done')
  expect(readdirSync(join(env.paths.agentDir('a1'), 'jobs'))).toEqual(['job-0000beef'])
})

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('timed out waiting')
}
