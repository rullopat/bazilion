import type { CodingCommandOutcome, CodingCommandReceipt } from '@bazilion/api-types'
import {
  type BashOperations,
  createLocalBashOperations,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { validateCodingCommand } from '../../core/coding-environment/config.ts'
import { CODING_LIVE_BYTES, CodingDiagnostics } from '../../lib/coding-environment/diagnostics.ts'
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
      async execute(toolCallId, params, signal, onUpdate) {
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
        // Live progress shares the same redaction pipeline as the retained log, so a
        // credential split across chunks cannot reach chat. Updates are cumulative
        // (each replaces the last) and throttled so a chatty command cannot flood clients.
        let lastProgressAt = 0
        const emitProgress = (force: boolean) => {
          if (!onUpdate) return
          const now = Date.now()
          if (!force && now - lastProgressAt < 400) return
          lastProgressAt = now
          const preview = output.preview(CODING_LIVE_BYTES)
          onUpdate({
            content: [{ type: 'text', text: preview.text }],
            details: {
              codingProgress: {
                id: toolCallId,
                commandId: started.id,
                output: preview.text,
                truncated: preview.truncated,
                elapsedMs: Math.max(0, now - started.startedAt),
              },
            },
          })
        }
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
            {
              onData: (bytes) => {
                output.append(bytes)
                emitProgress(false)
              },
              signal,
              timeout: command.timeoutSeconds,
            },
          )
          emitProgress(true)
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
    {
      name: 'coding_log',
      label: 'Read retained command output',
      description:
        'Read a bounded page of retained diagnostic output for a coding receipt, or search it. Producing Agents may read their own logs; a teammate must pass the id of the policy-authorized message that carried coding-receipt:<id>. Output is bounded and may be truncated, expired, deleted or unavailable — report that state honestly and do not infer completeness from an exit code.',
      parameters: Type.Object(
        {
          id: Type.String({ maxLength: 64 }),
          messageId: Type.Optional(Type.String({ maxLength: 64 })),
          search: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 65536 })),
        },
        { additionalProperties: false },
      ),
      executionMode: 'sequential',
      async execute(_id, params) {
        const values = params as {
          id: string
          messageId?: string
          search?: string
          offset?: number
          limit?: number
        }
        if (values.search !== undefined) {
          const result = await input.host.invoke({
            action: 'log-search',
            id: values.id,
            query: values.search,
            ...(values.messageId !== undefined ? { messageId: values.messageId } : {}),
          })
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            details: { codingLogSearch: result },
          }
        }
        const value = await input.host.invoke({
          action: 'log',
          id: values.id,
          ...(values.messageId !== undefined ? { messageId: values.messageId } : {}),
          ...(values.offset !== undefined ? { offset: values.offset } : {}),
          ...(values.limit !== undefined ? { limit: values.limit } : {}),
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(value) }],
          details: { codingLog: value },
        }
      },
    },
  ]
}
