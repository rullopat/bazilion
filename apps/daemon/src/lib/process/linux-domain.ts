import { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  getLinuxPidfdCalls,
  inspectLinuxProcess,
  LinuxOwnershipError,
  type LinuxPidfdCalls,
  type LinuxProcessFact,
} from './linux.ts'

export interface LinuxDomainReceipt {
  readonly kind: 'owned-linux-pid-domain'
  readonly token: string
}
const owners = new WeakSet<object>()
export function isOwnedLinuxNamespace(value: unknown): value is OwnedLinuxNamespace {
  return typeof value === 'object' && value !== null && owners.has(value)
}
const live = (fact: LinuxProcessFact | null): fact is LinuxProcessFact =>
  fact !== null && !['Z', 'X', 'x'].includes(fact.state)
function sameBirth(a: LinuxProcessFact, b: LinuxProcessFact | null): b is LinuxProcessFact {
  return (
    b !== null &&
    a.pid === b.pid &&
    a.start === b.start &&
    a.uid === b.uid &&
    a.group === b.group &&
    a.session === b.session
  )
}

/**
 * Daemon-private authority, never reconstructed from a receipt. The original direct child and
 * its private Bubblewrap status FD bind a namespace-init pidfd while both processes are live.
 * Only the original manager's birth/group-bound pidfd can signal. The status-derived init handle
 * is death evidence only; neither it nor a receipt/census PID becomes a signal target.
 * Policy/filesystem admission and canonical workspace-resource registration remain separate.
 */
export class OwnedLinuxNamespace {
  readonly receipt: LinuxDomainReceipt
  /** Trusted sandboxed-entry plus namespace/birth acknowledgement, not tool admission. */
  readonly ready: Promise<void>
  private readonly child: ChildProcess
  private readonly channel: Readable
  private readonly calls: LinuxPidfdCalls
  private readonly root: LinuxProcessFact
  private readonly rootFd: number
  private readonly parent: LinuxProcessFact
  private init?: { fact: LinuxProcessFact; fd: number }
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private timer: ReturnType<typeof setTimeout>
  private buffer = ''
  private bytes = 0
  private frames = 0
  private entryBuffer = ''
  private entrySeen = false
  private readonly entryMarker: string
  private initialStatus: Record<string, unknown> | undefined
  private acknowledged = false
  private invalid = false
  private statusEnded = false
  private childClosed = false
  private naturalEOF = false
  private exitFrame: number | undefined
  private closed = false
  private termination?: Promise<boolean>
  private signalGuard: ((action: 'input' | 'signal') => boolean) | undefined
  private inputReleased = false
  private refusal:
    | 'handle'
    | 'birth'
    | 'group'
    | 'denied'
    | 'record'
    | 'inspection'
    | 'deadline'
    | null = null

  constructor(child: ChildProcess, entryNonce: string) {
    if (
      process.platform !== 'linux' ||
      !(child instanceof ChildProcess) ||
      typeof entryNonce !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entryNonce)
    )
      throw new LinuxOwnershipError()
    const channel = child.stdio[4]
    const args = child.spawnargs.slice(
      1,
      child.spawnargs.indexOf('--') < 0 ? undefined : child.spawnargs.indexOf('--'),
    )
    const option = (name: string, value?: string) =>
      args.filter(
        (arg, index) => arg === name && (value === undefined || args[index + 1] === value),
      ).length === 1
    if (
      process.platform !== 'linux' ||
      !(child instanceof ChildProcess) ||
      child.spawnfile !== '/usr/bin/bwrap' ||
      !child.pid ||
      child.pid <= 1 ||
      child.pid === process.pid ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      !child.stdout ||
      !child.stderr ||
      !(channel instanceof Readable) ||
      !option('--json-status-fd', '4') ||
      !option('--block-fd', '5') ||
      !option('--unshare-pid') ||
      !option('--new-session') ||
      args.includes('--as-pid-1')
    )
      throw new LinuxOwnershipError()
    const root = inspectLinuxProcess(child.pid)
    const parent = inspectLinuxProcess(process.pid)
    if (
      !live(root) ||
      !live(parent) ||
      root.parent !== process.pid ||
      root.group !== child.pid ||
      root.session !== child.pid ||
      root.uid !== parent.uid
    )
      throw new LinuxOwnershipError()
    const calls = getLinuxPidfdCalls()
    const opened = calls.open(child.pid)
    if (opened.fd < 0 || opened.errno !== 0) throw new LinuxOwnershipError()
    try {
      const current = inspectLinuxProcess(child.pid)
      if (
        !live(current) ||
        !sameBirth(root, current) ||
        current.parent !== process.pid ||
        calls.state(opened.fd) !== 'live'
      )
        throw new LinuxOwnershipError()
    } catch (error) {
      calls.close(opened.fd)
      throw error
    }
    this.child = child
    this.channel = channel
    this.calls = calls
    this.root = root
    this.rootFd = opened.fd
    this.parent = parent
    this.entryMarker = `BAZILION_NATIVE_READY:${entryNonce}`
    this.receipt = Object.freeze({ kind: 'owned-linux-pid-domain', token: randomUUID() })
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void this.ready.catch(() => {})
    this.timer = setTimeout(() => this.fail(), 5000)
    this.timer.unref()
    channel.on('data', (chunk: Buffer | string) => this.receive(chunk))
    child.stdout.on('data', (chunk: Buffer | string) => this.receiveEntry(chunk))
    channel.once('end', () => {
      this.statusEnded = channel.readableEnded
      if (!this.acknowledged || this.buffer.length) this.fail()
    })
    channel.once('error', () => this.fail())
    child.once('error', () => this.fail())
    child.stdin?.once('error', () => this.fail())
    child.once('close', () => {
      this.childClosed = true
      this.naturalEOF = child.stdout?.readableEnded === true && child.stderr?.readableEnded === true
      if (!this.acknowledged) this.fail()
    })
    owners.add(this)
  }

  private fail(): void {
    this.invalid = true
    clearTimeout(this.timer)
    this.rejectReady(new LinuxOwnershipError())
  }

  private receive(chunk: Buffer | string): void {
    if (this.closed || this.invalid) return
    this.bytes += Buffer.byteLength(chunk)
    if (this.bytes > 8192) {
      this.fail()
      return
    }
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      try {
        if (++this.frames > 4) throw new LinuxOwnershipError()
        const frame: unknown = JSON.parse(line)
        if (!frame || typeof frame !== 'object' || Array.isArray(frame))
          throw new LinuxOwnershipError()
        const record = frame as Record<string, unknown>
        if ('child-pid' in record) {
          if (
            this.initialStatus ||
            this.acknowledged ||
            this.init ||
            'exit-code' in record ||
            !Number.isSafeInteger(record['child-pid'])
          )
            throw new LinuxOwnershipError()
          this.initialStatus = record
          this.bindInstalledEntry()
        } else if ('exit-code' in record) {
          const code = record['exit-code']
          if (
            !this.acknowledged ||
            this.exitFrame !== undefined ||
            typeof code !== 'number' ||
            !Number.isSafeInteger(code) ||
            code < 0 ||
            code > 255
          )
            throw new LinuxOwnershipError()
          this.exitFrame = code
        }
      } catch {
        this.fail()
        return
      }
    }
  }

  private receiveEntry(chunk: Buffer | string): void {
    if (this.entrySeen || this.closed || this.invalid) return
    this.entryBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    if (Buffer.byteLength(this.entryBuffer) > 128) {
      this.fail()
      return
    }
    const newline = this.entryBuffer.indexOf('\n')
    if (newline < 0) return
    if (
      this.entryBuffer.slice(0, newline) !== this.entryMarker ||
      newline !== this.entryBuffer.length - 1
    ) {
      this.fail()
      return
    }
    this.entrySeen = true
    this.entryBuffer = ''
    try {
      this.bindInstalledEntry()
    } catch {
      this.fail()
    }
  }

  private bindInstalledEntry(): void {
    if (!this.entrySeen || !this.initialStatus || this.acknowledged) return
    this.bindInit(this.initialStatus['child-pid'] as number, this.initialStatus)
    this.acknowledged = true
    clearTimeout(this.timer)
    this.resolveReady()
  }

  private rootLive(): boolean {
    const fact = inspectLinuxProcess(this.root.pid)
    return (
      live(fact) &&
      sameBirth(this.root, fact) &&
      fact.parent === process.pid &&
      this.child.exitCode === null &&
      this.child.signalCode === null &&
      this.calls.state(this.rootFd) === 'live'
    )
  }

  private bindInit(pid: number, status: Record<string, unknown>): void {
    if (!this.rootLive() || pid <= 1 || pid === process.pid || pid === this.root.pid)
      throw new LinuxOwnershipError()
    const fact = inspectLinuxProcess(pid)
    if (
      !live(fact) ||
      fact.parent !== this.root.pid ||
      fact.uid !== this.root.uid ||
      fact.namespacePids.length !== this.parent.namespacePids.length + 1 ||
      fact.namespacePids.at(-1) !== 1
    )
      throw new LinuxOwnershipError()
    for (const key of ['pid', 'user', 'mnt', 'net', 'ipc', 'uts'] as const) {
      if (fact.namespaces[key] === this.parent.namespaces[key]) throw new LinuxOwnershipError()
      const reported = status[`${key}-namespace`]
      if (reported !== undefined && String(reported) !== fact.namespaces[key])
        throw new LinuxOwnershipError()
    }
    const opened = this.calls.open(pid)
    if (opened.fd < 0 || opened.errno !== 0) throw new LinuxOwnershipError()
    try {
      const after = inspectLinuxProcess(pid)
      if (
        !live(after) ||
        !sameBirth(fact, after) ||
        after.parent !== this.root.pid ||
        !this.rootLive() ||
        JSON.stringify(after.namespaces) !== JSON.stringify(fact.namespaces) ||
        this.calls.state(opened.fd) !== 'live'
      )
        throw new LinuxOwnershipError()
      this.init = { fact, fd: opened.fd }
    } catch (error) {
      this.calls.close(opened.fd)
      throw error
    }
  }

  matches(receipt: unknown): boolean {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false
    const value = receipt as Record<string, unknown>
    return (
      [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
      Object.keys(value).length === 2 &&
      Object.hasOwn(value, 'kind') &&
      Object.hasOwn(value, 'token') &&
      value.kind === this.receipt.kind &&
      value.token === this.receipt.token
    )
  }

  /** Positive namespace-init death kills the remaining PID domain in the kernel, not by census. */
  isSettled(): boolean {
    if (this.closed || this.invalid || !this.acknowledged || !this.init) return false
    return (
      this.childClosed &&
      this.naturalEOF &&
      this.statusEnded &&
      this.channel.readableEnded &&
      (this.exitFrame !== undefined || this.child.signalCode !== null) &&
      this.calls.state(this.rootFd) === 'exited' &&
      this.calls.state(this.init.fd) === 'exited'
    )
  }

  /** Bind once, before retirement: canonical rows are rechecked at every actual signal. */
  bindSignalGuard(guard: (action: 'input' | 'signal') => boolean): void {
    if (
      this.signalGuard ||
      this.termination ||
      this.inputReleased ||
      this.closed ||
      typeof guard !== 'function'
    )
      throw new LinuxOwnershipError()
    this.signalGuard = guard
  }

  /** Release one command only after installed entry acknowledgement and fresh canonical admission. */
  async execute(command: string): Promise<void> {
    await this.ready
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      command.includes('\0') ||
      Buffer.byteLength(command) > 256 * 1024 ||
      Buffer.from(command, 'utf8').toString('utf8') !== command ||
      this.inputReleased ||
      this.invalid ||
      this.closed ||
      !this.acknowledged ||
      !this.rootLive() ||
      !this.child.stdin ||
      (this.signalGuard && this.signalGuard('input') !== true)
    )
      throw new LinuxOwnershipError()
    this.inputReleased = true
    await new Promise<void>((resolve, reject) => {
      this.child.stdin?.end(command, (error?: Error | null) =>
        error ? reject(new LinuxOwnershipError()) : resolve(),
      )
    })
  }

  observation() {
    return Object.freeze({
      acknowledged: this.acknowledged,
      creationReported: this.initialStatus !== undefined,
      entrySeen: this.entrySeen,
      invalid: this.invalid,
      childClosed: this.childClosed,
      naturalEOF: this.naturalEOF,
      statusEnded: this.statusEnded,
      root: this.closed ? 'closed' : this.calls.state(this.rootFd),
      init: this.closed ? 'closed' : this.init ? this.calls.state(this.init.fd) : 'unacknowledged',
      refusal: this.refusal,
    })
  }

  private signal(fd: number, fact: LinuxProcessFact, signal: 'SIGTERM' | 'SIGKILL'): boolean {
    const state = this.calls.state(fd)
    if (state === 'exited') return true
    if (state !== 'live') {
      this.refusal = 'handle'
      return false
    }
    const current = inspectLinuxProcess(fact.pid)
    if (!live(current) || current.start !== fact.start || current.uid !== fact.uid) {
      this.refusal = 'birth'
      return false
    }
    if (!sameBirth(fact, current)) {
      this.refusal = 'group'
      return false
    }
    if (this.signalGuard && this.signalGuard('signal') !== true) {
      this.refusal = 'record'
      return false
    }
    const sent = this.calls.signal(fd, signal)
    const accepted = sent.result === 0 || (sent.errno === 3 && this.calls.state(fd) === 'exited')
    if (!accepted) this.refusal = 'denied'
    return accepted
  }

  terminate(): Promise<boolean> {
    this.termination ??= this.retire()
    return this.termination
  }
  private async retire(): Promise<boolean> {
    const deadline = performance.now() + 3500
    try {
      // Bubblewrap changes init's session after --block-fd. Never weaken its captured group
      // check or adopt a new target: retire the original live manager, then require positive
      // kernel death of the already-bound namespace init. PDEATHSIG alone is not settlement.
      const selected = { fd: this.rootFd, fact: this.root }
      if (!this.signal(selected.fd, selected.fact, 'SIGTERM')) return false
      const escalate = performance.now() + 500
      let killed = false
      while (performance.now() < deadline) {
        if (this.isSettled()) return true
        if (!killed && performance.now() >= escalate) {
          if (!this.signal(selected.fd, selected.fact, 'SIGKILL')) return false
          killed = true
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    } catch {
      this.refusal = 'inspection'
      return false
    }
    this.refusal = 'deadline'
    return false
  }

  /** Unknown ownership keeps kernel handles/resources held, not a caller-selectable force close. */
  closeSettled(): boolean {
    if (!this.isSettled()) return false
    clearTimeout(this.timer)
    this.closed = true
    this.calls.close(this.rootFd)
    if (this.init) this.calls.close(this.init.fd)
    return true
  }
}
