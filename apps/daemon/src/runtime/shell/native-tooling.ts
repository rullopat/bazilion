import { constants } from 'node:os'
import type { NativeExecutionFailure, NativeExecutionResult } from '@bazilion/api-types'
import {
  createBashToolDefinition,
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { codingRelativePath } from '../../core/coding-environment/config.ts'
import { WorkerNativeExecutionError } from '../worker/ipc-client.ts'
import type { NativeExecutionHost } from '../worker/ipc-protocol.ts'

const NATIVE_TRUNCATION_NOTE =
  'Native command capture was truncated; any saved full-output file contains only the retained capture.'

export interface NativeSessionExecution {
  readonly cwd: string
  readonly host: NativeExecutionHost
}

/** Worker-side description/proxy only. The daemon owns admission, paths and executable authority. */
export function snapshotNativeSessionExecution(
  value: NativeSessionExecution,
): NativeSessionExecution {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join(',') !== 'cwd,host' ||
    !value.host ||
    typeof value.host.exec !== 'function' ||
    typeof value.host.cancel !== 'function'
  )
    throw new Error('Native session capability is unavailable')
  return Object.freeze({ cwd: codingRelativePath(value.cwd), host: value.host })
}

export interface NativeSessionShellTools {
  readonly hostToolNames: readonly string[]
  readonly customBash: ToolDefinition
}
/** All file/coding operations are through the admitted command capability, never Pi host tools. */
export function createNativeSessionShellTools(
  modelCwd: string,
  relativeCwd: string,
  host: NativeExecutionHost,
): NativeSessionShellTools {
  const cwd = codingRelativePath(relativeCwd)
  let active: { id: string; invoked: boolean; result?: NativeExecutionResult } | undefined
  const base = createBashToolDefinition(modelCwd, {
    exposeSessionEnvironment: false,
    operations: {
      async exec(command, requestedCwd, options) {
        if (!active || active.invoked || requestedCwd !== modelCwd)
          throw new Error('Native bash scope is unavailable')
        active.invoked = true
        const seconds = options.timeout ?? 300
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300)
          throw new Error('Native bash timeout must be greater than zero and at most 300 seconds')
        // Pi's optional environment/session additions are deliberately not forwarded. The daemon
        // owns the frozen environment and approval gate; neither is a tool-call argument.
        const result = await host.exec(
          { toolCallId: active.id, command, cwd, timeoutMs: Math.ceil(seconds * 1000) },
          (_stream, bytes) => options.onData(bytes),
          options.signal,
        )
        active.result = result
        const signum = result.signal
          ? constants.signals[result.signal as keyof typeof constants.signals]
          : undefined
        return { exitCode: result.code ?? (signum ? 128 + signum : null) }
      },
    },
  })
  type NativeBashDetails = NonNullable<Awaited<ReturnType<typeof base.execute>>['details']> & {
    readonly nativeExecution?: NativeExecutionResult
    readonly nativeExecutionFailure?: NativeExecutionFailure
  }
  const tool = defineTool<typeof base.parameters, NativeBashDetails | undefined>({
    ...base,
    label: 'bash (native sandbox)',
    description: `${base.description} Default working directory: ${modelCwd}. Runs only through the daemon-admitted native sandbox. TCP/UDP, including localhost, are denied; only pipes and private per-job pathname Unix IPC are available. Team memory and admitted inputs are read-only. No host-tool, Docker or VM fallback. Dangerous commands require operator approval; unattended requests deny. Default and maximum timeout: 300 seconds.`,
    executionMode: 'sequential',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (active) throw new Error('Native bash invocation already active')
      const invocation: { id: string; invoked: boolean; result?: NativeExecutionResult } = {
        id: toolCallId,
        invoked: false,
      }
      active = invocation
      try {
        const result = await base.execute(toolCallId, params, signal, onUpdate, ctx)
        const captured = invocation.result
        if (!captured) throw new Error('Native bash execution evidence unavailable')
        const truncated = captured.stdoutTruncated || captured.stderrTruncated
        const structured = result.structuredContent
        return {
          ...result,
          ...(structured && typeof structured === 'object' && !Array.isArray(structured)
            ? {
                structuredContent: {
                  ...structured,
                  truncated:
                    ('truncated' in structured && structured.truncated === true) || truncated,
                },
              }
            : {}),
          content: [
            ...result.content,
            ...(truncated
              ? [
                  {
                    type: 'text' as const,
                    text: NATIVE_TRUNCATION_NOTE,
                  },
                ]
              : []),
          ],
          details: { ...result.details, nativeExecution: captured },
        }
      } catch (error) {
        if (error instanceof WorkerNativeExecutionError) {
          const failure = Object.freeze({
            code: error.code,
            cleanupConfirmed: error.cleanupConfirmed,
            ...(error.observation ? { observation: error.observation } : {}),
          })
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text:
                  error.message +
                  (error.observation
                    ? `\nNative boundary observation (diagnostics, not cleanup authority): ${JSON.stringify(error.observation)}`
                    : ''),
              },
            ],
            details: { nativeExecutionFailure: failure },
          }
        }
        if (
          error instanceof Error &&
          (invocation.result?.stdoutTruncated || invocation.result?.stderrTruncated)
        )
          throw new Error(`${error.message}\n${NATIVE_TRUNCATION_NOTE}`)
        throw error
      } finally {
        active = undefined
      }
    },
  })
  return Object.freeze({ hostToolNames: Object.freeze([]), customBash: tool })
}
