import type { CommandApproval, CommandReview } from '@bazilion/api-types'
import { suggestRule } from '../core/command-rules.ts'
import type {
  BashApprovalArgs,
  BashApprovalHandle,
  BashApprovalHost,
} from '../runtime/worker/ipc-protocol.ts'
import { signalLiveChange } from './live-signal.ts'

/** How long a dangerous command waits for an answer before it is refused, as long as a question. */
const DEFAULT_TIMEOUT_MS = 5 * 60_000

type SettledStatus = Exclude<CommandApproval['status'], 'pending'>

/**
 * The pending dangerous-command approvals of this daemon process. Nothing is persisted: an
 * approval lives until it is answered, expires, or its turn ends.
 */
export class CommandApprovalRegistry implements BashApprovalHost {
  readonly #pending = new Map<
    string,
    {
      approval: CommandApproval
      settle: (status: SettledStatus) => CommandApproval
      settled: Promise<CommandApproval>
    }
  >()
  readonly #timeoutMs: number

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.#timeoutMs = timeoutMs
  }

  begin(
    input: BashApprovalArgs,
    signal?: AbortSignal,
    extra: { review?: CommandReview } = {},
  ): BashApprovalHandle {
    const suggested = input.tool ? undefined : suggestRule(input.command)
    const approval: CommandApproval = {
      id: input.id,
      turnId: input.turnId,
      toolCallId: input.toolCallId,
      agentId: input.agentId,
      teamId: input.teamId,
      command: input.command,
      risks: input.risks,
      ...(input.tool ? { tool: input.tool } : {}),
      ...(suggested ? { suggestedRule: suggested } : {}),
      ...(extra.review ? { review: extra.review } : {}),
      status: 'pending',
      createdAt: Date.now(),
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

    const { promise: settled, resolve } = Promise.withResolvers<CommandApproval>()
    const settle = (status: SettledStatus) => {
      this.#pending.delete(approval.id)
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const result = logged({ ...approval, status })
      resolve(result)
      signalLiveChange()
      return result
    }
    const onAbort = () => settle('cancelled')
    const timer = setTimeout(() => settle('expired'), this.#timeoutMs)
    timer.unref()
    signal?.addEventListener('abort', onAbort, { once: true })
    this.#pending.set(approval.id, { approval, settle, settled })
    signalLiveChange()
    return { approval, settled }
  }

  list(agentId?: string): CommandApproval[] {
    return Array.from(this.#pending.values(), (entry) => entry.approval)
      .filter((approval) => agentId === undefined || approval.agentId === agentId)
      .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id))
  }

  get(id: string): CommandApproval | undefined {
    return this.#pending.get(id)?.approval
  }

  /** The outcome of a pending approval; undefined once it has settled. */
  settled(id: string): Promise<CommandApproval> | undefined {
    return this.#pending.get(id)?.settled
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

/** An approval decided at once, without asking anyone. */
function decided(
  input: BashApprovalArgs,
  status: 'allowed' | 'denied' | 'cancelled',
  extra: { rule?: string; review?: CommandReview },
): BashApprovalHandle {
  const approval = logged({
    id: input.id,
    turnId: input.turnId,
    toolCallId: input.toolCallId,
    agentId: input.agentId,
    teamId: input.teamId,
    command: input.command,
    risks: input.risks,
    status,
    ...extra,
    createdAt: Date.now(),
    expiresAt: Date.now(),
  })
  return { approval, settled: Promise.resolve(approval) }
}

/**
 * The approvals of one turn's shell commands: an Agent's rule allows a command at once; with a
 * review model, it answers next, and what it passes on goes to the owner (or, with nobody there,
 * is denied) through the registry.
 */
export function createTurnApprovalHost(options: {
  registry: CommandApprovalRegistry
  /** The prefix of the Agent's rule that allows the command, if any. */
  rule: (agentId: string, command: string) => string | null
  review?: (input: BashApprovalArgs, signal?: AbortSignal) => Promise<CommandReview>
}): BashApprovalHost {
  return {
    async begin(input, signal) {
      if (!input.tool) {
        const rule = options.rule(input.agentId, input.command)
        if (rule) return decided(input, 'allowed', { rule })
        if (options.review) {
          const review = await options.review(input, signal)
          if (signal?.aborted) return decided(input, 'cancelled', { review })
          if (review.decision === 'allow') return decided(input, 'allowed', { review })
          if (review.decision === 'deny') return decided(input, 'denied', { review })
          return options.registry.begin(input, signal, { review })
        }
      }
      return options.registry.begin(input, signal)
    },
  }
}
