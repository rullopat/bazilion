// Server functions for the verification panel (BAZ-044). These run on the server and forward the
// caller's bounded session cookies to the loopback daemon, like `lib/git-review.ts`.

import { ApiClientError } from '@bazilion/client'
import type {
  VerificationBlockedResponse,
  VerificationCheckInput,
  VerificationListResponse,
  VerificationResponse,
  VerificationReport,
} from '@bazilion/api-types'
import { createServerFn } from '@tanstack/react-start'
import { daemonClient } from './daemon-client'

export interface VerificationUnavailable {
  code: string | undefined
  message: string
}

export interface TeamVerificationsView {
  requests: VerificationReport[]
  /** Team members a request can be addressed to. */
  members: { id: string; name: string }[]
  unavailable: VerificationUnavailable | null
}

function failure(error: unknown, fallback: string): VerificationUnavailable | null {
  if (!(error instanceof ApiClientError)) throw error
  const body = error.body as { error?: string; code?: string }
  return { code: body.code, message: body.error ?? fallback }
}

export const fetchTeamVerifications = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<TeamVerificationsView | null> => {
    const client = daemonClient()
    try {
      const [listed, agents] = await Promise.all([
        client.get<VerificationListResponse>(
          `/api/teams/${encodeURIComponent(data.id)}/verifications`,
        ),
        client.get<Array<{ id: string; name: string; teamId: string }>>('/api/agents'),
      ])
      return {
        requests: listed.requests,
        // The specialist must be a member of this Team; a cross-Team choice is refused by the daemon.
        members: agents
          .filter((agent) => agent.teamId === data.id)
          .map((agent) => ({ id: agent.id, name: agent.name })),
        unavailable: null,
      }
    } catch (error) {
      return { requests: [], members: [], unavailable: failure(error, 'Verifications unavailable') }
    }
  })

export const createVerification = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      id: string
      recipientAgentId: string
      snapshotId: string
      checks: VerificationCheckInput[]
      summary?: string
    }) => input,
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true } | { ok: false; blocker: VerificationBlockedResponse['blocked'] } | VerificationUnavailable> => {
      try {
        await daemonClient().post<VerificationResponse>(
          `/api/teams/${encodeURIComponent(data.id)}/verifications`,
          {
            recipientAgentId: data.recipientAgentId,
            snapshotId: data.snapshotId,
            checks: data.checks,
            summary: data.summary ?? null,
          },
        )
        return { ok: true }
      } catch (error) {
        // A blocked capture is a result with a reason, so it is returned rather than thrown.
        if (error instanceof ApiClientError && error.status === 409) {
          const body = error.body as Partial<VerificationBlockedResponse>
          if (body.blocked) return { ok: false, blocker: body.blocked }
        }
        const unavailable = failure(error, 'Verification could not be requested')
        if (unavailable) return unavailable
        throw error
      }
    },
  )

export const cancelVerification = createServerFn({ method: 'POST' })
  .validator((input: { id: string; requestId: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    try {
      await daemonClient().post<VerificationResponse>(
        `/api/teams/${encodeURIComponent(data.id)}/verifications/${encodeURIComponent(data.requestId)}/cancel`,
        {},
      )
      return { ok: true }
    } catch (error) {
      if (error instanceof ApiClientError) {
        const body = error.body as { error?: string }
        return { ok: false, message: body?.error ?? `cancel failed (${error.status})` }
      }
      throw error
    }
  })
