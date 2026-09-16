import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import type { CodingCommandReceipt } from '@bazilion/api-types'
import { type BashOperations, createLocalBashOperations } from '@earendil-works/pi-coding-agent'
import { codingRelativePath } from '../../core/coding-environment/config.ts'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { saveCodingCommandLog } from '../../core/repos/coding-command-logs.ts'
import { saveCodingCommand } from '../../core/repos/coding-commands.ts'
import type { VerificationRequestRecord } from '../../core/repos/verification-requests.ts'
import { resolveCodingDirectory } from '../../runtime/coding-directory.ts'
import {
  createDockerBashOperations,
  type DockerReadOnlyMount,
  type DockerResourceLifecycle,
} from '../../runtime/shell/docker.ts'
import {
  buildScrubbedShellEnv,
  classifyBashCommand,
  resolveShellSecurityConfig,
} from '../../runtime/shell/security.ts'
import { buildSandboxContainerEnv, safeReadOnlyMount } from '../../runtime/shell/tooling.ts'
import { redactJsonValue } from '../../runtime/worker/runtime.ts'
import {
  CODING_OUTPUT_BYTES,
  codingSecrets,
  diagnosticTail,
} from '../coding-environment/diagnostics.ts'
import { workspaceIdentity } from '../coding-environment/workspace.ts'
import type { VerificationCheckExecutor, VerificationCheckExecutorResult } from './runner.ts'

// BAZ-044: run one captured check daemon-side and publish a real BAZ-041 receipt.
//
// A verification turn has no coding host — the worker holds only the capability — so the daemon
// executes the checks itself. It does not reimplement execution: it uses the same shell operations a
// coding turn uses (host or the preflighted container path), the same posture resolution, the same
// redaction and the same receipt lifecycle.
//
// Three rules this module exists to enforce:
//
//   1. **The frozen environment is authoritative.** If the request was captured against a container
//      but the daemon is now running host-backed, the check is blocked. It never silently runs on the
//      host against an environment the requester did not approve.
//   2. **A command needing unavailable approval is blocked, never auto-approved.** Verification turns
//      run unattended, so an interactive approval cannot be answered.
//   3. **The receipt state comes from the observed process.** Never from the model's description.
//
// A container check runs with the *same* posture as a sandboxed coding command — the same read-only
// memory over-mount, the same recovery registration — because a receipt that claims `read_only_memory`
// while memory is writable is worse than one that claims nothing.

export interface ProtectedCheckExecutorInput {
  db: BazilionDb
  paths: Paths
  request: VerificationRequestRecord
  attemptId: string
  /** The Team workspace root the checks run in (also mounted read/write in container mode). */
  teamPath: string
  /**
   * Live secrets supplier, read at command start. BAZ-041 gap 3: a credential learned mid-turn must
   * join redaction instead of leaking into a retained diagnostic.
   */
  secrets: () => readonly string[]
  /** Aborts with the turn: the running command is killed and reported as cancelled. */
  signal?: AbortSignal
  /**
   * Container recovery registration, so a container this check created is tracked against the held
   * workspace lease and can be reconciled after a daemon restart instead of leaking. Ignored for a
   * host-posture check.
   */
  containerLifecycle?: DockerResourceLifecycle
  env?: NodeJS.ProcessEnv
}

export function createProtectedCheckExecutor(
  input: ProtectedCheckExecutorInput,
): VerificationCheckExecutor {
  const env = input.env ?? process.env
  return {
    async run({ command, cwd, timeoutMs }): Promise<VerificationCheckExecutorResult> {
      const config = resolveShellSecurityConfig(env)
      const wantsContainer = input.request.environment.sandbox === 'docker'
      const isContainer = config.sandboxMode === 'docker'

      // Rule 1: the frozen posture and the live posture must agree.
      if (wantsContainer !== isContainer) {
        return blocked(
          'environment_unavailable',
          wantsContainer
            ? 'this request was captured against a container, but shell isolation is not active'
            : 'this request was captured for host execution, but shell isolation is active',
        )
      }

      // Rule 2: unattended turns cannot answer an approval prompt, so a risky command is blocked
      // rather than run. The reason is explicit so the operator can approve and re-request.
      if (config.approvalMode === 'dangerous' && classifyBashCommand(command).length > 0) {
        return blocked(
          'approval_required',
          'this check needs a command approval that an unattended verification turn cannot obtain',
        )
      }

      const relative = codingRelativePath(cwd || '.')
      const { path: absoluteCwd } = resolveCodingDirectory(input.teamPath, relative)
      const secrets = input.secrets()
      if (secrets.some((secret) => secret && command.includes(secret))) {
        return blocked('unsupported', 'the captured command contains protected credential material')
      }

      // Resolved before the receipt exists: a check that cannot be run through the posture the
      // request was captured with must leave no evidence behind — not even a receipt in `running`.
      const container = buildContainerOperations(input, env, config.envAllowlist, absoluteCwd)
      if ('blocked' in container) return blocked('environment_unavailable', container.blocked)

      const commandId = randomUUID()
      const startedAt = Date.now()
      // The receipt names what it was verified against. `sourceBefore` is the request's snapshot —
      // the exact tree admission proved still matched — and not a capture of its own.
      const receipt: CodingCommandReceipt = {
        id: commandId,
        agentId: input.request.recipientAgentId,
        teamId: input.request.teamId,
        turnId: input.attemptId,
        toolCallId: `verification:${input.attemptId}:${randomUUID()}`,
        input: {
          command,
          cwd: relative,
          purpose: 'verification',
          timeoutSeconds: Math.max(1, Math.round(timeoutMs / 1000)),
        },
        environment: {
          posture: 'protected',
          imageId: isContainer ? input.request.environment.image : null,
          cwd: relative,
          rootIdentity: workspaceIdentity(input.teamPath).rootIdentity,
          // No repository-context fingerprint is computed for a verification check, so it is absent
          // rather than invented. Unknown applicability is reported as unknown.
          inputFingerprint: null,
          capturedAt: startedAt,
          // Declared output paths name where a check is expected to write; they do not confine it in
          // host mode, and the receipt must not imply otherwise. Any write still makes the tree differ
          // from the captured snapshot, which is reported as `changed` rather than as a pass.
          restrictions: [
            ...(isContainer ? ['network_disabled', 'read_only_memory'] : []),
            'declared_output_paths_are_advisory',
          ],
        },
        startedAt,
        finishedAt: null,
        state: 'running',
        exitCode: null,
        diagnostic: '',
        truncated: false,
        reason: null,
        sourceBefore: {
          id: input.request.snapshotId,
          complete: input.request.snapshotComplete,
          capturedAt: input.request.createdAt,
        },
        sourceAfter: null,
      }
      saveCodingCommand(input.db, receipt)

      const operations = container.operations
      let observed = ''
      let observedBytes = 0
      let truncatedStream = false
      // Never the daemon's ambient environment. A check is a protected turn's command, so it gets the
      // scrubbed allowlist environment (plus what the request froze), exactly like a sandboxed one —
      // otherwise a captured check could read credentials the receipt claims it was protected from.
      const hostEnv = {
        ...buildScrubbedShellEnv(env, config.envAllowlist),
        ...(input.request.environment.env ?? {}),
      }
      let exitCode: number | null = null
      let failure: unknown
      try {
        const result = await operations.exec(command, absoluteCwd, {
          signal: input.signal,
          timeout: timeoutMs,
          // Host mode runs with the scrubbed environment above; container mode supplies its own.
          ...(isContainer ? {} : { env: hostEnv }),
          onData: (chunk: Buffer) => {
            // Bounded while streaming: a runaway command cannot grow the diagnostic without limit.
            if (observedBytes >= CODING_OUTPUT_BYTES * 4) return
            const text = chunk.toString('utf8')
            observed += text
            observedBytes += Buffer.byteLength(text)
          },
        })
        exitCode = result.exitCode
        if (observedBytes > CODING_OUTPUT_BYTES) truncatedStream = true
      } catch (error) {
        failure = error
      }

      const finishedAt = Date.now()
      const redaction = redactJsonValue(observed, secrets)
      const redacted = redaction !== observed
      const tail = diagnosticTail(redaction, CODING_OUTPUT_BYTES)
      const state = resolveState(exitCode, failure, input.signal)
      receipt.finishedAt = finishedAt
      receipt.state = state
      receipt.exitCode = state === 'succeeded' || state === 'failed' ? exitCode : null
      receipt.diagnostic = tail.text
      receipt.truncated = truncatedStream || tail.truncated
      receipt.reason =
        state === 'blocked'
          ? 'check could not start'
          : state === 'timed_out'
            ? 'check exceeded its captured timeout'
            : state === 'cancelled'
              ? 'check was cancelled with its turn'
              : null
      saveCodingCommand(input.db, receipt)
      saveCodingCommandLog(input.db, {
        commandId,
        teamId: input.request.teamId,
        agentId: input.request.recipientAgentId,
        turnId: input.attemptId,
        toolCallId: receipt.toolCallId,
        diagnostic: redaction,
        observedBytes,
        redacted,
        truncated: receipt.truncated,
      })

      if (state === 'blocked') {
        return blocked(
          'unsupported',
          failure instanceof Error ? failure.message : 'the captured check could not start',
        )
      }
      return {
        commandId,
        state,
        exitCode: state === 'succeeded' || state === 'failed' ? exitCode : null,
        output: tail.text,
        truncated: receipt.truncated,
      }
    },
  }
}

type ContainerOperations = { operations: BashOperations } | { blocked: string }

function buildContainerOperations(
  input: ProtectedCheckExecutorInput,
  env: NodeJS.ProcessEnv,
  envAllowlist: readonly string[],
  /** The directory that becomes the container's `/workspace`. */
  containerWorkspace: string,
): ContainerOperations {
  if (input.request.environment.sandbox !== 'docker') {
    return { operations: createLocalBashOperations() }
  }
  const memoryMount = sandboxMemoryMount(input.teamPath, containerWorkspace)
  if ('blocked' in memoryMount) return memoryMount
  // The same container path a coding turn uses: fresh, network-disabled, with the Team workspace
  // mounted read/write, the shared memory subtree over-mounted read-only, no host credentials or host
  // files reachable, and the container registered under the held workspace lease for recovery.
  return {
    operations: createDockerBashOperations({
      ...(input.containerLifecycle ? { lifecycle: input.containerLifecycle } : {}),
      image: input.request.environment.image,
      env: buildSandboxContainerEnv(env, envAllowlist),
      readOnlyMounts: memoryMount.mounts,
    }),
  }
}

/**
 * The Team's shared memory, over-mounted read-only inside the container — the mount the receipt's
 * `read_only_memory` restriction actually refers to.
 *
 * Memory writes belong to the scoped `memory_*` tools, so a captured check must not reach them. If the
 * memory directory exists but cannot be mounted safely (a symlink, a non-directory), the check is
 * **blocked** rather than run with memory writable: fail closed, never silently weaken the posture.
 */
function sandboxMemoryMount(
  teamPath: string,
  containerWorkspace: string,
): { mounts: DockerReadOnlyMount[] } | { blocked: string } {
  const memorySource = join(teamPath, 'memory')
  if (!existsSync(memorySource)) return { mounts: [] }
  const inside = relative(containerWorkspace, memorySource)
  // Outside the mounted tree the memory directory is not reachable at all, which is already safe.
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`)) return { mounts: [] }
  try {
    return {
      mounts: [
        safeReadOnlyMount(memorySource, posix.join('/workspace', ...inside.split(sep)), teamPath),
      ],
    }
  } catch (error) {
    return {
      blocked: `the Team memory directory cannot be mounted read-only for this check (${
        error instanceof Error ? error.message : String(error)
      })`,
    }
  }
}

/** The outcome comes from the observed process, never from a description of it. */
function resolveState(
  exitCode: number | null,
  failure: unknown,
  signal: AbortSignal | undefined,
): 'succeeded' | 'failed' | 'blocked' | 'timed_out' | 'cancelled' {
  if (signal?.aborted) return 'cancelled'
  if (failure) return 'blocked'
  if (exitCode === null) return 'timed_out'
  return exitCode === 0 ? 'succeeded' : 'failed'
}

function blocked(
  reason: 'environment_unavailable' | 'approval_required' | 'unsupported',
  detail: string,
): VerificationCheckExecutorResult {
  return {
    commandId: null,
    state: 'blocked',
    exitCode: null,
    output: detail,
    truncated: false,
    blocker: { reason, detail },
  }
}
