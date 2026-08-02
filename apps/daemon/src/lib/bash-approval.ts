import type { CommandApproval, CommandApprovalStatus } from '@bazilion/api-types'
import type {
  BashApprovalArgs,
  BashApprovalDecisionReason,
  BashApprovalHandle,
  BashApprovalHost,
  BashApprovalResult,
} from '../runtime/worker/ipc-protocol.ts'

export const DEFAULT_BASH_APPROVAL_TIMEOUT_MS = 120_000
const DEFAULT_TOMBSTONE_TTL_MS = 60_000

interface PendingEntry {
  approval: CommandApproval
  resolve: (result: BashApprovalResult) => void
  timer: NodeJS.Timeout
}

interface TerminalEntry {
  approval: CommandApproval
  decision: BashApprovalResult
  timer: NodeJS.Timeout
}

interface AttemptKeyEntry {
  approvalId: string
  signal?: AbortSignal
  onAbort?: () => void
}

export interface BashApprovalAudit {
  approvalId: string
  turnId: string
  toolCallId: string
  agentId: string
  teamId: string
  riskCodes: string[]
  status: Exclude<CommandApprovalStatus, 'pending'>
}

export type BashApprovalResponse =
  | { kind: 'accepted'; approval: CommandApproval }
  | { kind: 'already_applied'; approval: CommandApproval }
  | { kind: 'conflict'; approval: CommandApproval }
  | { kind: 'not_found' }

interface CommandApprovalRegistryOptions {
  timeoutMs?: number
  tombstoneTtlMs?: number
  now?: () => number
  audit?: (entry: BashApprovalAudit) => void
}

/**
 * Process-local registry for a single daemon instance. Shell approvals are
 * intentionally ephemeral and independent from durable Team Policy approvals.
 */
export class CommandApprovalRegistry implements BashApprovalHost {
  readonly #pending = new Map<string, PendingEntry>()
  /**
   * Exactly-once claim for one worker turn's tool call. Unlike response
   * tombstones, this survives settlement and is released only when that
   * worker's IPC lifetime ends (or the registry is explicitly cleared).
   */
  readonly #attemptKeys = new Map<string, AttemptKeyEntry>()
  readonly #terminal = new Map<string, TerminalEntry>()
  readonly #timeoutMs: number
  readonly #tombstoneTtlMs: number
  readonly #now: () => number
  readonly #audit: (entry: BashApprovalAudit) => void

  constructor(options: CommandApprovalRegistryOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_BASH_APPROVAL_TIMEOUT_MS
    this.#tombstoneTtlMs = options.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL_MS
    this.#now = options.now ?? Date.now
    this.#audit = options.audit ?? logBashApprovalDecision
  }

  begin(input: BashApprovalArgs, signal?: AbortSignal): BashApprovalHandle {
    const key = approvalKey(input.turnId, input.toolCallId)
    if (this.#pending.has(input.id) || this.#terminal.has(input.id)) {
      throw new Error(`duplicate shell approval id: ${input.id}`)
    }
    const existing = this.#attemptKeys.get(key)
    if (existing) {
      const state = this.#pending.has(existing.approvalId) ? 'already pending' : 'already decided'
      throw new Error(
        `shell approval ${state} for turn ${input.turnId} tool call ${input.toolCallId}`,
      )
    }

    const expiresAt = this.#now() + this.#timeoutMs
    const base: CommandApproval = {
      id: input.id,
      turnId: input.turnId,
      toolCallId: input.toolCallId,
      agentId: input.agentId,
      teamId: input.teamId,
      command: input.command,
      risks: input.risks,
      status: 'pending',
      expiresAt,
    }

    if (input.mode === 'auto_deny') {
      this.#claimAttempt(key, input.id, signal)
      const approval = { ...base, status: 'auto_denied' as const }
      const decision = { decision: 'deny' as const, reason: 'auto_deny' as const }
      this.#recordTerminal(approval, decision)
      return { approval, decision: Promise.resolve(decision) }
    }

    if (signal?.aborted) {
      const approval = { ...base, status: 'cancelled' as const }
      const decision = { decision: 'deny' as const, reason: 'cancelled' as const }
      this.#recordTerminal(approval, decision)
      return { approval, decision: Promise.resolve(decision) }
    }

    let resolveDecision!: (result: BashApprovalResult) => void
    const decision = new Promise<BashApprovalResult>((resolve) => {
      resolveDecision = resolve
    })
    const timer = setTimeout(() => {
      this.#settle(input.id, 'deny', 'timeout')
    }, this.#timeoutMs)
    timer.unref()
    const entry: PendingEntry = { approval: base, resolve: resolveDecision, timer }
    this.#pending.set(input.id, entry)
    this.#claimAttempt(key, input.id, signal)
    return { approval: base, decision }
  }

  list(agentId?: string): CommandApproval[] {
    return Array.from(this.#pending.values(), (entry) => entry.approval)
      .filter((approval) => agentId === undefined || approval.agentId === agentId)
      .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id))
  }

  respond(id: string, decision: 'allow' | 'deny'): BashApprovalResponse {
    const pending = this.#pending.get(id)
    if (pending) {
      const approval = this.#settle(id, decision, 'user')
      if (!approval) return { kind: 'not_found' }
      return { kind: 'accepted', approval }
    }

    const terminal = this.#terminal.get(id)
    if (!terminal) return { kind: 'not_found' }
    if (terminal.decision.reason === 'user' && terminal.decision.decision === decision) {
      return { kind: 'already_applied', approval: terminal.approval }
    }
    return { kind: 'conflict', approval: terminal.approval }
  }

  /** Test/shutdown helper: fail closed and release every waiter. */
  cancelAll(): void {
    for (const id of [...this.#pending.keys()]) this.#settle(id, 'deny', 'cancelled')
    for (const entry of this.#terminal.values()) clearTimeout(entry.timer)
    this.#terminal.clear()
    for (const [key, entry] of [...this.#attemptKeys]) {
      this.#releaseAttempt(key, entry.approvalId)
    }
  }

  #settle(
    id: string,
    decision: 'allow' | 'deny',
    reason: BashApprovalDecisionReason,
  ): CommandApproval | undefined {
    const entry = this.#pending.get(id)
    if (!entry) return undefined
    this.#pending.delete(id)
    clearTimeout(entry.timer)

    const result = { decision, reason }
    const approval = {
      ...entry.approval,
      status: statusForDecision(result),
    }
    this.#recordTerminal(approval, result)
    entry.resolve(result)
    return approval
  }

  #claimAttempt(key: string, approvalId: string, signal?: AbortSignal): void {
    const entry: AttemptKeyEntry = { approvalId, signal }
    this.#attemptKeys.set(key, entry)
    if (!signal) return

    entry.onAbort = () => {
      // Pending requests fail closed; settled requests simply release their
      // exactly-once key because no further IPC call can arrive from this turn.
      this.#settle(approvalId, 'deny', 'cancelled')
      this.#releaseAttempt(key, approvalId)
    }
    signal.addEventListener('abort', entry.onAbort, { once: true })
    // Close the race where the signal aborts between begin()'s pre-check and
    // listener registration.
    if (signal.aborted) entry.onAbort()
  }

  #releaseAttempt(key: string, approvalId: string): void {
    const entry = this.#attemptKeys.get(key)
    if (!entry || entry.approvalId !== approvalId) return
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort)
    }
    this.#attemptKeys.delete(key)
  }

  #recordTerminal(approval: CommandApproval, decision: BashApprovalResult): void {
    this.#audit({
      approvalId: approval.id,
      turnId: approval.turnId,
      toolCallId: approval.toolCallId,
      agentId: approval.agentId,
      teamId: approval.teamId,
      riskCodes: [...new Set(approval.risks.map((risk) => risk.code))],
      status: approval.status as Exclude<CommandApprovalStatus, 'pending'>,
    })
    const timer = setTimeout(() => this.#terminal.delete(approval.id), this.#tombstoneTtlMs)
    timer.unref()
    this.#terminal.set(approval.id, { approval, decision, timer })
  }
}

function approvalKey(turnId: string, toolCallId: string): string {
  return `${turnId}\u0000${toolCallId}`
}

export function statusForDecision(
  result: BashApprovalResult,
): Exclude<CommandApprovalStatus, 'pending'> {
  if (result.reason === 'auto_deny') return 'auto_denied'
  if (result.reason === 'timeout') return 'expired'
  if (result.reason === 'cancelled') return 'cancelled'
  return result.decision === 'allow' ? 'allowed' : 'denied'
}

function logBashApprovalDecision(entry: BashApprovalAudit): void {
  // Deliberately omit command, matched text, environment, and secret values.
  console.info('bash approval decision', entry)
}

export const commandApprovalRegistry = new CommandApprovalRegistry()
