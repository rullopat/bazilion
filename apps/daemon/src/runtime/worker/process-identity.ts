import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'

export interface WorkerProcessIdentity {
  pid: number
  startTicks: string
  bootId: string
  uid: number
  outputHandles: string[]
  /** Pi may start host shell commands in independently detached process groups. */
  hostCommands?: boolean
}
interface ProcessStat {
  pid: number
  group: number
  session: number
  startTicks: string
  state: string
}
function readStat(pid: number): ProcessStat | null {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = source
      .slice(source.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/)
    const startTicks = fields[19]
    if (!startTicks || !/^\d+$/.test(startTicks)) throw new Error('Invalid process identity')
    return {
      pid,
      state: fields[0] ?? '',
      group: Number(fields[2]),
      session: Number(fields[3]),
      startTicks,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
function bootId(): string {
  return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
}

/** Call on a freshly spawned detached worker, before delivering its executable turn input. */
export function captureWorkerProcess(pid: number): WorkerProcessIdentity {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
    throw new Error('Invalid worker PID')
  const stat = readStat(pid)
  if (!stat || stat.group !== pid || stat.session !== pid)
    throw new Error('Worker requires an isolated process group')
  const outputHandles = [1, 2]
    .map((fd) => readlinkSync(`/proc/${pid}/fd/${fd}`))
    .filter((target) => /^(?:pipe|socket):\[\d+\]$/.test(target))
  return {
    pid,
    startTicks: stat.startTicks,
    bootId: bootId(),
    uid: statSync(`/proc/${pid}`).uid,
    outputHandles: [...new Set(outputHandles)],
  }
}

/** A detached descendant can leave the group while retaining a worker's output endpoint. */
function outputsReleased(identity: WorkerProcessIdentity): boolean {
  if (!Array.isArray(identity.outputHandles) || !Number.isSafeInteger(identity.uid)) return false
  if (identity.outputHandles.some((handle) => !/^(?:pipe|socket):\[\d+\]$/.test(handle)))
    return false
  if (!identity.outputHandles.length) return true
  const entries = readdirSync('/proc')
  if (entries.length > 65536) return false
  let inspected = 0
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const stat = readStat(Number(entry))
      // Older processes cannot be descendants of this worker. In particular, unrelated
      // non-dumpable desktop services must not turn every completed turn into recovery.
      if (
        !stat ||
        stat.state === 'Z' ||
        stat.state === 'X' ||
        BigInt(stat.startTicks) < BigInt(identity.startTicks)
      )
        continue
      if (statSync(`/proc/${entry}`).uid !== identity.uid) continue
      for (const fd of readdirSync(`/proc/${entry}/fd`)) {
        if (++inspected > 65536) return false
        try {
          const target = readlinkSync(`/proc/${entry}/fd/${fd}`)
          if (!identity.outputHandles.includes(target)) continue
          if (target.startsWith('pipe:')) {
            const info = readFileSync(`/proc/${entry}/fdinfo/${fd}`, 'utf8')
            const flags = /^flags:\s+([0-7]+)$/m.exec(info)?.[1]
            if (!flags) return false
            if ((Number.parseInt(flags, 8) & 3) === 0) continue
          }
          return false
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
    }
  }
  return true
}

function members(identity: WorkerProcessIdentity): ProcessStat[] | null {
  const leader = readStat(identity.pid)
  // PID reuse must never make recovery signal an unrelated process.
  if (leader && leader.startTicks !== identity.startTicks) return null
  const entries = readdirSync('/proc')
  if (entries.length > 65536) throw new Error('Process inspection limit exceeded')
  const result: ProcessStat[] = []
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const stat = readStat(Number(entry))
    if (stat?.group !== identity.pid) continue
    if (stat.session !== identity.pid || BigInt(stat.startTicks) < BigInt(identity.startTicks))
      return null
    if (stat.state !== 'Z' && stat.state !== 'X') result.push(stat)
  }
  return result
}

/** Bound cleanup to the recorded boot/session/group. Unknown identity stays blocked. */
export async function terminateWorkerProcess(
  identity: WorkerProcessIdentity,
  observedNormalExit = false,
): Promise<boolean> {
  if (
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 1 ||
    identity.pid === process.pid ||
    !/^\d+$/.test(identity.startTicks)
  )
    return false
  try {
    if (identity.bootId !== bootId()) return true
    const initial = members(identity)
    if (initial === null) return false
    if (initial.length > 0) {
      try {
        process.kill(-identity.pid, 'SIGTERM')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
      }
    }
    const deadline = Date.now() + 3500
    let killed = false
    while (Date.now() < deadline) {
      const current = members(identity)
      if (current === null) return false
      if (current.length === 0 && outputsReleased(identity))
        return !identity.hostCommands || observedNormalExit
      if (!killed && Date.now() > deadline - 2500) {
        try {
          process.kill(-identity.pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
        }
        killed = true
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return false
  } catch {
    return false
  }
}
