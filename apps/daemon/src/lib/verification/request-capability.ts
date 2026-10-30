import type { VerificationCheckInput } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { get as getAgent } from '../../core/repos/agents.ts'
import type {
  VerificationRequestHost,
  VerificationRequestIntent,
  VerificationRequestReceipt,
} from '../../runtime/tools/verification.ts'
import { captureTeamSnapshot, requireTeam } from '../git-review/service.ts'
import {
  assertBoundNativeTurnForWorker,
  assertNativeTurn,
  type NativeTurnExecution,
} from '../native-execution/turn.ts'
import { resolveTeamMember } from '../team-member.ts'
import { captureVerificationRequest, type VerificationCaptureIntent } from './capture.ts'
import { assertVerificationCommandSecrets } from './capture-input.ts'
import { prepareNativeAgentVerificationCapture } from './native-capture.ts'

// BAZ-044: the requester's half of the loop.
//
// The story's task experience is "have our tester verify this fix": the coder captures the current
// change and the commands it wants run, sends one request, and yields. Without this the only requester
// could be the operator, which made the result delivery — the piece that tells the coder what happened —
// unreachable in practice. Both halves are needed for the loop to close, and this is the one a coding
// turn reaches.
//
// Identity is bound here, in the daemon, from the turn that owns the host: the worker supplies the
// specialist and the checks, and nothing else. A worker cannot request verification *as someone else*,
// because it never states who it is.

export interface VerificationRequestCapabilityInput {
  db: BazilionDb
  paths: Paths
  agentId: string
  teamId: string
  turnId: string
  native?: NativeTurnExecution
  secrets?: () => readonly string[]
  /** Re-checked before the snapshot is taken, so a finished turn cannot capture anything. */
  assertActive: () => void
}

const nativeHosts = new WeakMap<object, VerificationRequestCapabilityInput>()
export function isNativeVerificationRequestHost(value: unknown): boolean {
  return !!value && typeof value === 'object' && nativeHosts.has(value)
}
/** Parent-side admission only; the worker's actual native binding is consumed before input. */
export function assertNativeVerificationRequestHost(
  value: unknown,
  binding: { agentId: string; teamId: string; turnId: string; native: NativeTurnExecution },
): asserts value is VerificationRequestHost {
  if (!value || typeof value !== 'object')
    throw new Error('Native verification requester is unavailable')
  const owner = nativeHosts.get(value)
  if (
    !owner ||
    owner.native !== binding.native ||
    owner.agentId !== binding.agentId ||
    owner.teamId !== binding.teamId ||
    owner.turnId !== binding.turnId
  )
    throw new Error('Native verification requester is unavailable')
  owner.assertActive()
  assertNativeTurn(owner.native)
  const actor = getAgent(owner.db, owner.agentId)
  if (!actor || actor.teamId !== owner.teamId || actor.status === 'archived')
    throw new Error('Native verification requester is unavailable')
}
export function createVerificationRequestHost(
  options: VerificationRequestCapabilityInput,
): VerificationRequestHost {
  const input = Object.freeze({ ...options })
  if (input.native) {
    assertNativeTurn(input.native)
    if (typeof input.secrets !== 'function')
      throw new Error('Native verification requester requires live secret refusal')
  }
  const readNativeSecrets = () => {
    if (!input.secrets) throw new Error('Native verification requester secrets unavailable')
    return input.secrets()
  }
  const nativeBinding = input.native
    ? {
        agentId: input.agentId,
        teamId: input.teamId,
        turnId: input.turnId,
        registeredRoot: requireTeam(input.db, input.paths, input.teamId).path,
        admission: { cwd: input.native.cwd, facts: input.native.facts },
      }
    : undefined
  const check = () => {
    input.assertActive()
    if (input.native && nativeBinding) assertBoundNativeTurnForWorker(input.native, nativeBinding)
  }
  const host: VerificationRequestHost = {
    async capture(
      raw: VerificationRequestIntent,
      signal?: AbortSignal,
    ): Promise<VerificationRequestReceipt> {
      const intent = {
        ...raw,
        checks: raw.checks.map((value) => ({ ...value })),
        ...(raw.writablePaths ? { writablePaths: [...raw.writablePaths] } : {}),
      }
      const assertRequestActive = () => {
        signal?.throwIfAborted()
        check()
      }
      assertRequestActive()
      if (input.native) assertVerificationCommandSecrets(intent, readNativeSecrets())
      // Captured now, for this turn: the request must describe the change the requester is looking at,
      // not a capture it happened to know an id for.
      const captured = await captureTeamSnapshot(input.db, input.paths, input.teamId, {
        capturedBy: 'agent',
        agentId: input.agentId,
        turnId: input.turnId,
        toolCallId: `request_verification:${input.turnId}`,
      })
      assertRequestActive()
      if (!captured.snapshot.complete) {
        // An incomplete capture cannot support a claim about the change, so it is refused with the
        // reasons rather than handed to a specialist as if it were exact.
        const reasons = captured.snapshot.issues.map((issue) => issue.code).join(', ')
        throw new Error(
          `the change could not be captured exactly${reasons ? ` (${reasons})` : ''}; nothing was requested`,
        )
      }
      // A model knows its teammates by *name*. Requiring a UUID meant the only way to find one was to go
      // looking for it — which a real model did, by reading the agent directories with bash. That
      // workaround does not exist under container isolation, where those paths are not mounted at all,
      // so the contract has to accept what an agent actually knows.
      const resolved = resolveTeamMember(input.db, {
        teamId: input.teamId,
        requested: intent.specialist,
        excludeAgentId: input.agentId,
      })
      if ('error' in resolved) throw new Error(resolved.error)

      const checks: VerificationCheckInput[] = intent.checks.map((check) => ({
        command: check.command,
        purpose: check.purpose,
        // Canonical, because this is the stored contract a receipt will quote: an empty or padded cwd
        // means the workspace root, and it is recorded as such rather than passed through as given.
        cwd: check.cwd?.trim() || '.',
        timeoutMs: Math.max(1, Math.round((check.timeoutSeconds ?? 120) * 1000)),
      }))
      const captureIntent: VerificationCaptureIntent = {
        teamId: input.teamId,
        requesterKind: 'agent',
        requesterAgentId: input.agentId,
        recipientAgentId: resolved.agentId,
        snapshotId: captured.reference.id,
        checks,
        summary: intent.summary ?? null,
        sourceSessionId: null,
        ...(intent.writablePaths && intent.writablePaths.length > 0
          ? { writablePaths: intent.writablePaths }
          : {}),
      }
      const native =
        input.native && nativeBinding
          ? await prepareNativeAgentVerificationCapture({
              db: input.db,
              paths: input.paths,
              intent: captureIntent,
              host: input.native,
              binding: nativeBinding,
              secrets: readNativeSecrets,
            })
          : undefined
      if (native?.kind === 'blocked')
        throw new Error(
          `verification was not requested: ${native.blocker.reason} — ${native.blocker.detail}`,
        )
      assertRequestActive()
      const result = captureVerificationRequest(
        input.db,
        input.paths,
        native?.intent ?? captureIntent,
        undefined,
        native?.capture,
      )
      // A refusal is a result with a reason: nothing was written, and the model must not be told
      // otherwise.
      if (result.kind === 'blocked') {
        throw new Error(
          `verification was not requested: ${result.blocker.reason} — ${result.blocker.detail}`,
        )
      }
      const record = result.request
      return {
        requestId: record.id,
        snapshotId: record.snapshotId,
        specialist: record.recipientAgentId,
        state: record.state,
        checks: checks.map((check, ordinal) => ({
          ordinal,
          command: check.command,
          cwd: check.cwd,
          timeoutMs: check.timeoutMs,
        })),
      }
    },
  }
  if (input.native) nativeHosts.set(host, input)
  return Object.freeze(host)
}
