import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CodingCommandReceipt,
  CodingEnvironmentValues,
  NativeExecutionFacts,
} from '@bazilion/api-types'
import {
  codingRelativePath,
  validateCodingEnvironmentConfig,
} from '../../core/coding-environment/config.ts'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import * as agentRepo from '../../core/repos/agents.ts'
import { saveCodingCommandLog } from '../../core/repos/coding-command-logs.ts'
import { saveCodingCommand } from '../../core/repos/coding-commands.ts'
import {
  getVerificationRequestById,
  listVerificationChecks,
} from '../../core/repos/verification-requests.ts'
import { BashApprovalDeniedError, requireBashApproval } from '../../runtime/shell/approval.ts'
import { MAC_PROTECTED_EXECUTION_UNAVAILABLE } from '../../runtime/shell/platform-support.ts'
import { assertNativeExecutionAdmission } from '../../runtime/worker/native-contract.ts'
import { dispatchNativeExecution } from '../../runtime/worker/native-execution-dispatch.ts'
import { ownsActiveAgent } from '../agent-cancel.ts'
import { commandApprovalRegistry } from '../bash-approval.ts'
import {
  CODING_OUTPUT_BYTES,
  CODING_RETAINED_BYTES,
  CodingDiagnostics,
  diagnosticTail,
} from '../coding-environment/diagnostics.ts'
import { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import { resolveTeamNativeCodingEnvironment } from '../coding-environment/resolve.ts'
import type { WorkspaceLease } from '../coding-environment/workspace.ts'
import { readSnapshotApplicability, readTeamSnapshot, requireTeam } from '../git-review/service.ts'
import { snapshotReference } from '../git-review/snapshot.ts'
import {
  NativeCommandError,
  type NativeCommandFailureObservation,
} from '../native-execution/command.ts'
import {
  assertNativeTurn,
  type NativeTurnExecution,
  nativeTurnFailureObservation,
  prepareNativeTurn,
} from '../native-execution/turn.ts'
import { ProtectedExecutionUnavailableError } from '../protected-execution-error.ts'
import { NativeVerificationPreparationError } from './native-error.ts'

export { NativeVerificationPreparationError } from './native-error.ts'

import { ContextDirectory } from '../repository-context/files.ts'
import { nativeVerificationFailureState, nativeVerificationResultState } from './native-outcome.ts'
import type { VerificationCheckExecutor, VerificationCheckExecutorResult } from './runner.ts'

export interface PrepareNativeVerificationExecutor {
  readonly db: BazilionDb
  readonly paths: Paths
  readonly requestId: string
  readonly attemptId: string
  readonly leaseOwner: string
  readonly lease: WorkspaceLease
  readonly controller: AbortController
  readonly secrets: () => readonly string[]
  /** Canonical dispatch revalidates installation selection; not an executor-fact requirement. */
  readonly assertSelection?: () => void
}
export interface PreparedNativeVerificationExecutor {
  readonly executor: VerificationCheckExecutor
  readonly facts: NativeExecutionFacts
  /** Closed diagnostics, no PIDs or signalling authority. Stopped admissions remain readable. */
  failureObservation(): NativeCommandFailureObservation | undefined
  close(): Promise<boolean>
}
const unavailable = () =>
  new ProtectedExecutionUnavailableError(
    'Protected native verification runtime is unavailable. Run `bazilion doctor` for remediation.',
  )
const sameFacts = (a: NativeExecutionFacts, b: NativeExecutionFacts) =>
  (
    [
      'backend',
      'architecture',
      'nodeVersion',
      'kernelRelease',
      'policyFingerprint',
      'fingerprint',
    ] as const
  ).every((key) => a[key] === b[key])
const sameValues = (a: CodingEnvironmentValues, b: CodingEnvironmentValues) =>
  (['CI', 'NO_COLOR', 'TZ'] as const).every((key) => a[key] === b[key])
const blocked = (
  detail: string,
  reason:
    | 'environment_unavailable'
    | 'approval_required'
    | 'unsupported' = 'environment_unavailable',
): VerificationCheckExecutorResult => ({
  state: 'blocked',
  commandId: null,
  exitCode: null,
  output: detail,
  truncated: false,
  blocker: { reason, detail },
})

/** Internal executor only. Public selection/capture/dispatch must still admit the immutable request. */
export async function prepareNativeVerificationExecutor(
  input: PrepareNativeVerificationExecutor,
): Promise<PreparedNativeVerificationExecutor> {
  if (process.platform === 'darwin')
    throw new ProtectedExecutionUnavailableError(MAC_PROTECTED_EXECUTION_UNAVAILABLE)
  const options = Object.freeze({ ...input })
  const { db, lease, controller } = options
  const lifetime = new AbortController()
  const request = getVerificationRequestById(db, options.requestId)
  if (request?.environment.sandbox !== 'native' || !options.leaseOwner) throw unavailable()
  const frozen = request.environment
  if (frozen.image !== null || frozen.inputScope !== 'team-memory' || !request.snapshotComplete)
    throw unavailable()
  const defaults = validateCodingEnvironmentConfig({
    backend: 'native',
    cwd: frozen.cwd,
    env: frozen.env,
  })
  assertNativeExecutionAdmission({ cwd: frozen.cwd, facts: frozen.native })
  const capturedSource = readTeamSnapshot(db, options.paths, request.teamId, request.snapshotId)
  if (
    !capturedSource?.complete ||
    capturedSource.id !== request.snapshotId ||
    capturedSource.head !== request.head ||
    capturedSource.base.resolvedOid !== request.baseOid ||
    !Number.isSafeInteger(capturedSource.capturedAt)
  )
    throw unavailable()
  const sourceBefore = snapshotReference(capturedSource)
  const checks = listVerificationChecks(db, request.id)
  for (const check of checks) codingRelativePath(check.cwd)
  const lifecycle = workspaceLifecycle(db)
  // Evidence finalization does not require an executable native admission/active writer.
  const assertEvidence = () => {
    const actor = agentRepo.get(db, request.recipientAgentId)
    if (!actor || actor.teamId !== request.teamId || actor.status === 'archived')
      throw unavailable()
  }
  const assertActive = () => {
    controller.signal.throwIfAborted()
    options.assertSelection?.()
    assertEvidence()
    if (!ownsActiveAgent(request.recipientAgentId, controller)) throw unavailable()
    const team = requireTeam(db, options.paths, request.teamId)
    lifecycle.coordinator.assertActiveLease(lease, request.teamId, team.path)
    const attempt = db.raw
      .query<
        {
          request_id: string
          lease_owner: string | null
          lease_expires_at: number | null
          finished_at: number | null
        },
        [string]
      >(
        `SELECT request_id,lease_owner,lease_expires_at,finished_at FROM verification_attempts WHERE id=?`,
      )
      .get(options.attemptId)
    if (
      !attempt ||
      attempt.request_id !== request.id ||
      attempt.lease_owner !== options.leaseOwner ||
      attempt.finished_at !== null ||
      (attempt.lease_expires_at ?? 0) <= Date.now()
    )
      throw unavailable()
    const live = getVerificationRequestById(db, request.id)
    if (
      !live ||
      live.expiresAt <= Date.now() ||
      live.recipientAgentId !== request.recipientAgentId ||
      live.teamId !== request.teamId ||
      live.snapshotId !== request.snapshotId ||
      JSON.stringify(live.environment) !== JSON.stringify(frozen)
    )
      throw unavailable()
    const selection = resolveTeamNativeCodingEnvironment(db, request.teamId)
    if (selection.cwd !== defaults.cwd || !sameValues(selection.env, defaults.env))
      throw unavailable()
  }
  assertActive()
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-native-verification-')))
  let guard: ContextDirectory | undefined, host: NativeTurnExecution | undefined
  let preparationReason: NativeVerificationPreparationError['reason'] = 'unavailable'
  const approvalHost = {
    async requestApproval(
      args: Parameters<
        NonNullable<Parameters<typeof requireBashApproval>[3]>['requestApproval']
      >[0],
    ): Promise<'approved' | 'denied'> {
      const signal = AbortSignal.any([
        controller.signal,
        lifetime.signal,
        ...(args.signal ? [args.signal] : []),
      ])
      signal.throwIfAborted()
      const handle = commandApprovalRegistry.begin(
        {
          id: randomUUID(),
          agentId: request.recipientAgentId,
          teamId: request.teamId,
          turnId: options.attemptId,
          toolCallId: args.toolCallId,
          command: args.command,
          risks: [...args.risks],
          mode: 'auto_deny',
        },
        signal,
      )
      const decision = await handle.decision
      return decision.decision === 'allow' ? 'approved' : 'denied'
    },
  }
  try {
    guard = new ContextDirectory(root)
    host = await prepareNativeTurn({
      root,
      lifecycle,
      lease,
      cwd: defaults.cwd,
      env: { ...defaults.env },
      readOnlyDirectories: [],
      readOnlyFiles: [],
      unavailable: [],
      signal: controller.signal,
      assertActive,
      secrets: options.secrets,
      approvalHost,
    })
    assertActive()
    if (!sameFacts(host.facts, frozen.native)) {
      preparationReason = 'runtime_changed'
      throw unavailable()
    }
    const applicability = await readSnapshotApplicability(
      db,
      options.paths,
      request.teamId,
      request.snapshotId,
    )
    if (applicability.comparison !== 'identical') {
      preparationReason =
        applicability.comparison === 'changed' ? 'source_changed' : 'source_unverifiable'
      throw unavailable()
    }
    assertActive()
    guard.validateIdentity()
    guard.close()
    guard = undefined
  } catch (error) {
    let confirmed = host
      ? await host.close().catch(() => false)
      : error instanceof NativeCommandError && error.cleanupConfirmed
    try {
      if (!host && confirmed && guard) {
        guard.validateIdentity()
        guard.close()
        guard = undefined
        rmSync(root, { recursive: true })
      }
      guard?.close()
    } catch {
      confirmed = false
    }
    if (!confirmed) lease.finish(false)
    const observation =
      error instanceof NativeCommandError
        ? error.observation
        : host
          ? nativeTurnFailureObservation(host)
          : undefined
    throw new NativeVerificationPreparationError(
      confirmed ? preparationReason : 'recovery_required',
      confirmed,
      observation,
    )
  }
  const owned = host
  let closed = false
  const invoked = new Set<number>()
  const inFlight = new Set<Promise<VerificationCheckExecutorResult>>()
  return Object.freeze({
    facts: owned.facts,
    failureObservation: () => nativeTurnFailureObservation(owned),
    executor: Object.freeze({
      run(
        args: Parameters<VerificationCheckExecutor['run']>[0],
      ): Promise<VerificationCheckExecutorResult> {
        const operation = (async (): Promise<VerificationCheckExecutorResult> => {
          const check = checks.find((value) => value.ordinal === args.ordinal)
          if (
            !check ||
            check.command !== args.command ||
            check.cwd !== args.cwd ||
            check.timeoutMs !== args.timeoutMs ||
            args.purpose !== 'verification' ||
            JSON.stringify(args.writablePaths) !== JSON.stringify(frozen.writablePaths ?? [])
          )
            return blocked(
              'Only the captured ordinal and its frozen command may execute.',
              'unsupported',
            )
          if (invoked.has(check.ordinal))
            return blocked('The captured ordinal was already invoked.', 'unsupported')
          invoked.add(check.ordinal)
          try {
            if (closed) throw unavailable()
            assertActive()
            assertNativeTurn(owned)
          } catch {
            return blocked('The native verification attempt is no longer admitted.')
          }
          if (options.secrets().some((value) => value && check.command.includes(value)))
            return blocked(
              'The captured command contains protected credential material.',
              'unsupported',
            )
          const signal = AbortSignal.any([
            controller.signal,
            lifetime.signal,
            ...(args.signal ? [args.signal] : []),
          ])
          const toolCallId = `verification:${options.attemptId}:${check.ordinal}`
          try {
            await requireBashApproval(check.command, toolCallId, signal, approvalHost)
            assertActive()
          } catch (error) {
            return blocked(
              error instanceof BashApprovalDeniedError
                ? 'This unattended check cannot obtain dangerous-command approval.'
                : 'The native check was cancelled before execution.',
              error instanceof BashApprovalDeniedError
                ? 'approval_required'
                : 'environment_unavailable',
            )
          }
          const commandId = randomUUID(),
            startedAt = Date.now()
          const receipt: CodingCommandReceipt = {
            id: commandId,
            agentId: request.recipientAgentId,
            teamId: request.teamId,
            turnId: options.attemptId,
            toolCallId,
            input: {
              command: check.command,
              cwd: check.cwd,
              purpose: 'verification',
              timeoutSeconds: Math.max(1, Math.ceil(check.timeoutMs / 1000)),
            },
            environment: {
              posture: 'native',
              imageId: null,
              native: owned.facts,
              cwd: check.cwd,
              rootIdentity: lease.writer.rootIdentity,
              inputFingerprint: createHash('sha256')
                .update(
                  JSON.stringify({
                    runtime: owned.facts,
                    defaultCwd: owned.cwd,
                    cwd: check.cwd,
                    env: owned.env,
                    inputScope: frozen.inputScope,
                  }),
                )
                .digest('hex'),
              capturedAt: startedAt,
              restrictions: [
                'native_os_sandbox_not_container',
                'network_tcp_udp_denied',
                'private_pathname_unix_ipc',
                'read_only_team_memory',
                'no_private_agent_inputs',
                'declared_output_paths_are_advisory',
                'no_host_or_docker_fallback',
                'no_aggregate_resource_quotas',
              ],
            },
            startedAt,
            finishedAt: null,
            state: 'running',
            exitCode: null,
            diagnostic: '',
            truncated: false,
            reason: null,
            sourceBefore,
            sourceAfter: null,
          }
          saveCodingCommand(db, receipt)
          const diagnostics = new CodingDiagnostics([], CODING_RETAINED_BYTES)
          let observedBytes = 0,
            redacted = false,
            truncated = false
          let state: VerificationCheckExecutorResult['state'] = 'unknown',
            exitCode: number | null = null
          let failureFacts: unknown
          try {
            const result = await dispatchNativeExecution(
              { toolCallId, command: check.command, cwd: check.cwd, timeoutMs: check.timeoutMs },
              owned,
              {
                assertActive,
                secrets: options.secrets,
                signal,
                async send(output) {
                  observedBytes = Math.max(observedBytes, output.observedBytes)
                  redacted ||= output.redacted
                  diagnostics.append(Buffer.from(output.data, 'base64'))
                },
              },
            )
            truncated = result.stdoutTruncated || result.stderrTruncated
            exitCode = result.code
            state = nativeVerificationResultState(result, signal.aborted)
            if (result.signal !== null || result.code === null)
              failureFacts = {
                kind: 'returned',
                cleanupConfirmed: true,
                signalPresent: result.signal !== null,
                codePresent: result.code !== null,
                cancelled: signal.aborted,
              }
          } catch (error) {
            // No terminal capture facts: retained output cannot be presented as complete.
            truncated = true
            state = nativeVerificationFailureState(error, signal.aborted)
            failureFacts =
              error instanceof NativeCommandError
                ? {
                    kind: 'native',
                    code: error.code,
                    cleanupConfirmed: error.cleanupConfirmed,
                    cancelled: signal.aborted,
                    ...(error.observation ? { observation: error.observation } : {}),
                  }
                : { kind: 'unclassified', cancelled: signal.aborted }
          }
          const retained = diagnostics.finish(),
            tail = diagnosticTail(retained.diagnostic, CODING_OUTPUT_BYTES)
          receipt.finishedAt = Date.now()
          receipt.state = state === 'unknown' ? 'interrupted' : state
          receipt.exitCode = state === 'succeeded' || state === 'failed' ? exitCode : null
          receipt.diagnostic = tail.text
          receipt.truncated = truncated || retained.truncated || tail.truncated
          receipt.reason =
            state === 'unknown'
              ? `Native verification execution or cleanup is uncertain. ${JSON.stringify(failureFacts)}`
              : state === 'timed_out'
                ? 'Check exceeded its captured timeout.'
                : state === 'cancelled'
                  ? `Check was cancelled with its attempt.${failureFacts ? ` ${JSON.stringify(failureFacts)}` : ''}`
                  : null
          // The receipt was issued before execution. Native stop/recovery cannot leave it running.
          assertEvidence()
          saveCodingCommand(db, receipt)
          saveCodingCommandLog(db, {
            commandId,
            agentId: request.recipientAgentId,
            teamId: request.teamId,
            turnId: options.attemptId,
            toolCallId,
            diagnostic: retained.diagnostic,
            observedBytes,
            redacted,
            truncated: receipt.truncated,
          })
          return {
            state,
            commandId,
            exitCode: receipt.exitCode,
            output: tail.text,
            truncated: receipt.truncated,
          }
        })()
        inFlight.add(operation)
        void operation.finally(() => inFlight.delete(operation)).catch(() => {})
        return operation
      },
    }),
    async close() {
      closed = true
      lifetime.abort()
      const settling = owned.close()
      await Promise.allSettled([...inFlight])
      return settling
    },
  })
}
