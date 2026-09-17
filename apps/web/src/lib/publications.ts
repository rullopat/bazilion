// Server functions for the publication panel (BAZ-046). They run on the server and forward the caller's
// bounded session cookies to the loopback daemon, like `lib/review-packets.ts`.

import type {
  CreatePublicationRequest,
  PublicationListResponse,
  PublicationReport,
} from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createServerFn } from '@tanstack/react-start'
import { daemonClient } from './daemon-client'

export interface PublicationUnavailable {
  code: string | undefined
  message: string
}

export interface TeamPublicationsView {
  publications: PublicationListResponse['publications']
  /** The host and repository as configured, so the decision is made with the target in view. */
  target: { host: string; repository: string; baseBranch: string } | null
  unavailable: PublicationUnavailable | null
}

function failure(error: unknown, fallback: string): PublicationUnavailable | null {
  if (!(error instanceof ApiClientError)) throw error
  const body = error.body as { error?: string; code?: string }
  return { code: body.code, message: body.error ?? fallback }
}

export const fetchTeamPublications = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<TeamPublicationsView> => {
    const client = daemonClient()
    try {
      const listed = await client.get<PublicationListResponse>(
        `/api/teams/${encodeURIComponent(data.id)}/publications`,
      )
      return { publications: listed.publications, target: null, unavailable: null }
    } catch (error) {
      return {
        publications: [],
        target: null,
        unavailable: failure(error, 'Publications unavailable'),
      }
    }
  })

export const publishReviewedRevision = createServerFn({ method: 'POST' })
  .validator((input: { id: string } & Omit<CreatePublicationRequest, 'teamId'>) => input)
  .handler(
    async ({
      data,
    }): Promise<
      | { report: PublicationReport; unavailable?: undefined; blocked?: undefined }
      | { blocked: { reason: string; detail: string }; report?: undefined; unavailable?: undefined }
      | { unavailable: PublicationUnavailable; report?: undefined; blocked?: undefined }
    > => {
      try {
        const response = await daemonClient().post<{ report: PublicationReport }>(
          `/api/teams/${encodeURIComponent(data.id)}/publications`,
          {
            packetId: data.packetId,
            ...(data.headBranch ? { headBranch: data.headBranch } : {}),
            ...(data.commitMessage ? { commitMessage: data.commitMessage } : {}),
          },
        )
        return { report: response.report }
      } catch (error) {
        if (error instanceof ApiClientError) {
          const body = error.body as { blocked?: { reason: string; detail: string } }
          // A refusal is an answer with a reason, and it means nothing was sent.
          if (body.blocked) return { blocked: body.blocked }
        }
        const unavailable = failure(error, 'Publication failed')
        if (unavailable) return { unavailable }
        throw error
      }
    },
  )
