import { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:os'
import { ObservedChildWorker } from '../../runtime/worker/observed-child.ts'
import { getLinuxPidfdCalls, inspectLinuxProcess, type LinuxProcessFact } from './linux.ts'

export interface LinuxNativeWorkerIdentity {
  readonly kind: 'owned-linux-native-child'
  readonly pid: number
  readonly token: string
  readonly start: string
  readonly uid: number
  readonly hostCommands: false
}
const unavailable = () => new Error('Live native Linux worker ownership unavailable')
const sameNamespaces = (a: LinuxProcessFact, b: LinuxProcessFact) =>
  (['pid', 'user', 'mnt', 'net', 'ipc', 'uts'] as const).every(
    (key) => a.namespaces[key] === b.namespaces[key],
  )

/**
 * Only a trusted no-host-command worker, never an arbitrary host shell domain. Native jobs have
 * their own owners. The actual child, pidfd and birth facts remain private; receipts cannot rebuild
 * them. Settlement uses natural ChildProcess EOF and positive original-group absence, not visibility
 * into unrelated processes' FDs. No group/descendant or receipt-PID signalling exists here.
 */
export class OwnedLinuxNativeWorker {
  readonly identity: Readonly<LinuxNativeWorkerIdentity>
  private readonly child: ChildProcess
  private readonly observation: ObservedChildWorker
  private readonly calls = getLinuxPidfdCalls()
  private readonly original: LinuxProcessFact
  private readonly fd: number
  private revoked = false
  private confirmed = false
  private closed = false
  private settling: Promise<boolean> | undefined

  constructor(pid: number, child: ChildProcess, hostCommands: boolean) {
    this.child = child
    if (
      process.platform !== 'linux' ||
      hostCommands !== false ||
      !(child instanceof ChildProcess) ||
      child.pid !== pid ||
      child.spawnfile !== process.execPath ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      !child.stdout ||
      !child.stderr
    )
      throw unavailable()
    const parent = inspectLinuxProcess(process.pid),
      first = inspectLinuxProcess(pid)
    if (
      !parent ||
      !first ||
      first.parent !== process.pid ||
      first.group !== pid ||
      first.session !== pid ||
      first.uid !== parent.uid ||
      ['Z', 'X', 'x'].includes(first.state) ||
      !sameNamespaces(first, parent)
    )
      throw unavailable()
    const opened = this.calls.open(pid)
    if (opened.fd < 0 || opened.errno !== 0) throw unavailable()
    try {
      const last = inspectLinuxProcess(pid)
      if (
        !last ||
        last.start !== first.start ||
        last.uid !== first.uid ||
        last.parent !== process.pid ||
        last.group !== pid ||
        last.session !== pid ||
        ['Z', 'X', 'x'].includes(last.state) ||
        !sameNamespaces(first, last) ||
        this.calls.state(opened.fd) !== 'live'
      )
        throw unavailable()
      this.observation = new ObservedChildWorker(pid, child, false)
      this.original = last
      this.fd = opened.fd
      this.identity = Object.freeze({
        kind: 'owned-linux-native-child',
        pid,
        token: randomUUID(),
        start: last.start,
        uid: last.uid,
        hostCommands: false,
      })
    } catch (error) {
      this.calls.close(opened.fd) // Not admitted and no executable input was released.
      throw error
    }
  }

  matches(value: unknown): value is LinuxNativeWorkerIdentity {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
      return false
    const record = value as Record<string, unknown>
    return (
      Object.keys(record).length === 6 &&
      record.kind === this.identity.kind &&
      record.pid === this.identity.pid &&
      record.token === this.identity.token &&
      record.start === this.identity.start &&
      record.uid === this.identity.uid &&
      record.hostCommands === false
    )
  }

  revoke(): void {
    this.revoked = true
  }

  beforeSignal(): void {
    if (
      this.revoked ||
      this.closed ||
      this.child.pid !== this.identity.pid ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null ||
      this.calls.state(this.fd) !== 'live'
    )
      throw unavailable()
    const current = inspectLinuxProcess(this.identity.pid)
    if (
      !current ||
      current.start !== this.original.start ||
      current.uid !== this.original.uid ||
      current.parent !== process.pid ||
      current.group !== this.identity.pid ||
      current.session !== this.identity.pid ||
      ['Z', 'X', 'x'].includes(current.state) ||
      !sameNamespaces(current, this.original) ||
      this.calls.state(this.fd) !== 'live'
    )
      throw unavailable()
  }

  /** Signal only the original live pidfd; never fall back to child.kill/process.kill or a PID receipt. */
  signal(signal: 'SIGTERM' | 'SIGKILL'): void {
    this.beforeSignal()
    const result = this.calls.signal(this.fd, signal)
    if (
      result.result !== 0 &&
      !(result.errno === constants.errno.ESRCH && this.calls.state(this.fd) === 'exited')
    )
      throw unavailable()
  }

  private groupAbsent(): boolean {
    try {
      process.kill(-this.identity.pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }

  settled(): Promise<boolean> {
    if (this.confirmed) return Promise.resolve(true)
    if (this.revoked || this.closed) return Promise.resolve(false)
    if (this.settling) return this.settling
    const operation = this.observeSettlement()
    this.settling = operation
    void operation
      .finally(() => {
        if (this.settling === operation) this.settling = undefined
      })
      .catch(() => {})
    return operation
  }
  private async observeSettlement(): Promise<boolean> {
    const deadline = performance.now() + 3500
    while (performance.now() < deadline) {
      if (this.revoked || this.closed) return false
      const facts = this.observation.exitObservation(),
        state = this.calls.state(this.fd)
      if (state === 'unknown') return false
      if (facts.closed) {
        if (!facts.naturalEOF) return false
        if (state === 'exited' && this.groupAbsent()) {
          this.confirmed = true
          return true
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return false
  }

  /** Close retained handles only after canonical resource confirmation. */
  closeSettled(): boolean {
    if (!this.confirmed || this.revoked) return false
    if (!this.closed) {
      this.calls.close(this.fd)
      this.closed = true
    }
    return true
  }

  /** Registration failed before input. Only the trusted bootstrap's positive natural exit retires FD. */
  discardBeforeInput(): void {
    const retire = () => {
      void this.settled()
        .then((confirmed) => {
          if (confirmed) this.closeSettled()
        })
        .catch(() => {})
    }
    if (this.child.exitCode !== null || this.child.signalCode !== null) retire()
    else this.child.once('close', retire)
  }
}
