import type { VerificationCheckInput } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import type {
  VerificationRequestHost,
  VerificationRequestIntent,
  VerificationRequestReceipt,
} from '../../runtime/tools/verification.ts'
import { captureTeamSnapshot } from '../git-review/service.ts'
import { resolveTeamMember } from '../team-member.ts'
import { captureVerificationRequest } from './capture.ts'

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
  /** Re-checked before the snapshot is taken, so a finished turn cannot capture anything. */
  assertActive: () => void
}

export function createVerificationRequestHost(
  input: VerificationRequestCapabilityInput,
): VerificationRequestHost {
  return {
    async capture(intent: VerificationRequestIntent): Promise<VerificationRequestReceipt> {
      input.assertActive()
      // Captured now, for this turn: the request must describe the change the requester is looking at,
      // not a capture it happened to know an id for.
      const captured = await captureTeamSnapshot(input.db, input.paths, input.teamId, {
        capturedBy: 'agent',
        agentId: input.agentId,
        turnId: input.turnId,
        toolCallId: `request_verification:${input.turnId}`,
      })
      input.assertActive()
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
      const result = captureVerificationRequest(input.db, input.paths, {
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
      })
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
}
