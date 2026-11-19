import type { RepositoryReviewResponse, ResultListResponse } from '@bazilion/api-types'
import { useActivity } from '../../lib/activity'
import { api } from '../../lib/api'
import { useResource } from '../../lib/use-resource'

/** How many changed files and saved files the Team has; null while unknown or not applicable. */
export function useTeamCounts(teamId: string | undefined): {
  changes: number | null
  files: number | null
} {
  const { turnsEnded } = useActivity()
  const counts = useResource(
    async (signal) => {
      if (!teamId) return { changes: null, files: null }
      const team = encodeURIComponent(teamId)
      const [changes, files] = await Promise.all([
        api<RepositoryReviewResponse>(`/api/teams/${team}/review`, { signal })
          .then((review) => review.changes.changes.length)
          // Not a repository, or one that cannot be read: the tab says why.
          .catch(() => null),
        api<ResultListResponse>(`/api/results?teamId=${team}&limit=1`, { signal })
          .then((list) => list.total)
          .catch(() => null),
      ])
      return { changes, files }
    },
    [teamId, turnsEnded],
  )
  return counts.data ?? { changes: null, files: null }
}
