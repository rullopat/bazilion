// An Agent's `screen` and `theme` (BAZ-097): the tab acts on them only while it shows that
// Agent's current conversation; a tab on something else, or reading an earlier conversation, is
// left alone.

import type { LiveWorkspaceEvent, WorkspaceAction } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useLive } from '../../lib/live'
import { setThemeMode } from '../../lib/theme'
import type { WorkspaceSearch } from '../../lib/workspace'

/** The address an action leads to from `search`; null for an action that is not a place. */
export function screenSearch(
  search: WorkspaceSearch,
  action: WorkspaceAction,
): WorkspaceSearch | null {
  const closed = {
    ...search,
    view: undefined,
    file: undefined,
    result: undefined,
    section: undefined,
  }
  switch (action.kind) {
    case 'panel':
      return { ...closed, panel: action.tab }
    case 'view':
      return { ...search, section: undefined, view: action.view }
    case 'sheet':
      return { ...search, view: undefined, section: action.sheet }
    case 'conversation':
      return closed
    case 'theme':
      return null
  }
}

export function useAgentScreen(
  shown: { agentId: string; conversationId: string } | null,
  search: WorkspaceSearch,
) {
  const feed = useLive()
  const router = useRouter()
  const latest = useRef({ shown, search })
  latest.current = { shown, search }
  useEffect(
    () =>
      feed.subscribe('workspace', (event: LiveWorkspaceEvent) => {
        const { shown: now, search: here } = latest.current
        if (!now || now.agentId !== event.agentId || now.conversationId !== event.conversationId)
          return
        if (event.action.kind === 'theme') {
          setThemeMode(event.action.theme)
          return
        }
        const next = screenSearch(here, event.action)
        if (next) void router.navigate({ to: '/', search: next })
      }),
    [feed.subscribe, router],
  )
}
