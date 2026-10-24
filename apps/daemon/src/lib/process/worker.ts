import type { ChildProcess } from 'node:child_process'
import { ObservedChildWorker } from '../../runtime/worker/observed-child.ts'
import {
  type DarwinProcessInspector,
  type DarwinProcessMember,
  getDarwinProcessInspector,
} from './darwin.ts'

export interface DarwinWorkerIdentity {
  kind: 'owned-darwin-child'
  pid: number
  token: string
  start: string
  uid: number
  hostCommands: boolean
}
type Inspection = Pick<DarwinProcessInspector, 'member' | 'group'>

/**
 * Daemon-only live authority. A JSON receipt cannot construct this owner: admission needs the
 * actual freshly spawned ChildProcess plus native parent/birth/session/group observations before
 * executable input. Original descendants may become signalling anchors only while that child is
 * live. This is not arbitrary detached-host-writer containment or restored-PID recovery.
 */
export class OwnedDarwinWorker {
  readonly identity: Readonly<DarwinWorkerIdentity>
  private readonly observation: ObservedChildWorker
  private readonly anchors = new Map<number, DarwinProcessMember>()
  private settlement?: Promise<boolean>

  constructor(
    pid: number,
    private readonly child: ChildProcess,
    hostCommands: boolean,
    private readonly inspection: Inspection = getDarwinProcessInspector(),
  ) {
    this.observation = new ObservedChildWorker(pid, child, hostCommands)
    const member = inspection.member(pid)
    if (
      !member ||
      member.parent !== process.pid ||
      member.group !== pid ||
      member.session !== pid ||
      member.state === 'Z'
    )
      throw new Error('Native worker ownership unavailable')
    this.identity = Object.freeze({
      kind: 'owned-darwin-child',
      pid,
      token: this.observation.identity.token,
      start: member.start,
      uid: member.uid,
      hostCommands,
    })
    this.anchors.set(pid, { ...member })
  }

  matches(identity: unknown): boolean {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return false
    const record = identity as Record<string, unknown>
    return (
      Object.keys(record).length === 6 &&
      record.kind === this.identity.kind &&
      record.pid === this.identity.pid &&
      record.token === this.identity.token &&
      record.start === this.identity.start &&
      record.uid === this.identity.uid &&
      record.hostCommands === this.identity.hostCommands
    )
  }

  private originalLeader(member: DarwinProcessMember | null): boolean {
    return (
      member !== null &&
      member.pid === this.identity.pid &&
      member.start === this.identity.start &&
      member.uid === this.identity.uid &&
      member.group === this.identity.pid &&
      member.session === this.identity.pid &&
      member.state !== 'Z'
    )
  }

  /** Called before the spawner signals its own live ChildProcess, never from receipt-only cleanup. */
  beforeSignal(): void {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    try {
      const before = this.inspection.member(this.identity.pid)
      if (!this.originalLeader(before) || before?.parent !== process.pid) return
      const members = this.inspection.group(this.identity.pid)
      const after = this.inspection.member(this.identity.pid)
      if (!this.originalLeader(after) || after?.parent !== process.pid || members.length > 16_384)
        return
      this.anchors.clear()
      this.anchors.set(this.identity.pid, { ...after })
      for (const member of members) {
        if (
          member.group === this.identity.pid &&
          member.session === this.identity.pid &&
          member.state !== 'Z'
        )
          this.anchors.set(member.pid, { ...member })
      }
    } catch {
      // Failed inspection grants no group authority. The spawner still owns its live direct
      // child; any unknown descendants/EOF keep workspace cleanup unconfirmed below.
    }
  }

  private originalAnchor(member: DarwinProcessMember): boolean {
    const anchor = this.anchors.get(member.pid)
    return (
      anchor !== undefined &&
      member.start === anchor.start &&
      member.uid === anchor.uid &&
      member.group === this.identity.pid &&
      member.session === this.identity.pid &&
      member.state !== 'Z'
    )
  }

  private signalGroup(signal: NodeJS.Signals, members: DarwinProcessMember[]): boolean {
    const anchor = members.find((member) => this.originalAnchor(member))
    if (!anchor) return false
    const current = this.inspection.member(anchor.pid)
    if (!current || !this.originalAnchor(current))
      throw new Error('Native worker signalling anchor changed')
    try {
      process.kill(-this.identity.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    return true
  }

  settled(): Promise<boolean> {
    this.settlement ??= this.waitForSettlement()
    return this.settlement
  }

  private async waitForSettlement(): Promise<boolean> {
    const deadline = Date.now() + 3500
    let termAt: number | undefined
    let killed = false
    try {
      // A consumer can stop before exit. Capture anchors only if the original child is still
      // live; after an observed exit, previously unknown members never become signal targets.
      this.beforeSignal()
      while (Date.now() < deadline) {
        const leader = this.inspection.member(this.identity.pid)
        if (leader && leader.state !== 'Z' && !this.originalLeader(leader)) return false
        const members = this.inspection.group(this.identity.pid)
        const observation = this.observation.exitObservation()
        if (!members.length && observation.closed) {
          // A coded nonzero exit is still an executor failure, not a leaked writer. Conversely,
          // killing a host-command worker cannot prove independently detached host work stopped.
          return observation.naturalEOF && (!this.identity.hostCommands || observation.codedExit)
        }
        if (members.length) {
          if (termAt === undefined) {
            if (this.signalGroup('SIGTERM', members)) termAt = Date.now()
          } else if (!killed && Date.now() - termAt >= 500) {
            killed = this.signalGroup('SIGKILL', members)
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    } catch {
      return false
    }
    return false
  }
}
