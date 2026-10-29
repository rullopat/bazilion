import { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  DarwinJobRequest,
  DarwinJobResponse,
} from '../../runtime/shell/native/darwin-protocol.ts'
import {
  DARWIN_JOB_MAX_FRAME_BYTES,
  parseDarwinJobRequest,
} from '../../runtime/shell/native/darwin-protocol.ts'
import { type DarwinProcessMember, getDarwinProcessInspector } from './darwin.ts'
import {
  composeDarwinDomainObservation,
  DARWIN_CENSUS_BUDGET_MS,
  type DarwinCensusIdentity,
  DarwinCensusReader,
  getDarwinCensusCalls,
  hasBracketedDarwinCensusDrift,
  sameDarwinCensusIdentity,
} from './darwin-census.ts'

type Completed = Extract<DarwinJobResponse, { type: 'completed' }>
type Reply = Extract<DarwinJobResponse, { id: number }>
const owners = new WeakSet<object>()
export function isOwnedDarwinJob(value: unknown): value is OwnedDarwinJob {
  return typeof value === 'object' && value !== null && owners.has(value)
}
const unavailable = () => new Error('Native macOS job ownership unavailable')
const same = (left: DarwinProcessMember, right: DarwinProcessMember | null) =>
  right !== null &&
  right.pid === left.pid &&
  right.uid === left.uid &&
  right.start === left.start &&
  right.group === left.group &&
  right.session === left.session
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).length === allowed.length && allowed.every((key) => Object.hasOwn(value, key))
const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype

/** Original live helper authority plus a fenced complete census, never a recovered PID receipt. */
export class OwnedDarwinJob {
  readonly receipt = Object.freeze({
    kind: 'owned-darwin-job-domain' as const,
    token: randomUUID(),
  })
  readonly ready: Promise<void>
  private readonly child: ChildProcess
  private readonly native: DarwinProcessMember
  private readonly nonce: string
  private readonly inspection = getDarwinProcessInspector()
  private readonly reader = new DarwinCensusReader(getDarwinCensusCalls())
  private readonly onOutput: (stream: 'stdout' | 'stderr', bytes: Buffer) => void
  private owner: DarwinCensusIdentity | undefined
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private readyTimer: ReturnType<typeof setTimeout>
  private pending = Buffer.alloc(0)
  private nextId = 1
  private readonly replies = new Map<
    number,
    {
      type: string
      resolve(value: Reply): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private executed = false
  private completion: Completed | undefined
  private completionPromise: Promise<Completed> | undefined
  private resolveCompletion: ((value: Completed) => void) | undefined
  private rejectCompletion: ((error: Error) => void) | undefined
  private retained = 0
  private invalid = false
  private fenced = false
  private termSent = false
  private killSent = false
  private terminal = false
  private terminalProof = false
  private naturalEOF = false
  private exitAcknowledged = false
  private closed = false
  private signalGuard: ((action: 'input' | 'signal') => boolean) | undefined
  private retiring: Promise<boolean> | undefined
  private retirementStarted = false
  private retirementPhase = 'idle'
  private censusObservation: { kind: string; reason?: string; state?: string } | undefined
  private censusCaptures: Array<{ kind: string; reason?: string; state?: string }> = []

  private recordCensus(value: { kind: string; reason?: string; state?: string }): void {
    this.censusObservation = Object.freeze({ ...value })
    if (this.censusCaptures.length < 2) this.censusCaptures.push(this.censusObservation)
  }
  private termAccepted: boolean | undefined
  private killAccepted: boolean | undefined

  /** Closed diagnostic facts only: no PIDs, receipt reconstruction or signalling capability. */
  observation() {
    return Object.freeze({
      phase: this.retirementPhase,
      ownerLive: this.live(),
      invalid: this.invalid,
      executed: this.executed,
      fenced: this.fenced,
      commandCompleted: !!this.completion,
      commandNaturalEOF: this.completion?.naturalEOF === true,
      termSent: this.termSent,
      killSent: this.killSent,
      termAccepted: this.termAccepted,
      killAccepted: this.killAccepted,
      census: this.censusObservation ? Object.freeze({ ...this.censusObservation }) : undefined,
      captures: Object.freeze(this.censusCaptures.map((value) => Object.freeze({ ...value }))),
      exitAcknowledged: this.exitAcknowledged,
      terminal: this.terminal,
      naturalEOF: this.naturalEOF,
      terminalProof: this.terminalProof,
    })
  }

  constructor(
    child: ChildProcess,
    nonce: string,
    onOutput: (stream: 'stdout' | 'stderr', bytes: Buffer) => void = () => {},
  ) {
    if (
      process.platform !== 'darwin' ||
      !(child instanceof ChildProcess) ||
      child.spawnfile !== '/usr/bin/sandbox-exec' ||
      !child.pid ||
      child.pid <= 1 ||
      child.pid === process.pid ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      !child.stdout ||
      !child.stderr ||
      !child.stdin ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce)
    )
      throw unavailable()
    const native = this.inspection.member(child.pid)
    if (
      !native ||
      native.parent !== process.pid ||
      native.group !== child.pid ||
      native.session !== child.pid ||
      native.state === 'Z'
    )
      throw unavailable()
    this.child = child
    this.native = Object.freeze({ ...native })
    this.nonce = nonce
    this.onOutput = onOutput
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void this.ready.catch(() => {})
    this.readyTimer = setTimeout(() => this.fail(), 5000)
    this.readyTimer.unref()
    child.stdout.on('data', (bytes: Buffer) => this.receive(bytes))
    child.stdout.once('error', () => this.fail())
    child.stderr.on('data', () => {}) // Private helper diagnostics are not model command stderr.
    child.stderr.once('error', () => this.fail())
    child.stdin.once('error', () => this.fail())
    child.once('error', () => this.fail())
    child.once('close', () => {
      this.terminal = true
      this.naturalEOF = child.stdout?.readableEnded === true && child.stderr?.readableEnded === true
      if (
        !this.exitAcknowledged ||
        child.exitCode !== 0 ||
        child.signalCode !== null ||
        !this.naturalEOF ||
        this.pending.length
      )
        this.fail()
    })
    owners.add(this)
  }

  private fail(): void {
    this.invalid = true
    clearTimeout(this.readyTimer)
    const error = unavailable()
    this.rejectReady(error)
    this.rejectCompletion?.(error)
    for (const request of this.replies.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.replies.clear()
  }
  private live(): boolean {
    return (
      !this.closed &&
      !this.invalid &&
      !this.terminal &&
      this.child.exitCode === null &&
      this.child.signalCode === null &&
      same(this.native, this.inspection.member(this.native.pid))
    )
  }
  private receive(bytes: Buffer): void {
    if (this.invalid || this.closed) return
    try {
      if (this.pending.length + bytes.length > 2 * DARWIN_JOB_MAX_FRAME_BYTES) throw unavailable()
      this.pending = Buffer.concat([this.pending, bytes])
      for (;;) {
        const newline = this.pending.indexOf(10)
        if (newline < 0) break
        if (newline <= 0 || newline > DARWIN_JOB_MAX_FRAME_BYTES) throw unavailable()
        const raw = this.pending.subarray(0, newline)
        this.pending = this.pending.subarray(newline + 1)
        const text = raw.toString('utf8')
        if (!Buffer.from(text, 'utf8').equals(raw)) throw unavailable()
        this.frame(JSON.parse(text))
      }
      if (this.pending.length > DARWIN_JOB_MAX_FRAME_BYTES) throw unavailable()
    } catch {
      this.fail()
    }
  }
  private frame(value: unknown): void {
    if (!plain(value) || typeof value.type !== 'string') throw unavailable()
    if (value.type === 'fatal') throw unavailable()
    if (value.type === 'ready') {
      if (
        this.owner ||
        !keys(value, ['type', 'version', 'nonce', 'owner', 'native']) ||
        value.version !== 1 ||
        value.nonce !== this.nonce ||
        !plain(value.owner) ||
        !keys(value.owner, ['pid', 'uniqueId', 'execVersion']) ||
        !plain(value.native) ||
        !keys(value.native, ['pid', 'parent', 'group', 'session', 'uid', 'start', 'state']) ||
        !this.live()
      )
        throw unavailable()
      const owner = new DarwinCensusReader(getDarwinCensusCalls(), this.native.pid).ownIdentity()
      if (
        'kind' in owner ||
        !sameDarwinCensusIdentity(owner, value.owner as unknown as DarwinCensusIdentity) ||
        !same(this.native, value.native as unknown as DarwinProcessMember) ||
        value.native.parent !== process.pid ||
        !this.live()
      )
        throw unavailable()
      this.owner = owner
      clearTimeout(this.readyTimer)
      this.resolveReady()
      return
    }
    if (!this.owner) throw unavailable()
    if (value.type === 'output') {
      if (
        !this.executed ||
        this.completion ||
        !keys(value, ['type', 'stream', 'data']) ||
        !['stdout', 'stderr'].includes(String(value.stream)) ||
        typeof value.data !== 'string' ||
        value.data.length > 90 * 1024
      )
        throw unavailable()
      const data = Buffer.from(value.data, 'base64')
      this.retained += data.length
      if (
        data.toString('base64') !== value.data ||
        data.length > 64 * 1024 ||
        this.retained > 2 * 1024 * 1024
      )
        throw unavailable()
      this.onOutput(value.stream as 'stdout' | 'stderr', data)
      return
    }
    if (value.type === 'completed') {
      if (
        !this.executed ||
        this.completion ||
        !keys(value, [
          'type',
          'code',
          'signal',
          'naturalEOF',
          'stdoutTruncated',
          'stderrTruncated',
        ]) ||
        !(
          value.code === null ||
          (typeof value.code === 'number' &&
            Number.isSafeInteger(value.code) &&
            value.code >= 0 &&
            value.code <= 255)
        ) ||
        !(
          value.signal === null ||
          (typeof value.signal === 'string' && /^SIG[A-Z0-9]+$/.test(value.signal))
        ) ||
        (value.code === null) === (value.signal === null) ||
        typeof value.naturalEOF !== 'boolean' ||
        typeof value.stdoutTruncated !== 'boolean' ||
        typeof value.stderrTruncated !== 'boolean'
      )
        throw unavailable()
      this.completion = value as unknown as Completed
      this.resolveCompletion?.(this.completion)
      return
    }
    if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id)) throw unavailable()
    const pending = this.replies.get(value.id)
    const expected =
      value.type === 'started'
        ? ['type', 'id']
        : value.type === 'sealed' || value.type === 'exiting'
          ? ['type', 'id']
          : value.type === 'signal'
            ? ['type', 'id', 'accepted']
            : value.type === 'view'
              ? ['type', 'id', 'view']
              : []
    if (
      !pending ||
      pending.type !== value.type ||
      !keys(value, expected) ||
      (value.type === 'signal' && typeof value.accepted !== 'boolean') ||
      (value.type === 'view' &&
        (!plain(value.view) || !['view', 'unknown'].includes(String(value.view.kind))))
    )
      throw unavailable()
    clearTimeout(pending.timer)
    this.replies.delete(value.id)
    if (value.type === 'exiting') this.exitAcknowledged = true
    pending.resolve(value as unknown as Reply)
  }

  private rpc(
    type: DarwinJobRequest['type'],
    fields: Record<string, unknown> = {},
    timeout = 2000,
  ): Promise<Reply> {
    if (!this.live() || this.replies.size >= 4) return Promise.reject(unavailable())
    const request = parseDarwinJobRequest({ type, id: this.nextId++, ...fields })
    const frame = `${JSON.stringify(request)}\n`
    if (Buffer.byteLength(frame) > DARWIN_JOB_MAX_FRAME_BYTES) return Promise.reject(unavailable())
    const expected = {
      execute: 'started',
      signal: 'signal',
      seal: 'sealed',
      scope: 'view',
      exit: 'exiting',
    }[type]
    const pending = new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), Math.max(1, timeout))
      this.replies.set(request.id, { type: expected, resolve, reject, timer })
    })
    this.child.stdin?.write(frame, (error) => {
      if (error) this.fail()
    })
    return pending
  }

  bindSignalGuard(guard: (action: 'input' | 'signal') => boolean): void {
    if (
      this.signalGuard ||
      this.retirementStarted ||
      this.executed ||
      this.closed ||
      typeof guard !== 'function'
    )
      throw unavailable()
    this.signalGuard = guard
  }
  matches(value: unknown): boolean {
    return (
      plain(value) &&
      keys(value, ['kind', 'token']) &&
      value.kind === this.receipt.kind &&
      value.token === this.receipt.token
    )
  }
  async execute(command: string): Promise<Completed> {
    await this.ready
    parseDarwinJobRequest({ type: 'execute', id: this.nextId, command })
    if (
      this.executed ||
      this.fenced ||
      !this.live() ||
      (this.signalGuard && this.signalGuard('input') !== true)
    )
      throw unavailable()
    this.executed = true
    this.completionPromise = new Promise((resolve, reject) => {
      this.resolveCompletion = resolve
      this.rejectCompletion = reject
    })
    void this.completionPromise.catch(() => {})
    await this.rpc('execute', { command })
    return this.completionPromise
  }

  private async observeEmpty(deadline: number): Promise<{ scopeId: number } | null> {
    const owner = this.owner
    if (!owner || !this.fenced || !this.live()) return null
    const started = performance.now(),
      first = this.reader.inventory()
    if (first.kind !== 'inventory') {
      this.recordCensus({ kind: 'unknown', reason: `first_${first.reason}` })
      return null
    }
    const reply = await this.rpc(
      'scope',
      { inventory: first },
      Math.min(DARWIN_CENSUS_BUDGET_MS, deadline - performance.now()),
    )
    const last = this.reader.inventory()
    // ESRCH alone is neither exclusion nor absence proof. A complete changed outside bracket
    // with the same original live owner is independently explicit drift, permitting only the
    // existing second full capture. No partial view is ever composed into an empty observation.
    if (
      reply.type === 'view' &&
      reply.view.kind === 'unknown' &&
      ['identity_esrch', 'short_esrch'].includes(reply.view.reason) &&
      last.kind === 'inventory' &&
      this.live() &&
      hasBracketedDarwinCensusDrift(first, last, owner, performance.now() - started)
    ) {
      this.recordCensus({ kind: 'unknown', reason: 'drift' })
      return null
    }
    if (
      reply.type !== 'view' ||
      reply.view.kind !== 'view' ||
      last.kind !== 'inventory' ||
      !this.live()
    ) {
      this.recordCensus({
        kind: 'unknown',
        reason:
          reply.type === 'view' && reply.view.kind === 'unknown'
            ? `scoped_${reply.view.reason}`
            : last.kind === 'unknown'
              ? `last_${last.reason}`
              : 'transport_or_owner',
      })
      return null
    }
    const observed = composeDarwinDomainObservation(
      first,
      reply.view,
      last,
      owner,
      performance.now() - started,
    )
    this.recordCensus(
      observed.kind === 'observation'
        ? { kind: observed.kind, state: observed.state }
        : { kind: observed.kind, reason: observed.reason },
    )
    return observed.kind === 'observation' && observed.state === 'empty_at_capture'
      ? { scopeId: reply.id }
      : null
  }
  terminate(): Promise<boolean> {
    if (this.retiring) return this.retiring
    this.retirementStarted = true
    const operation = this.retire()
    this.retiring = operation
    void operation
      .finally(() => {
        if (this.retiring === operation && !this.terminalProof) this.retiring = undefined
      })
      .catch(() => {})
    return operation
  }
  private async retire(): Promise<boolean> {
    if (this.isSettled()) return true
    const deadline = performance.now() + 3500
    const remaining = () => Math.max(1, deadline - performance.now())
    this.censusCaptures = []
    this.censusObservation = undefined
    try {
      this.retirementPhase = 'ready'
      await this.ready
      if (!this.live() || (this.signalGuard && this.signalGuard('signal') !== true)) return false
      if (this.executed && !this.completion) {
        if (!this.termSent) {
          if (this.signalGuard && this.signalGuard('signal') !== true) return false
          this.termSent = true
          this.retirementPhase = 'term'
          const reply = await this.rpc('signal', { signal: 'SIGTERM' }, Math.min(2000, remaining()))
          this.termAccepted = reply.type === 'signal' && reply.accepted
        }
        const escalation = Math.min(deadline, performance.now() + 500)
        while (!this.completion && performance.now() < escalation)
          await new Promise((resolve) => setTimeout(resolve, 10))
        if (!this.completion && !this.killSent) {
          if (this.signalGuard && this.signalGuard('signal') !== true) return false
          this.killSent = true
          this.retirementPhase = 'kill'
          const reply = await this.rpc('signal', { signal: 'SIGKILL' }, Math.min(2000, remaining()))
          this.killAccepted = reply.type === 'signal' && reply.accepted
        }
        while (!this.completion && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 10))
      }
      this.retirementPhase = 'command-eof'
      if (this.executed && !this.completion?.naturalEOF) return false
      if (!this.fenced) {
        await this.rpc('seal', {}, Math.min(2000, remaining()))
        this.fenced = true
      }
      this.retirementPhase = 'census'
      let empty: { scopeId: number } | null = null
      // One additional READ-ONLY capture may resolve explicit process lifetime/exec drift.
      // No signal or command is repeated; every accepted capture still independently satisfies
      // the complete bracketed proof. Busy, ABI/permission/transport unknowns and exhaustion hold.
      for (let capture = 0; capture < 2 && performance.now() < deadline; capture++) {
        empty = await this.observeEmpty(deadline)
        const fact = this.censusCaptures.at(-1)
        if (
          empty ||
          fact?.kind !== 'unknown' ||
          !['drift', 'first_drift', 'scoped_drift', 'last_drift'].includes(fact.reason ?? '')
        )
          break
      }
      if (
        !empty ||
        !this.live() ||
        performance.now() >= deadline ||
        (this.signalGuard && this.signalGuard('signal') !== true)
      )
        return false
      const current = new DarwinCensusReader(getDarwinCensusCalls(), this.native.pid).ownIdentity()
      if ('kind' in current || !this.owner || !sameDarwinCensusIdentity(current, this.owner))
        return false
      this.retirementPhase = 'exit'
      await this.rpc('exit', { scopeId: empty.scopeId }, Math.min(2000, remaining()))
      this.exitAcknowledged = true
      while (!this.terminal && performance.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10))
      if (
        !this.terminal ||
        this.invalid ||
        !this.naturalEOF ||
        this.child.exitCode !== 0 ||
        this.child.signalCode !== null
      )
        return false
      this.retirementPhase = 'group'
      this.terminalProof = this.inspection.group(this.native.pid).length === 0
      if (this.terminalProof) this.retirementPhase = 'settled'
      return this.isSettled()
    } catch {
      return false
    }
  }
  isSettled(): boolean {
    if (
      this.closed ||
      this.invalid ||
      !this.terminalProof ||
      !this.terminal ||
      !this.naturalEOF ||
      !this.exitAcknowledged
    )
      return false
    try {
      return this.inspection.group(this.native.pid).length === 0
    } catch {
      return false
    }
  }
  closeSettled(): boolean {
    if (!this.isSettled()) return false
    this.closed = true
    clearTimeout(this.readyTimer)
    return true
  }
}
