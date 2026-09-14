import type { CodingCommandOutcome, CodingCommandReceipt } from '@bazilion/api-types'
import {
  type BashOperations,
  createLocalBashOperations,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { validateCodingCommand } from '../../core/coding-environment/config.ts'
import { CodingDiagnostics } from '../../lib/coding-environment/diagnostics.ts'
import { resolveCodingDirectory } from '../coding-directory.ts'
import {
  BashApprovalDeniedError,
  type BashApprovalHost,
  requireBashApproval,
} from '../shell/approval.ts'
import {
  createPreparedDockerBashOperations,
  type DockerResourceLifecycle,
  type ProtectedDockerRuntime,
} from '../shell/docker.ts'
import type { CodingHost } from './coding-contract.ts'
import type { RepositoryContextHost } from './repository-context.ts'

/** Uses the admitted shell backend and lifecycle; never a daemon probe or another workspace lease. */
export function codingTools(input: {
  host: CodingHost
  root: string
  context: RepositoryContextHost
  docker?: ProtectedDockerRuntime
  lifecycle?: DockerResourceLifecycle
  approval: boolean
  approvalHost?: BashApprovalHost
  secrets?: readonly string[]
}): ToolDefinition[] {
  const hostOperations = input.docker ? null : createLocalBashOperations()
  return [
    {
      name: 'coding_environment',
      label: 'Inspect coding environment',
      description:
        'Read the actual environment admitted to this turn for a Team-relative directory. No commands run. Discover prerequisites during the task; no Team checklist is required. Missing network/tooling is a specific blocker, never permission to change posture.',
      parameters: Type.Object(
        { target: Type.String({ default: '.', maxLength: 4096 }) },
        { additionalProperties: false },
      ),
      executionMode: 'sequential',
      async execute(_id, params) {
        const value = await input.host.invoke({
          action: 'environment',
          target: (params as { target: string }).target,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(value) }],
          details: { codingEnvironment: value },
        }
      },
    },
    {
      name: 'coding_command',
      label: 'Run coding command',
      description:
        'Execute an ad hoc finite runtime/dependency/preparation/build/test command in this turn’s actual environment. Use discovered repository commands, not saved operator checks. Resolve prerequisites and use available offline artifacts within current authority. Share coding-receipt:<id> through send_message if a teammate needs evidence; never wait holding its workspace lease. Success is an observed exit, not proof about later code.',
      parameters: Type.Object(
        {
          command: Type.String({ minLength: 1, maxLength: 4096 }),
          cwd: Type.String({ maxLength: 4096 }),
          purpose: Type.Union(
            ['runtime', 'dependency', 'prepare', 'build', 'test'].map((value) =>
              Type.Literal(value),
            ),
          ),
          timeoutSeconds: Type.Integer({ minimum: 1, maximum: 300 }),
        },
        { additionalProperties: false },
      ),
      executionMode: 'sequential',
      async execute(toolCallId, params, signal) {
        const command = validateCodingCommand(params)
        // Refresh Pi's effective instruction set as well as the daemon's receipt evidence.
        const context = await input.context(command.cwd)
        if (context.instructions.state !== 'complete')
          throw new Error('Coding scope instructions are incomplete')
        const started = (await input.host.invoke({
          action: 'start',
          toolCallId,
          input: command,
        })) as CodingCommandReceipt
        const output = new CodingDiagnostics(input.secrets ?? [])
        let outcome: CodingCommandOutcome
        try {
          if (input.approval)
            await requireBashApproval(command.command, toolCallId, signal, input.approvalHost)
          signal?.throwIfAborted()
          const cwd = resolveCodingDirectory(input.root, command.cwd)
          const operations: BashOperations = input.docker
            ? createPreparedDockerBashOperations(
                {
                  ...input.docker,
                  coding: {
                    revision: input.docker.coding?.revision ?? 0,
                    cwd: command.cwd,
                    env: input.docker.coding?.env ?? {},
                  },
                },
                input.lifecycle,
              )
            : hostOperations!
          const result = await operations.exec(
            command.command,
            input.docker ? input.root : cwd.path,
            { onData: (bytes) => output.append(bytes), signal, timeout: command.timeoutSeconds },
          )
          outcome = {
            state:
              result.exitCode === 0
                ? 'succeeded'
                : result.exitCode === null
                  ? 'interrupted'
                  : 'failed',
            exitCode: result.exitCode,
            ...output.finish(),
            reason: result.exitCode === null ? 'exit_unavailable' : null,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Command execution unavailable'
          const state =
            signal?.aborted || message === 'aborted'
              ? 'cancelled'
              : message.startsWith('timeout:')
                ? 'timed_out'
                : error instanceof BashApprovalDeniedError
                  ? 'blocked'
                  : /cleanup|teardown/i.test(message)
                    ? 'interrupted'
                    : 'blocked'
          outcome = { state, exitCode: null, ...output.finish(), reason: message }
        }
        const receipt = (await input.host.invoke({
          action: 'finish',
          id: started.id,
          outcome,
        })) as CodingCommandReceipt
        return {
          content: [{ type: 'text', text: JSON.stringify(receipt) }],
          details: { codingReceipt: receipt },
        }
      },
    },
    {
      name: 'coding_receipt',
      label: 'Read coding result',
      description:
        'Read a retained command result with current applicability. Your own receipts are private. For a teammate’s receipt, provide the id of its policy-authorized message containing coding-receipt:<id>. Old results are not current verification.',
      parameters: Type.Object(
        {
          id: Type.String({ maxLength: 64 }),
          messageId: Type.Optional(Type.String({ maxLength: 64 })),
        },
        { additionalProperties: false },
      ),
      executionMode: 'sequential',
      async execute(_id, params) {
        const value = await input.host.invoke({
          action: 'read',
          ...(params as { id: string; messageId?: string }),
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(value) }],
          details: { codingEvidence: value },
        }
      },
    },
  ]
}
