// Server functions for the Git review panel (BAZ-042). Like `lib/auth.ts`, these run on the server
// and forward the caller's bounded session cookies to the loopback daemon, so the client bundle
// never ships the daemon URL or cookie machinery.

import { ApiClientError } from '@bazilion/client'
import type {
  RepositoryReviewResponse,
  SourceSnapshot,
  SourceSnapshotListResponse,
  SourceSnapshotSummary,
  SnapshotReference,
  Team,
} from '@bazilion/api-types'
import { createServerFn } from '@tanstack/react-start'
import { daemonClient } from './daemon-client'

export interface ReviewUnavailable {
  code: string | undefined
  message: string
}

export interface TeamReviewView {
  team: Team
  review: RepositoryReviewResponse | null
  unavailable: ReviewUnavailable | null
  snapshots: SourceSnapshotSummary[]
}

function failure(error: unknown, fallback: string): ReviewUnavailable | null {
  if (!(error instanceof ApiClientError)) throw error
  const body = error.body as { error?: string; code?: string }
  return { code: body.code, message: body.error ?? fallback }
}

export const fetchTeamReview = createServerFn({ method: 'POST' })
  .validator((input: { id: string; base?: string }) => input)
  .handler(async ({ data }): Promise<TeamReviewView | null> => {
    const client = daemonClient()
    let team: Team
    try {
      team = await client.get<Team>(`/api/teams/${encodeURIComponent(data.id)}`)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null
      throw error
    }
    const reviewPath = `/api/teams/${encodeURIComponent(team.id)}/review${
      data.base ? `?base=${encodeURIComponent(data.base)}` : ''
    }`
    let review: RepositoryReviewResponse | null = null
    let unavailable: ReviewUnavailable | null = null
    try {
      review = await client.get<RepositoryReviewResponse>(reviewPath)
    } catch (error) {
      unavailable = failure(error, 'This Team cannot be reviewed right now.')
    }
    let snapshots: SourceSnapshotSummary[] = []
    try {
      const listed = await client.get<SourceSnapshotListResponse>(
        `/api/teams/${encodeURIComponent(team.id)}/review/snapshots`,
      )
      snapshots = listed.snapshots
    } catch {
      // Snapshots are secondary evidence; a failure here must not hide the change list.
      snapshots = []
    }
    return { team, review, unavailable, snapshots }
  })

export interface FileDiffView {
  path: string
  patch: string | null
  truncated: boolean
  omitted: string | null
}

export const fetchFileDiff = createServerFn({ method: 'POST' })
  .validator((input: { id: string; path: string; base?: string }) => input)
  .handler(async ({ data }): Promise<FileDiffView | null> => {
    const client = daemonClient()
    const params = new URLSearchParams({ patches: '1', path: data.path })
    if (data.base) params.set('base', data.base)
    try {
      const review = await client.get<RepositoryReviewResponse>(
        `/api/teams/${encodeURIComponent(data.id)}/review?${params}`,
      )
      const change = review.changes.changes.find((entry) => entry.path === data.path)
      if (!change) return null
      return {
        path: change.path,
        patch: change.patch,
        truncated: change.patchTruncated,
        omitted: change.contentOmitted,
      }
    } catch (error) {
      if (error instanceof ApiClientError) return null
      throw error
    }
  })

export const captureTeamSnapshot = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(
    async ({ data }): Promise<{ reference: SnapshotReference } | ReviewUnavailable> => {
      try {
        const captured = await daemonClient().post<{ reference: SnapshotReference }>(
          `/api/teams/${encodeURIComponent(data.id)}/review/snapshots`,
          {},
        )
        return { reference: captured.reference }
      } catch (error) {
        return failure(error, 'The snapshot could not be captured.') ?? { code: undefined, message: 'The snapshot could not be captured.' }
      }
    },
  )

export const fetchTeamSnapshot = createServerFn({ method: 'POST' })
  .validator((input: { id: string; snapshotId: string }) => input)
  .handler(async ({ data }): Promise<SourceSnapshot | null> => {
    try {
      const response = await daemonClient().get<{ snapshot: SourceSnapshot }>(
        `/api/teams/${encodeURIComponent(data.id)}/review/snapshots/${encodeURIComponent(data.snapshotId)}`,
      )
      return response.snapshot
    } catch (error) {
      if (error instanceof ApiClientError) return null
      throw error
    }
  })
