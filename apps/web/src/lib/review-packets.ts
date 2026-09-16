// Server functions for the review-packet panel (BAZ-043). They run on the server and forward the
// caller's bounded session cookies to the loopback daemon, like `lib/git-review.ts`.

import { ApiClientError } from '@bazilion/client'
import type {
  AddReviewFindingRequest,
  CreateReviewPacketRequest,
  RecordReviewConclusionRequest,
  ResolveReviewFindingRequest,
  ReviewConclusion,
  ReviewPacketListResponse,
  ReviewPacketReport,
} from '@bazilion/api-types'
import { createServerFn } from '@tanstack/react-start'
import { daemonClient } from './daemon-client'

export interface ReviewUnavailable {
  code: string | undefined
  message: string
}

export interface TeamReviewPacketsView {
  /** Summaries only: applicability is established per packet, because it walks the repository. */
  packets: ReviewPacketListResponse['packets']
  /** Team members a packet can be delegated to. */
  members: { id: string; name: string }[]
  /** Retained revisions that can be reviewed. */
  snapshots: { id: string; complete: boolean; createdAt: number }[]
  unavailable: ReviewUnavailable | null
}

function failure(error: unknown, fallback: string): ReviewUnavailable | null {
  if (!(error instanceof ApiClientError)) throw error
  const body = error.body as { error?: string; code?: string }
  return { code: body.code, message: body.error ?? fallback }
}

export const fetchTeamReviewPackets = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<TeamReviewPacketsView | null> => {
    const client = daemonClient()
    try {
      const [listed, agents, snapshots] = await Promise.all([
        client.get<ReviewPacketListResponse>(`/api/teams/${encodeURIComponent(data.id)}/reviews`),
        client.get<Array<{ id: string; name: string; teamId: string }>>('/api/agents'),
        client.get<{ snapshots: Array<{ snapshotId: string; complete: boolean; createdAt: number }> }>(
          `/api/teams/${encodeURIComponent(data.id)}/review/snapshots`,
        ),
      ])
      return {
        packets: listed.packets,
        // A reviewer must be a member of this Team; a cross-Team choice is refused by the daemon.
        members: agents
          .filter((agent) => agent.teamId === data.id)
          .map((agent) => ({ id: agent.id, name: agent.name })),
        snapshots: snapshots.snapshots.map((snapshot) => ({
          id: snapshot.snapshotId,
          complete: snapshot.complete,
          createdAt: snapshot.createdAt,
        })),
        unavailable: null,
      }
    } catch (error) {
      return {
        packets: [],
        members: [],
        snapshots: [],
        unavailable: failure(error, 'Review packets unavailable'),
      }
    }
  })

/** One packet's detail, including current applicability and the reviewed revision's findings. */
export const fetchReviewPacket = createServerFn({ method: 'POST' })
  .validator((input: { id: string; packetId: string }) => input)
  .handler(async ({ data }): Promise<{ report: ReviewPacketReport } | ReviewUnavailable> => {
    try {
      const response = await daemonClient().get<{ report: ReviewPacketReport }>(
        `/api/teams/${encodeURIComponent(data.id)}/reviews/${encodeURIComponent(data.packetId)}`,
      )
      return { report: response.report }
    } catch (error) {
      const unavailable = failure(error, 'Review packet could not be loaded')
      if (unavailable) return unavailable
      throw error
    }
  })

export const createReviewPacket = createServerFn({ method: 'POST' })
  .validator((input: { id: string } & CreateReviewPacketRequest) => input)
  .handler(
    async ({
      data,
    }): Promise<{ report: ReviewPacketReport } | ReviewUnavailable> => {
      try {
        const { id, ...body } = data
        const response = await daemonClient().post<{ report: ReviewPacketReport }>(
          `/api/teams/${encodeURIComponent(id)}/reviews`,
          body,
        )
        return { report: response.report }
      } catch (error) {
        const unavailable = failure(error, 'The packet could not be created')
        if (unavailable) return unavailable
        throw error
      }
    },
  )

export const addReviewFinding = createServerFn({ method: 'POST' })
  .validator((input: { id: string; packetId: string } & AddReviewFindingRequest) => input)
  .handler(async ({ data }): Promise<{ report: ReviewPacketReport } | ReviewUnavailable> => {
    try {
      const { id, packetId, ...body } = data
      const response = await daemonClient().post<{ report: ReviewPacketReport }>(
        `/api/teams/${encodeURIComponent(id)}/reviews/${encodeURIComponent(packetId)}/findings`,
        body,
      )
      return { report: response.report }
    } catch (error) {
      const unavailable = failure(error, 'The finding could not be recorded')
      if (unavailable) return unavailable
      throw error
    }
  })

export const resolveReviewFinding = createServerFn({ method: 'POST' })
  .validator(
    (input: { id: string; packetId: string; findingId: string } & ResolveReviewFindingRequest) =>
      input,
  )
  .handler(async ({ data }): Promise<{ report: ReviewPacketReport } | ReviewUnavailable> => {
    try {
      const { id, packetId, findingId, ...body } = data
      const response = await daemonClient().post<{ report: ReviewPacketReport }>(
        `/api/teams/${encodeURIComponent(id)}/reviews/${encodeURIComponent(packetId)}/findings/${encodeURIComponent(findingId)}/resolve`,
        body,
      )
      return { report: response.report }
    } catch (error) {
      const unavailable = failure(error, 'The finding could not be resolved')
      if (unavailable) return unavailable
      throw error
    }
  })

export const recordReviewConclusion = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      id: string
      packetId: string
      conclusion: ReviewConclusion
      note?: string | null
    }): { id: string; packetId: string } & RecordReviewConclusionRequest => input,
  )
  .handler(async ({ data }): Promise<{ report: ReviewPacketReport } | ReviewUnavailable> => {
    try {
      const { id, packetId, ...body } = data
      const response = await daemonClient().post<{ report: ReviewPacketReport }>(
        `/api/teams/${encodeURIComponent(id)}/reviews/${encodeURIComponent(packetId)}/conclusion`,
        body,
      )
      return { report: response.report }
    } catch (error) {
      const unavailable = failure(error, 'The conclusion could not be recorded')
      if (unavailable) return unavailable
      throw error
    }
  })

export const fetchReviewExport = createServerFn({ method: 'POST' })
  .validator((input: { id: string; packetId: string }) => input)
  .handler(async ({ data }): Promise<{ patch: string; handoff: string } | ReviewUnavailable> => {
    try {
      const response = await daemonClient().get<{
        export: { patch: string; handoff: string }
      }>(
        `/api/teams/${encodeURIComponent(data.id)}/reviews/${encodeURIComponent(data.packetId)}/export`,
      )
      return { patch: response.export.patch, handoff: response.export.handoff }
    } catch (error) {
      const unavailable = failure(error, 'The handoff could not be produced')
      if (unavailable) return unavailable
      throw error
    }
  })
