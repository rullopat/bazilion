// Server functions for the Git review panel (BAZ-042). Like `lib/auth.ts`, these run on the server
// and forward the caller's bounded session cookies to the loopback daemon, so the client bundle
// never ships the daemon URL or cookie machinery.

import { ApiClientError } from '@bazilion/client'
import type {
  Agent,
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
  /** Team members feedback can be addressed to. */
  members: { id: string; name: string }[]
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
    let members: { id: string; name: string }[] = []
    try {
      const agents = await client.get<Agent[]>('/api/agents?includeArchived=true')
      members = agents
        .filter((agent) => agent.teamId === team.id)
        .map((agent) => ({ id: agent.id, name: agent.name }))
    } catch {
      members = []
    }
    return { team, review, unavailable, snapshots, members }
  })

export interface ComposedFeedback {
  reference: string
  message: string
  applicability: 'current' | 'stale' | 'unknown'
  applicabilityReason: string
}

/** Compose feedback for one path. Composition never sends: the operator sees the message first. */
export const prepareReviewFeedback = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      id: string
      path: string
      snapshotId?: string
      startLine?: number
      endLine?: number
      note?: string
    }) => input,
  )
  .handler(async ({ data }): Promise<ComposedFeedback | ReviewUnavailable> => {
    const { id, ...body } = data
    try {
      const response = await daemonClient().post<{
        feedback: { applicability: 'current' | 'stale' | 'unknown'; applicabilityReason: string }
        reference: string
        message: string
      }>(`/api/teams/${encodeURIComponent(id)}/review/feedback`, body)
      return {
        reference: response.reference,
        message: response.message,
        applicability: response.feedback.applicability,
        applicabilityReason: response.feedback.applicabilityReason,
      }
    } catch (error) {
      return (
        failure(error, 'Feedback could not be prepared.') ?? {
          code: undefined,
          message: 'Feedback could not be prepared.',
        }
      )
    }
  })

/**
 * Send composed feedback to an Agent through the shipped follow-up queue (BAZ-036).
 *
 * Deliberately the queue rather than a second path: it is durable, it is the same ingress busy turns
 * already use, it shows up in the existing queue UI, and the snapshot reference travels inside the
 * message text so the identity survives whatever holds it. No parallel record is created.
 */
export const sendReviewFeedback = createServerFn({ method: 'POST' })
  .validator((input: { agentId: string; message: string }) => input)
  .handler(async ({ data }): Promise<{ queued: true } | ReviewUnavailable> => {
    const client = daemonClient()
    try {
      const head = await client.get<{ selection: unknown }>(
        `/api/agents/${encodeURIComponent(data.agentId)}/sessions/head`,
      )
      await client.post(`/api/agents/${encodeURIComponent(data.agentId)}/queue`, {
        requestId: crypto.randomUUID(),
        message: data.message,
        expectedSelection: head.selection,
      })
      return { queued: true }
    } catch (error) {
      return (
        failure(error, 'The feedback could not be queued.') ?? {
          code: undefined,
          message: 'The feedback could not be queued.',
        }
      )
    }
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

export type ApplicabilityView =
  | { status: 'ok'; comparison: 'identical' | 'changed' | 'unknown'; reason: string }
  | { status: 'unavailable'; code: string | undefined; message: string }

/**
 * Whether a receipt's tested source still matches the current source (BAZ-042 criterion 4).
 *
 * Three-valued and conservative: `changed` means the source moved, not that the change was relevant
 * to what was tested, so it is never rendered as a pass or a failure.
 */
export const fetchSnapshotApplicability = createServerFn({ method: 'POST' })
  .validator((input: { teamId: string; snapshotId: string }) => input)
  .handler(async ({ data }): Promise<ApplicabilityView> => {
    try {
      const response = await daemonClient().get<{
        comparison: 'identical' | 'changed' | 'unknown'
        reason: string
      }>(
        `/api/teams/${encodeURIComponent(data.teamId)}/review/snapshots/${encodeURIComponent(data.snapshotId)}/applicability`,
      )
      return { status: 'ok', comparison: response.comparison, reason: response.reason }
    } catch (error) {
      const unavailable = failure(error, 'Applicability could not be established.')
      return {
        status: 'unavailable',
        code: unavailable?.code,
        message: unavailable?.message ?? 'Applicability could not be established.',
      }
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
