// Background jobs. An Agent's `bash` with `background: true` asks the daemon, which owns them past
// the turn, to start a command: on the host as its own process group, in Docker as a container of
// the turn's image and mounts. A job runs until it ends, the Agent stops it or the owner does; no
// clock ends it. Its record and output are files in the Agent's folder (`jobs/<id>/job.json` and
// `output.log`), so a restart can still say what became of it. When one ends and the Agent has not
// seen it end, the end wakes the Agent in the conversation that started it.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Job, JobDetail } from '@bazilion/api-types'
import { truncateTail } from '@earendil-works/pi-coding-agent'
import type { Paths } from '../core/index.ts'
import {
  type DockerSandbox,
  dockerRunArgs,
  dockerSpawnEnv,
  removeDockerContainers,
  signalDockerContainer,
} from '../runtime/shell/docker.ts'
import type { JobHost, JobOutputResult } from '../runtime/worker/ipc-protocol.ts'
import { signalLiveChange } from './live-signal.ts'
import { queueWake } from './wakes.ts'

/** How long a stopped host job gets to end after SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 3_000
/** How often a waiting `job_output` looks for new output. Shapes latency only. */
const POLL_MS = 200

/** What job.json holds: the job, and what the daemon needs to keep it. */
interface JobRecord extends Job {
  /** Host jobs: the process group leader, and its start time to recognise it after a crash. */
  pid?: number
  pidStartedAt?: string
  /** Docker jobs: the container's name. */
  container?: string
  /** Bytes of output.log the Agent has read. */
  readOffset: number
  /** The Agent saw that it ended, in a turn or because its end woke it. */
  endSeen: boolean
}

interface Live {
  agentId: string
  child: ChildProcess
  stopping?: Job['stoppedBy']
}

const KEY = Symbol.for('bazilion.jobs')
function live(): Map<string, Live> {
  const holder = globalThis as unknown as Record<symbol, Map<string, Live> | undefined>
  holder[KEY] ??= new Map()
  return holder[KEY]
}

const jobsDir = (paths: Paths, agentId: string) => join(paths.agentDir(agentId), 'jobs')
const jobDir = (paths: Paths, agentId: string, id: string) => join(jobsDir(paths, agentId), id)
const logPath = (paths: Paths, record: Pick<Job, 'agentId' | 'id'>) =>
  join(jobDir(paths, record.agentId, record.id), 'output.log')

function save(paths: Paths, record: JobRecord): void {
  const dir = jobDir(paths, record.agentId, record.id)
  const file = join(dir, 'job.json')
  writeFileSync(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}

function load(paths: Paths, agentId: string, id: string): JobRecord | null {
  try {
    return JSON.parse(readFileSync(join(jobDir(paths, agentId, id), 'job.json'), 'utf8'))
  } catch {
    return null
  }
}

function update(paths: Paths, record: JobRecord, change: Partial<JobRecord>): JobRecord {
  const next = { ...record, ...change }
  save(paths, next)
  return next
}

function publicJob(record: JobRecord): Job {
  return {
    id: record.id,
    agentId: record.agentId,
    conversationId: record.conversationId,
    command: record.command,
    cwd: record.cwd,
    sandbox: record.sandbox,
    status: record.status,
    exitCode: record.exitCode,
    stoppedBy: record.stoppedBy,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
  }
}

/** How many of the Agent's jobs are running. */
export function runningJobCount(agentId: string): number {
  let count = 0
  for (const entry of live().values()) if (entry.agentId === agentId) count++
  return count
}

/** The Agent's jobs, newest first. */
export function listJobs(paths: Paths, agentId: string): Job[] {
  const dir = jobsDir(paths, agentId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((id) => load(paths, agentId, id))
    .filter((record): record is JobRecord => record !== null)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(publicJob)
}

/** A job of any Agent, by its id. */
function findJob(paths: Paths, id: string): JobRecord | null {
  if (!/^job-[0-9a-f]+$/.test(id) || !existsSync(paths.agentsDir)) return null
  for (const agentId of readdirSync(paths.agentsDir)) {
    const record = load(paths, agentId, id)
    if (record) return record
  }
  return null
}

/** Bytes `[from, to)` of a job's output, as text. */
function readLog(paths: Paths, record: JobRecord, from: number, to: number): string {
  if (to <= from) return ''
  const fd = openSync(logPath(paths, record), 'r')
  try {
    const buffer = Buffer.alloc(to - from)
    let read = 0
    while (read < buffer.length) {
      const count = readSync(fd, buffer, read, buffer.length - read, from + read)
      if (count === 0) break
      read += count
    }
    return buffer.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function logSize(paths: Paths, record: JobRecord): number {
  return statSync(logPath(paths, record), { throwIfNoEntry: false })?.size ?? 0
}

/** The end of a job's output, as the web and CLI show it. */
export function jobDetail(paths: Paths, id: string): JobDetail | null {
  const record = findJob(paths, id)
  if (!record) return null
  const tail = truncateTail(readLog(paths, record, 0, logSize(paths, record)))
  return { ...publicJob(record), output: tail.content, outputCut: tail.truncated }
}

function ended(record: JobRecord): string {
  if (record.status === 'exited') return `ended with exit code ${record.exitCode}`
  if (record.stoppedBy === 'agent') return 'was stopped by you'
  if (record.stoppedBy === 'owner') return 'was stopped by the user'
  return 'was stopped when Bazilion stopped or restarted'
}

/** Wake the Agent with the job's end, unless it sees the end in a turn first. */
function queueEndWake(paths: Paths, record: JobRecord): void {
  const tail = truncateTail(readLog(paths, record, 0, logSize(paths, record)))
  const output = tail.content.trim()
  queueWake({
    id: `job:${record.id}`,
    agentId: record.agentId,
    conversationId: record.conversationId,
    summary: `Background job ${record.id} ${ended(record)}`,
    text: [
      `Background job ${record.id} (\`${record.command}\`, in ${record.cwd}) ${ended(record)}.`,
      output
        ? `The end of its output${tail.truncated ? '' : ' (all of it)'}:\n\n\`\`\`\n${output}\n\`\`\``
        : 'It printed nothing.',
    ].join('\n\n'),
    at: Date.now(),
    stillWanted: () => !(load(paths, record.agentId, record.id)?.endSeen ?? true),
    onFired: () => {
      const current = load(paths, record.agentId, record.id)
      if (current) update(paths, current, { endSeen: true })
    },
  })
}

function finish(paths: Paths, id: string, agentId: string, exitCode: number | null): void {
  const record = load(paths, agentId, id)
  const entry = live().get(id)
  live().delete(id)
  if (record?.status !== 'running') return
  const stoppedBy = entry?.stopping ?? null
  const next = update(paths, record, {
    status: stoppedBy ? 'stopped' : 'exited',
    exitCode: stoppedBy ? null : exitCode,
    stoppedBy,
    endedAt: Date.now(),
  })
  // Stopped by the Agent: it knows. Otherwise its end wakes it, unless it reads it first.
  if (stoppedBy !== 'agent') queueEndWake(paths, next)
  signalLiveChange()
}

function processStartTime(pid: number): string | undefined {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

export interface JobTurn {
  paths: Paths
  agentId: string
  conversationId: string
  /** Host mode: the Team workspace and the turn's tool environment. */
  host?: { cwd: string; env: NodeJS.ProcessEnv }
  /** Docker mode: the turn's container, evaluated when a job starts, and the job name prefix. */
  docker?: { sandbox: () => DockerSandbox; namePrefix: string }
}

/** Start a job; it is running (or already ended) when this returns. */
export function startJob(turn: JobTurn, command: string): JobRecord {
  const { paths, agentId } = turn
  const id = `job-${randomBytes(4).toString('hex')}`
  const dir = jobDir(paths, agentId, id)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const log = openSync(join(dir, 'output.log'), 'a', 0o600)
  let child: ChildProcess
  let record: JobRecord
  const base = {
    id,
    agentId,
    conversationId: turn.conversationId,
    command,
    status: 'running' as const,
    exitCode: null,
    stoppedBy: null,
    startedAt: Date.now(),
    endedAt: null,
    readOffset: 0,
    endSeen: false,
  }
  try {
    if (turn.docker) {
      const sandbox = turn.docker.sandbox()
      const container = `${turn.docker.namePrefix}${id.slice(4)}`
      // `-i` keeps stdin open for job_input; the client stays attached, so its end is the job's.
      const args = dockerRunArgs(sandbox, container, command)
      args.splice(1, 0, '--interactive')
      child = spawn('docker', args, {
        env: dockerSpawnEnv(sandbox),
        detached: true,
        stdio: ['pipe', log, log],
      })
      record = { ...base, cwd: sandbox.workdir, sandbox: 'docker', container }
    } else if (turn.host) {
      child = spawn('/bin/bash', ['-c', command], {
        cwd: turn.host.cwd,
        env: turn.host.env,
        detached: true,
        stdio: ['pipe', log, log],
      })
      record = { ...base, cwd: turn.host.cwd, sandbox: 'host' }
      if (child.pid) {
        const startedAt = processStartTime(child.pid)
        record = { ...record, pid: child.pid, ...(startedAt ? { pidStartedAt: startedAt } : {}) }
      }
    } else {
      throw new Error('a job needs a host or a Docker turn')
    }
  } finally {
    closeSync(log)
  }
  save(paths, record)
  live().set(id, { agentId, child })
  child.stdin?.on('error', () => {})
  child.once('error', (error) => {
    writeFileSync(join(dir, 'output.log'), `\n[could not start: ${error.message}]\n`, { flag: 'a' })
    finish(paths, id, agentId, null)
  })
  child.once('exit', (code) => finish(paths, id, agentId, code))
  signalLiveChange()
  return record
}

function running(paths: Paths, agentId: string, id: string): { record: JobRecord; entry: Live } {
  const record = load(paths, agentId, id)
  if (!record) throw new Error(`There is no job ${id}; job_list lists yours.`)
  const entry = live().get(id)
  if (record.status !== 'running' || !entry) throw new Error(`Job ${id} ${ended(record)}.`)
  return { record, entry }
}

/** Stop a job: the group gets SIGTERM, then SIGKILL; a container is removed. */
export async function stopJob(
  paths: Paths,
  id: string,
  by: NonNullable<Job['stoppedBy']>,
  agentId?: string,
): Promise<Job> {
  const record = agentId ? load(paths, agentId, id) : findJob(paths, id)
  if (!record) throw new Error(`There is no job ${id}.`)
  const entry = live().get(id)
  if (record.status !== 'running' || !entry) return publicJob(record)
  entry.stopping = by
  const exited = new Promise<void>((resolve) => {
    if (entry.child.exitCode !== null || entry.child.signalCode !== null) resolve()
    else entry.child.once('exit', () => resolve())
  })
  if (record.container) {
    // A job stopped right after it started may have no container yet: remove until its client
    // ends, and end the client itself after the grace period.
    const container = record.container
    let done = false
    void exited.then(() => {
      done = true
    })
    const timer = setTimeout(() => entry.child.kill('SIGKILL'), STOP_GRACE_MS)
    while (!done) {
      await removeDockerContainers(container)
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, POLL_MS))])
    }
    clearTimeout(timer)
    await removeDockerContainers(container)
  } else if (record.pid) {
    signalGroup(record.pid, 'SIGTERM')
    const timer = setTimeout(() => signalGroup(record.pid ?? 0, 'SIGKILL'), STOP_GRACE_MS)
    await exited
    clearTimeout(timer)
  }
  await exited
  return publicJob(load(paths, record.agentId, id) ?? record)
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  if (pid <= 0) return
  try {
    process.kill(-pid, signal)
  } catch {
    // Already gone.
  }
}

/** Unread output of a job, waiting up to `waitSeconds` for some, or for its end. */
async function readOutput(
  paths: Paths,
  agentId: string,
  id: string,
  waitSeconds: number | undefined,
  signal?: AbortSignal,
): Promise<JobOutputResult> {
  let record = load(paths, agentId, id)
  if (!record) throw new Error(`There is no job ${id}; job_list lists yours.`)
  const deadline = Date.now() + Math.max(0, waitSeconds ?? 0) * 1000
  while (
    record.status === 'running' &&
    logSize(paths, record) <= record.readOffset &&
    Date.now() < deadline &&
    !signal?.aborted
  ) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    record = load(paths, agentId, id) ?? record
  }
  const size = logSize(paths, record)
  const tail = truncateTail(readLog(paths, record, record.readOffset, size))
  record = update(paths, record, {
    readOffset: size,
    ...(record.status !== 'running' ? { endSeen: true } : {}),
  })
  return { job: publicJob(record), output: tail.content, cut: tail.truncated }
}

/** The job host of one turn: its Agent's jobs, new ones in its conversation. */
export function createJobHost(turn: JobTurn): JobHost {
  const { paths, agentId } = turn
  return {
    async start({ command }) {
      const record = startJob(turn, command)
      // What it printed in its first moment, if anything; the Agent reads on with job_output.
      return readOutput(paths, agentId, record.id, 0)
    },
    async list() {
      const jobs = listJobs(paths, agentId)
      // Listing a job that ended counts as seeing its end.
      for (const job of jobs) {
        const record = load(paths, agentId, job.id)
        if (record && record.status !== 'running' && !record.endSeen) {
          update(paths, record, { endSeen: true })
        }
      }
      return jobs
    },
    output: ({ id, waitSeconds }, signal) => readOutput(paths, agentId, id, waitSeconds, signal),
    async input({ id, text, interrupt }) {
      const { record, entry } = running(paths, agentId, id)
      if (text) {
        if (!entry.child.stdin?.writable) throw new Error(`Job ${id} does not read its input.`)
        entry.child.stdin.write(text)
      }
      if (interrupt) {
        if (record.container) await signalDockerContainer(record.container, 'INT')
        else if (record.pid) signalGroup(record.pid, 'SIGINT')
      }
      return publicJob(record)
    },
    stop: ({ id }) => stopJob(paths, id, 'agent', agentId),
  }
}

/** Every running job of this daemon, stopped (the daemon is stopping). */
export async function stopAllJobs(paths: Paths): Promise<void> {
  await Promise.all(
    [...live().keys()].map((id) => stopJob(paths, id, 'restart').catch(() => undefined)),
  )
}

/**
 * At startup: a job a previous daemon left running is stopped (a host process group that is
 * still the same process; Docker containers were removed already), and every job whose end its
 * Agent has not seen wakes it again.
 */
export function recoverJobs(paths: Paths): void {
  if (!existsSync(paths.agentsDir)) return
  for (const agentId of readdirSync(paths.agentsDir)) {
    const dir = jobsDir(paths, agentId)
    if (!existsSync(dir)) continue
    for (const id of readdirSync(dir)) {
      let record = load(paths, agentId, id)
      if (!record || live().has(id)) continue
      if (record.status === 'running') {
        if (
          record.pid &&
          record.pidStartedAt &&
          processStartTime(record.pid) === record.pidStartedAt
        ) {
          signalGroup(record.pid, 'SIGKILL')
        }
        record = update(paths, record, {
          status: 'stopped',
          stoppedBy: 'restart',
          endedAt: Date.now(),
        })
      }
      if (!record.endSeen) queueEndWake(paths, record)
    }
  }
}
