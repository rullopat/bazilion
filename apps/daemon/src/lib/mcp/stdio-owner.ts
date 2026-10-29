// Ownership retirement only, not MCP framing/client code. Do not invoke Pi's unguarded
// numeric-group close timers until its child handle is gone. Linux retains /proc inspection;
// macOS uses public libproc birth-time/session/group observations, never shell ps or stored PIDs.
import { opendirSync, readFileSync } from 'node:fs'
import { StdioTransport } from '@earendil-works/pi-mcp'
import { getDarwinProcessInspector } from '../process/darwin.ts'

interface Member {
  pid: number
  parent: number
  group: number
  session: number
  start: string
  state: string
  uid?: number
}
interface ProcessInspector {
  member(pid: number): Member | null
  group(pid: number): Member[]
}
function member(pid: number): Member | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/)
    if (
      fields.length < 20 ||
      !/^\d+$/.test(fields[19] ?? '') ||
      ![1, 2, 3].every((i) => Number.isSafeInteger(Number(fields[i])))
    )
      throw new Error('Invalid MCP process identity')
    return {
      pid,
      parent: Number(fields[1]),
      group: Number(fields[2]),
      session: Number(fields[3]),
      start: fields[19] ?? '',
      state: fields[0] ?? '',
    }
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code === 'ENOENT' ||
      (err as NodeJS.ErrnoException).code === 'ESRCH'
    )
      return null
    throw new Error('MCP process ownership cannot be inspected')
  }
}
function group(pid: number): Member[] {
  const dir = opendirSync('/proc')
  const members: Member[] = []
  let count = 0
  try {
    for (;;) {
      const entry = dir.readSync()
      if (!entry) break
      if (++count > 16_384) throw new Error('MCP process inspection over budget')
      if (!/^\d+$/.test(entry.name)) continue
      const m = member(Number(entry.name))
      if (m?.group === pid && m.session === pid && !['Z', 'X'].includes(m.state)) members.push(m)
    }
  } finally {
    dir.closeSync()
  }
  return members
}
function inspectorForStdio(): ProcessInspector {
  if (process.platform === 'linux') return { member, group }
  if (process.platform === 'darwin') {
    const inspector = getDarwinProcessInspector()
    inspector.assertReady()
    return inspector
  }
  throw new Error(
    'MCP stdio requires Linux or macOS with owned process-tree retirement; use Streamable HTTP on this platform.',
  )
}
export function assertStdioPlatform(): void {
  inspectorForStdio()
}

export class OwnedStdioTransport extends StdioTransport {
  private leader: Member | null = null
  private ownedPid?: number
  private retirement?: Promise<void>
  private inspection?: ProcessInspector
  private admissionStarted = false
  private retirementPhase:
    | 'idle'
    | 'admission'
    | 'inventory'
    | 'owner_check'
    | 'signal_anchor'
    | 'term'
    | 'term_wait'
    | 'kill'
    | 'kill_wait'
    | 'handle_wait'
    | 'sdk_close'
    | 'settled' = 'idle'
  /** Closed diagnostic facts only: no PID, command, path, credential or cleanup authority. */
  retirementObservation() {
    return Object.freeze({ phase: this.retirementPhase })
  }
  override async start(): Promise<void> {
    if (this.admissionStarted || this.retirement)
      throw new Error('MCP stdio transport already started or retired')
    this.admissionStarted = true
    this.inspection = inspectorForStdio()
    // Capture before yielding: another daemon child cannot be spawned/reaped into
    // this pid between the native spawn and our initial identity admission.
    const starting = super.start()
    let error: unknown
    if (this.pid !== undefined) {
      this.ownedPid = this.pid
      try {
        this.leader = this.inspection.member(this.pid)
        if (
          !this.leader ||
          this.leader.parent !== process.pid ||
          this.leader.group !== this.pid ||
          this.leader.session !== this.pid
        )
          throw new Error('MCP subprocess ownership unknown')
      } catch (e) {
        error = e
      }
    }
    await starting
    if (error) throw error
  }
  override close(): Promise<void> {
    this.retirement ??= this.retire()
    return this.retirement
  }
  private async retire(): Promise<void> {
    this.retirementPhase = 'admission'
    if (this.ownedPid === undefined || !this.inspection) {
      // No admitted native child means no numeric-group signalling is safe. Native close is
      // harmless only if Pi has no child handle (e.g. refusal before spawn or a failed spawn).
      if (this.pid !== undefined) throw new Error('MCP subprocess ownership unknown')
      this.retirementPhase = 'sdk_close'
      await super.close()
      this.retirementPhase = 'settled'
      return
    }
    const inspection = this.inspection
    const pid = this.ownedPid
    const leader = this.leader
    this.retirementPhase = 'inventory'
    let survivors = inspection.group(pid)
    if (survivors.length) {
      this.retirementPhase = 'owner_check'
      const current = leader ? inspection.member(pid) : null
      if (
        !leader ||
        !current ||
        current.start !== leader.start ||
        current.uid !== leader.uid ||
        current.group !== pid ||
        current.session !== pid
      )
        throw new Error('MCP process ownership unknown; retirement required')
      const anchored = survivors
      const signal = (kind: NodeJS.Signals) => {
        this.retirementPhase = 'signal_anchor'
        const anchor = anchored.find((a) => {
          const now = inspection.member(a.pid)
          return (
            now &&
            now.start === a.start &&
            now.uid === a.uid &&
            now.group === pid &&
            now.session === pid &&
            !['Z', 'X'].includes(now.state)
          )
        })
        if (!anchor) throw new Error('MCP process ownership changed; retirement required')
        try {
          this.retirementPhase = kind === 'SIGTERM' ? 'term' : 'kill'
          process.kill(-pid, kind)
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ESRCH')
            throw new Error('MCP process retirement failed')
        }
      }
      signal('SIGTERM')
      this.retirementPhase = 'term_wait'
      const grace = performance.now() + 500
      while (survivors.length && performance.now() < grace) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        survivors = inspection.group(pid)
      }
      if (survivors.length) signal('SIGKILL')
      this.retirementPhase = 'kill_wait'
      const deadline = performance.now() + 2000
      while (survivors.length && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        survivors = inspection.group(pid)
      }
      if (survivors.length) throw new Error('MCP process retirement did not settle')
    }
    // Pi's child close callback clears pid before emitting transport close. Only
    // then is native close incapable of signaling a later reused numeric group.
    this.retirementPhase = 'handle_wait'
    const deadline = performance.now() + 2000
    while (this.pid !== undefined && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10))
    if (this.pid !== undefined) throw new Error('MCP native process handle has not retired')
    this.retirementPhase = 'sdk_close'
    await super.close()
    this.retirementPhase = 'settled'
  }
}
