import { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export interface ObservedChildIdentity {
  kind: 'observed-posix-child'
  pid: number
  token: string
  hostCommands?: boolean
}

/**
 * A live daemon-owned ChildProcess is authority; the persisted receipt is not.
 * This conservative POSIX observer admits only normal exit, natural EOF on both
 * output pipes and an absent original process group. It never signals recorded PIDs.
 * Restart/restore, forced transport closure and unknown descendants remain blocked.
 * Linux continues to use its existing /proc identity and retirement implementation.
 */
export class ObservedChildWorker {
  readonly identity: ObservedChildIdentity
  private closeObserved = false
  private closedNormally = false

  constructor(
    pid: number,
    private readonly child: ChildProcess,
    hostCommands: boolean,
  ) {
    if (
      (process.platform !== 'darwin' && process.platform !== 'linux') ||
      !(child instanceof ChildProcess) ||
      !Number.isSafeInteger(pid) ||
      pid <= 1 ||
      pid === process.pid ||
      child.pid !== pid ||
      child.spawnfile !== process.execPath ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      !child.stdout ||
      !child.stderr
    )
      throw new Error('Live worker ownership unavailable')
    // The spawner uses detached:true. Never admit a worker lacking its isolated group.
    try {
      process.kill(-pid, 0)
    } catch {
      throw new Error('Worker requires an isolated process group')
    }
    this.identity = Object.freeze({
      kind: 'observed-posix-child',
      pid,
      token: randomUUID(),
      hostCommands,
    })
    child.once('close', (code, signal) => {
      // destroy()/local transport retirement is not remote endpoint EOF.
      this.closeObserved = true
      this.closedNormally =
        code === 0 &&
        signal === null &&
        child.stdout?.readableEnded === true &&
        child.stderr?.readableEnded === true
    })
  }

  matches(identity: ObservedChildIdentity): boolean {
    return (
      identity.kind === this.identity.kind &&
      identity.pid === this.identity.pid &&
      identity.token === this.identity.token &&
      identity.hostCommands === this.identity.hostCommands
    )
  }

  async settled(observedNormalExit: boolean): Promise<boolean> {
    if (!observedNormalExit) return false
    const deadline = Date.now() + 3500
    while (Date.now() < deadline) {
      if (this.closedNormally) {
        try {
          process.kill(-this.identity.pid, 0)
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === 'ESRCH'
        }
      }
      if (
        (this.closeObserved && !this.closedNormally) ||
        this.child.signalCode !== null ||
        (this.child.exitCode ?? 0) !== 0
      )
        return false
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return false
  }
}
