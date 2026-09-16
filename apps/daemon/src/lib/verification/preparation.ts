import type { ChatFrame } from '@bazilion/api-types'
import { resolveAgent } from '../../core/index.ts'
import type { VerificationRequestRecord } from '../../core/repos/verification-requests.ts'
import type { SpecialistVerificationWorkerSpec } from '../../runtime/index.ts'
import { spawnVerificationWorker } from '../../runtime/index.ts'
import type { VerificationCapabilityHost } from '../../runtime/tools/verification.ts'
import type { VerificationHost } from '../../runtime/worker/ipc-protocol.ts'
import { getCtx } from '../ctx.ts'
import { resolveProtectedProviderRuntime } from '../protected-provider.ts'
import {
  assertTrustedVerificationInvocation,
  createTrustedVerificationInvocation,
  type TrustedRestrictedVerificationInvocation,
} from '../turn-invocation.ts'

// BAZ-044: prepare and run one restricted verification turn.
//
// Mirrors the restricted review path deliberately: a verification turn is dispatched directly, not
// through turn preparation, so it carries no lifecycle claim and can never be confused with an
// ordinary writable coding turn.

export interface PreparedVerificationTurn {
  invocation: TrustedRestrictedVerificationInvocation
  spec: SpecialistVerificationWorkerSpec
  refreshApiKey: (providerName: string) => Promise<string>
}

export async function prepareVerificationTurn(input: {
  request: VerificationRequestRecord
  attemptId: string
}): Promise<PreparedVerificationTurn> {
  const { db, paths, authToken } = getCtx()
  const resolved = resolveAgent(db, paths, input.request.recipientAgentId)
  if (resolved.agent.id !== input.request.recipientAgentId) {
    throw new Error('verification request does not match the resolved specialist')
  }
  const invocation = createTrustedVerificationInvocation({
    kind: 'restricted_verification',
    authorization: {
      kind: 'request',
      requestId: input.request.id,
      attemptId: input.attemptId,
    },
    bashApprovalMode: 'auto_deny',
  })
  assertTrustedVerificationInvocation(invocation)
  const provider = await resolveProtectedProviderRuntime(
    db,
    authToken,
    resolved,
    resolved.agent.reasoningLevel,
  )
  return {
    invocation,
    spec: {
      kind: 'specialist_verification',
      agentId: input.request.recipientAgentId,
      message: verificationPrompt(input.request),
      turnId: input.attemptId,
      runtime: provider.runtime,
      verification: { requestId: input.request.id, attemptId: input.attemptId },
    },
    refreshApiKey: provider.refreshApiKey,
  }
}

/** The turn's instruction. Short by design: the boundaries live in the system prompt. */
function verificationPrompt(request: VerificationRequestRecord): string {
  return (
    `Verify the captured change for verification request ${request.id}.\n\n` +
    'Call verification_request to read the captured change, its environment and the checks your ' +
    'requester selected. Then run each declared check with verification_check, using its ordinal. ' +
    'Each check runs once; report failures as failures and blockers as blockers.'
  )
}

/**
 * Bind the capability to this turn's identity.
 *
 * The worker sends the request and attempt it believes it is acting for, and the daemon refuses
 * anything but its own binding — so a tool call cannot reach another request's attempt even if the
 * worker is compromised.
 */
export function bindVerificationCapability(
  host: VerificationCapabilityHost,
  identity: { requestId: string; attemptId: string },
): VerificationHost {
  const assertBound = (requestId: string, attemptId: string): void => {
    if (requestId !== identity.requestId || attemptId !== identity.attemptId) {
      throw new Error('verification capability is bound to a different request attempt')
    }
  }
  return {
    read: async (requestId, attemptId) => {
      assertBound(requestId, attemptId)
      return host.read()
    },
    run: async (requestId, attemptId, ordinal) => {
      assertBound(requestId, attemptId)
      return host.invoke(ordinal)
    },
  }
}

export function executePreparedVerification(
  prepared: PreparedVerificationTurn,
  opts: { verificationHost: VerificationHost; signal: AbortSignal },
): AsyncGenerator<ChatFrame, void, void> {
  // The claim is consumed by rendering it once: a prepared turn cannot be run twice, so a retry
  // must go through a fresh attempt rather than reusing this one.
  assertTrustedVerificationInvocation(prepared.invocation)
  return spawnVerificationWorker(prepared.spec, {
    signal: opts.signal,
    apiKeyRefreshHost: { refresh: prepared.refreshApiKey },
    verificationHost: opts.verificationHost,
  })
}
