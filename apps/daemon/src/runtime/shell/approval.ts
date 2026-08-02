import { type createBashToolDefinition, defineTool } from '@earendil-works/pi-coding-agent'
import { type CommandRisk, classifyBashCommand } from './security.ts'

export type BashApprovalDecision = 'approved' | 'denied'

export interface BashApprovalRequest {
  toolCallId: string
  command: string
  risks: readonly CommandRisk[]
  signal: AbortSignal | undefined
}

/**
 * Turn-scoped bridge used only for dangerous bash command approval.
 *
 * The transport lives outside the shell layer. Omitting the host is a valid
 * non-interactive posture: risky commands fail closed while safe commands
 * continue to the selected local or Docker execution backend.
 */
export interface BashApprovalHost {
  requestApproval(request: BashApprovalRequest): Promise<BashApprovalDecision>
}

export class BashApprovalDeniedError extends Error {
  readonly risks: readonly CommandRisk[]

  constructor(risks: readonly CommandRisk[]) {
    const codes = [...new Set(risks.map((risk) => risk.code))]
    super(`Dangerous bash command denied (${codes.join(', ')})`)
    this.name = 'BashApprovalDeniedError'
    this.risks = risks
  }
}

type BashToolDefinition = ReturnType<typeof createBashToolDefinition>

/**
 * Wrap Pi's bash ToolDefinition at the tool-call boundary, where the stable
 * toolCallId is available. BashOperations is deliberately left untouched so
 * approval always happens before either the host or Docker backend executes.
 */
export function createApprovalGatedBashTool(base: BashToolDefinition, host?: BashApprovalHost) {
  return defineTool({
    ...base,
    description: `${base.description} Commands classified as dangerous require operator approval before execution.`,
    executionMode: 'sequential',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const risks = classifyBashCommand(params.command)
      if (risks.length > 0) {
        const decision = host
          ? await host.requestApproval({
              toolCallId,
              command: params.command,
              risks,
              signal,
            })
          : 'denied'

        if (decision !== 'approved') throw new BashApprovalDeniedError(risks)
      }

      return base.execute(toolCallId, params, signal, onUpdate, ctx)
    },
  })
}
