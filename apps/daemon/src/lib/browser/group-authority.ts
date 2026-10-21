// Live-launch-only signalling authority. A numeric process group is not a
// durable identity: it can be reused after its last member exits. Keep known
// birth identities, expand them only while an existing member still matches,
// and revoke authority on loss of identity or at the end of bounded cleanup.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

export type GroupMembers = Map<number, string>

/** Unknown inspection is never permission to signal. No disk owner marker input. */
function groupMembers(groupId: number): GroupMembers | undefined {
  try {
    const members: GroupMembers = new Map()
    if (process.platform === 'linux') {
      for (const name of readdirSync('/proc')) {
        if (!/^\d+$/.test(name)) continue
        let stat: string
        try {
          stat = readFileSync(`/proc/${name}/stat`, 'utf8')
        } catch (error) {
          if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
          return undefined
        }
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        // pgrp, session, starttime; zombies cannot retain a network capability.
        if (Number(fields[2]) !== groupId || Number(fields[3]) !== groupId) continue
        if (fields[0] === 'Z' || fields[0] === 'X') continue
        if (!fields[19]) return undefined
        members.set(Number(name), fields[19])
      }
      return members
    }
    if (process.platform === 'darwin') {
      const output = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], {
        encoding: 'utf8',
        timeout: 1_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      })
      for (const line of output.trim().split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
        const birth = match?.[3]
        if (!match || !birth) return undefined
        if (Number(match[2]) === groupId) members.set(Number(match[1]), birth)
      }
      return members
    }
  } catch {
    /* Unknown, fail closed. */
  }
  return undefined
}

export class OwnedGroupAuthority {
  private known: GroupMembers
  private revoked = false

  constructor(
    readonly groupId: number,
    private readonly inspect: (id: number) => GroupMembers | undefined = groupMembers,
    private readonly send: (id: number, signal: NodeJS.Signals) => void = (id, signal) => {
      process.kill(-id, signal)
    },
  ) {
    const initial = inspect(groupId)
    // The fresh detached child is the only initial authority. Never seed from
    // arbitrary descendants after the leader has already disappeared.
    const birth = initial?.get(groupId)
    this.known = birth ? new Map([[groupId, birth]]) : new Map()
    if (!birth) this.revoke()
  }

  refresh(): boolean {
    if (this.revoked) return false
    const current = this.inspect(this.groupId)
    if (!current) return false
    if (![...this.known].some(([pid, birth]) => current.get(pid) === birth)) {
      this.revoke()
      return false
    }
    this.known = current
    return true
  }

  signal(signal: NodeJS.Signals): void {
    if (!this.refresh()) return
    try {
      this.send(this.groupId, signal)
    } catch {
      /* Confirm exit separately. */
    }
  }

  revoke(): void {
    this.revoked = true
    this.known = new Map()
  }
}
