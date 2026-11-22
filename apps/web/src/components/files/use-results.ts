import type { AgentResult, ResultListResponse } from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { useActivity } from '../../lib/activity'
import { api } from '../../lib/api'
import { useResource } from '../../lib/use-resource'

export interface ResultFilter {
  agentId?: string
  /** The conversation the files were delivered in. */
  sessionId?: string
}

export interface ResultPages {
  results: AgentResult[]
  total: number
  loading: boolean
  error: string | null
  hasMore: boolean
  /** Load the next page under the ones on screen. */
  more: () => void
  reload: () => Promise<void>
}

/** The daemon lists at most this many at once. */
const PAGE = 100

/**
 * A Team's saved files, newest first; loaded again whenever a turn ends. An empty `teamId` lists
 * every Team's.
 */
export function useResults(teamId: string, filter: ResultFilter, pageSize = 24): ResultPages {
  const { turnsEnded } = useActivity()
  const [wanted, setWanted] = useState(pageSize)
  const key = `${teamId}|${filter.agentId ?? ''}|${filter.sessionId ?? ''}`
  // A new filter starts from the first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the filter.
  useEffect(() => setWanted(pageSize), [key, pageSize])

  const pages = useResource(
    async (signal) => {
      const results: AgentResult[] = []
      let total = 0
      // Pages are fetched again from the top so a file saved meanwhile cannot shift the list.
      for (let offset = 0; offset < wanted; offset += PAGE) {
        const query = new URLSearchParams({
          limit: String(Math.min(PAGE, wanted - offset)),
          offset: String(offset),
        })
        if (teamId) query.set('teamId', teamId)
        if (filter.agentId) query.set('agentId', filter.agentId)
        if (filter.sessionId) query.set('sessionId', filter.sessionId)
        const page = await api<ResultListResponse>(`/api/results?${query}`, { signal })
        results.push(...page.results)
        total = page.total
        if (results.length >= total) break
      }
      return { results, total }
    },
    [key, wanted, turnsEnded],
  )

  const results = pages.data?.results ?? []
  const total = pages.data?.total ?? 0
  return {
    results,
    total,
    loading: pages.loading,
    error: pages.error,
    hasMore: results.length < total,
    more: () => setWanted((current) => current + pageSize),
    reload: pages.reload,
  }
}
