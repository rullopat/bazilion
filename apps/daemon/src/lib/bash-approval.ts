import type { CommandApproval } from '@bazilion/api-types'
import type {
  BashApprovalArgs,
  BashApprovalHandle,
  BashApprovalHost,
} from '../runtime/worker/ipc-protocol.ts'

/** How long a dangerous command waits for an answer before it is refused. */
const DEFAULT_TIMEOUT_MS = 120_000

type SettledStatus = Exclude<CommandApproval['status'], 'pending'>

/**
 * The pending dangerous-command approvals of this daemon process. Nothing is persisted: an
 * approval lives until it is answered, expires, or its turn ends.
 */
export class CommandApprovalRegistry implements BashApprovalHost {
  readonly #pending = new Map<
    string,
    { approval: CommandApproval; settle: (status: SettledStatus) => CommandApproval }
  >()
  readonly #timeoutMs: number

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.#timeoutMs = timeoutMs
  }

  begin(input: BashApprovalArgs, signal?: AbortSignal): BashApprovalHandle {
    const approval: CommandApproval = {
      id: input.id,
      turnId: input.turnId,
      toolCallId: input.toolCallId,
      agentId: input.agentId,
      teamId: input.teamId,
      command: input.command,
      risks: input.risks,
      status: 'pending',
      expiresAt: Date.now() + this.#timeoutMs,
    }
    const immediate =
      input.mode === 'auto_deny' ? 'auto_denied' : signal?.aborted ? 'cancelled' : undefined
    if (immediate) {
      const settled = logged({ ...approval, status: immediate })
      return { approval: settled, settled: Promise.resolve(settled) }
    }
    if (this.#pending.has(approval.id))
      throw new Error(`duplicate shell approval id: ${approval.id}`)

    const settled = new Promise<CommandApproval>((resolve) => {
      const settle = (status: SettledStatus) => {
        this.#pending.delete(approval.id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        const result = logged({ ...approval, status })
        resolve(result)
        return result
      }
      const onAbort = () => settle('cancelled')
      const timer = setTimeout(() => settle('expired'), this.#timeoutMs)
      timer.unref()
      signal?.addEventListener('abort', onAbort, { once: true })
      this.#pending.set(approval.id, { approval, settle })
    })
    return { approval, settled }
  }

  list(agentId?: string): CommandApproval[] {
    return Array.from(this.#pending.values(), (entry) => entry.approval)
      .filter((approval) => agentId === undefined || approval.agentId === agentId)
      .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id))
  }

  /** Answer a pending approval; undefined when there is none (unknown, or already settled). */
  respond(id: string, decision: 'allow' | 'deny'): CommandApproval | undefined {
    return this.#pending.get(id)?.settle(decision === 'allow' ? 'allowed' : 'denied')
  }
}

function logged(approval: CommandApproval): CommandApproval {
  // The command text stays out of the log.
  console.info('bash approval decision', {
    approvalId: approval.id,
    agentId: approval.agentId,
    teamId: approval.teamId,
    riskCodes: [...new Set(approval.risks.map((risk) => risk.code))],
    status: approval.status,
  })
  return approval
}

export const commandApprovalRegistry = new CommandApprovalRegistry()
