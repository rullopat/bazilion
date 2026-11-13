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

async function requireBashApproval(
  command: string,
  toolCallId: string,
  signal?: AbortSignal,
  host?: BashApprovalHost,
  workspace?: string,
): Promise<void> {
  const risks = classifyBashCommand(command, workspace)
  if (!risks.length) return
  const decision = host
    ? await host.requestApproval({ toolCallId, command, risks, signal })
    : 'denied'
  if (decision !== 'approved') throw new BashApprovalDeniedError(risks)
}

/**
 * Wrap Pi's bash ToolDefinition at the tool-call boundary, where the stable
 * toolCallId is available. BashOperations is deliberately left untouched so
 * approval always happens before either the host or Docker backend executes.
 * Paths inside `workspace` (the Team directory as the command sees it) count as
 * project-local, like relative paths.
 */
export function createApprovalGatedBashTool(
  base: BashToolDefinition,
  host?: BashApprovalHost,
  workspace?: string,
) {
  return defineTool({
    ...base,
    description: `${base.description} Commands classified as dangerous require operator approval before execution.`,
    executionMode: 'sequential',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      await requireBashApproval(params.command, toolCallId, signal, host, workspace)

      return base.execute(toolCallId, params, signal, onUpdate, ctx)
    },
  })
}
