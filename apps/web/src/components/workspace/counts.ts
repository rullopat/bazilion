import type { ResultListResponse, TeamReviewResponse } from '@bazilion/api-types'
import { useActivity } from '../../lib/activity'
import { api } from '../../lib/api'
import { useResource } from '../../lib/use-resource'

/**
 * How many changed files and saved files the Team has (null while unknown or not applicable), and
 * whether its folder is a Git repository (null until known): Changes is offered only when it is.
 */
export function useTeamCounts(teamId: string | undefined): {
  changes: number | null
  files: number | null
  repository: boolean | null
} {
  const { turnsEnded } = useActivity()
  const counts = useResource(
    async (signal) => {
      if (!teamId) return { changes: null, files: null, repository: null }
      const team = encodeURIComponent(teamId)
      const [review, files] = await Promise.all([
        api<TeamReviewResponse>(`/api/teams/${team}/review`, { signal }).catch(() => null),
        api<ResultListResponse>(`/api/results?teamId=${team}&limit=1`, { signal })
          .then((list) => list.total)
          .catch(() => null),
      ])
      if (!review) return { changes: null, files, repository: null }
      if ('unavailable' in review) {
        // A repository that cannot be read is still one: its Changes view says why.
        return { changes: null, files, repository: review.unavailable.code !== 'not_repository' }
      }
      return { changes: review.changes.changes.length, files, repository: true }
    },
    [teamId],
    { refreshOn: turnsEnded },
  )
  return counts.data ?? { changes: null, files: null, repository: null }
}
