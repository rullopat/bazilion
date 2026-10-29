import { ChildProcess, spawn } from 'node:child_process'
import type { DarwinProcessInspector, DarwinProcessMember } from '../../../lib/process/darwin.ts'
import type {
  DarwinCensusIdentity,
  DarwinCensusReader,
} from '../../../lib/process/darwin-census.ts'
import {
  type DarwinJobPhase,
  type DarwinJobRequest,
  type DarwinJobResponse,
  nextDarwinJobPhase,
} from './darwin-protocol.ts'

const OUTPUT_BYTES = 2 * 1024 * 1024
const CHUNK_BYTES = 64 * 1024
const unavailable = () => new Error('Native macOS job unavailable')

/** Trusted one-job helper, inside the admitted immutable Seatbelt instance. No DB/provider host. */
export class DarwinCommandJob {
  private phase: DarwinJobPhase = 'waiting'
  private lastId = 0
  private lastEmptyScope: number | undefined
  private child: ChildProcess | undefined
  private childBirth: DarwinProcessMember | undefined
  private childEOF = false
  private retained = 0
  private stdoutTruncated = false
  private stderrTruncated = false
  private readonly reader: DarwinCensusReader
  private readonly owner: DarwinCensusIdentity
  private readonly inspection: Pick<DarwinProcessInspector, 'member'>
  private readonly cwd: string
  private readonly env: NodeJS.ProcessEnv
  private readonly sink: (message: DarwinJobResponse) => void

  constructor(options: {
    reader: DarwinCensusReader
    owner: DarwinCensusIdentity
    inspection: Pick<DarwinProcessInspector, 'member'>
    cwd: string
    env: NodeJS.ProcessEnv
    sink: (message: DarwinJobResponse) => void
  }) {
    if (process.platform !== 'darwin') throw unavailable()
    this.reader = options.reader
    this.owner = options.owner
    this.inspection = options.inspection
    this.cwd = options.cwd
    this.env = Object.freeze({ ...options.env })
    this.sink = options.sink
  }

  /** Return true only for the explicit fenced exit handshake, never stdin EOF or cancellation. */
  accept(request: DarwinJobRequest): boolean {
    if (request.id !== this.lastId + 1) throw unavailable()
    const next = nextDarwinJobPhase(this.phase, request)
    if (request.type === 'seal' && this.child && !this.childEOF) throw unavailable()
    if (
      request.type === 'exit' &&
      (this.lastEmptyScope !== request.scopeId || this.phase !== 'sealed')
    )
      throw unavailable()
    this.lastId = request.id
    this.phase = next
    switch (request.type) {
      case 'execute':
        this.execute(request)
        return false
      case 'signal':
        this.sink({ type: 'signal', id: request.id, accepted: this.signal(request.signal) })
        return false
      case 'seal':
        this.sink({ type: 'sealed', id: request.id })
        return false
      case 'scope': {
        const view = this.reader.scope(request.inventory, this.owner)
        this.lastEmptyScope =
          view.kind === 'view' && view.members.length === 0 ? request.id : undefined
        this.sink({ type: 'view', id: request.id, view })
        return false
      }
      case 'exit':
        this.sink({ type: 'exiting', id: request.id })
        return true
    }
  }

  private output(stream: 'stdout' | 'stderr', bytes: Buffer): void {
    const available = Math.max(0, OUTPUT_BYTES - this.retained)
    const selected = bytes.subarray(0, available)
    if (selected.length !== bytes.length) {
      if (stream === 'stdout') this.stdoutTruncated = true
      else this.stderrTruncated = true
    }
    this.retained += selected.length
    for (let offset = 0; offset < selected.length; offset += CHUNK_BYTES) {
      this.sink({
        type: 'output',
        stream,
        data: selected.subarray(offset, offset + CHUNK_BYTES).toString('base64'),
      })
    }
  }

  private execute(request: Extract<DarwinJobRequest, { type: 'execute' }>): void {
    if (this.child) throw unavailable()
    const child = spawn('/bin/bash', ['--noprofile', '--norc', '-s'], {
      cwd: this.cwd,
      env: this.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    child.once('error', () => this.sink({ type: 'fatal', error: 'native_job_unavailable' }))
    child.stdout.on('data', (bytes: Buffer) => this.output('stdout', bytes))
    child.stderr.on('data', (bytes: Buffer) => this.output('stderr', bytes))
    child.once('close', (code, signal) => {
      this.phase = 'completed'
      this.childEOF = child.stdout.readableEnded && child.stderr.readableEnded
      this.sink({
        type: 'completed',
        code,
        signal,
        naturalEOF: this.childEOF,
        stdoutTruncated: this.stdoutTruncated,
        stderrTruncated: this.stderrTruncated,
      })
    })
    if (!(child instanceof ChildProcess) || !child.pid) throw unavailable()
    let member: DarwinProcessMember | null
    try {
      member = this.inspection.member(child.pid)
    } catch {
      child.stdin.end()
      throw unavailable()
    }
    if (
      !member ||
      member.parent !== process.pid ||
      member.group !== child.pid ||
      member.session !== child.pid ||
      member.state === 'Z'
    ) {
      child.stdin.end()
      throw unavailable()
    }
    this.childBirth = Object.freeze({ ...member })
    this.sink({ type: 'started', id: request.id })
    // Command bytes are not arguments or inherited control descriptors. No code is released
    // until the daemon's execute request and the actual original Bash birth are both admitted.
    child.stdin.on('error', () => this.sink({ type: 'fatal', error: 'native_job_unavailable' }))
    child.stdin.end(request.command)
  }

  private signal(signal: 'SIGTERM' | 'SIGKILL'): boolean {
    const child = this.child,
      original = this.childBirth
    if (!child || !original || child.exitCode !== null || child.signalCode !== null) return false
    try {
      const current = this.inspection.member(original.pid)
      if (
        !current ||
        current.pid !== child.pid ||
        current.parent !== process.pid ||
        current.start !== original.start ||
        current.uid !== original.uid ||
        current.group !== original.group ||
        current.session !== original.session ||
        current.state === 'Z'
      )
        return false
      // The live original ChildProcess still anchors this exact session/group. Never adopt
      // census IDs or new descendants after the leader exits, even if the final census is busy.
      process.kill(-original.pid, signal)
      return true
    } catch {
      return false
    }
  }
}
