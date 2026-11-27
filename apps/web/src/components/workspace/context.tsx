// What the workspace's parts share: who exists, what is open, and how to link to another part.

import type {
  Agent,
  Profile,
  ResolvedAgent,
  SpeechStatusResponse,
  Team,
  TeamTemplate,
} from '@bazilion/api-types'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { WorkspaceSearch } from '../../lib/workspace'

export interface WorkspaceValue {
  agents: Agent[]
  teams: Team[]
  profiles: Profile[]
  teamTemplates: TeamTemplate[]
  /** The Agent whose conversation is open. */
  agent: ResolvedAgent | null
  /** The Team in view: the open Agent's, or the one the address names. */
  team: Team | null
  /** The conversation on screen: the one being read, else the Agent's active one. */
  conversationId: string | null
  search: WorkspaceSearch
  /** Read aloud and dictation are offered (their models are chosen and ready). */
  speech: SpeechStatusResponse
  agentById: (id: string) => Agent | undefined
  /** The address with some of its parts changed; `undefined` drops a part. */
  to: (patch: Partial<WorkspaceSearch>) => WorkspaceSearch
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function WorkspaceProvider({
  value,
  children,
}: {
  value: Omit<WorkspaceValue, 'agentById' | 'to'>
  children: ReactNode
}) {
  const full = useMemo<WorkspaceValue>(() => {
    const byId = new Map(value.agents.map((agent) => [agent.id, agent]))
    return {
      ...value,
      agentById: (id) => byId.get(id),
      to: (patch) => ({ ...value.search, ...patch }),
    }
  }, [value])
  return <WorkspaceContext.Provider value={full}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace needs a WorkspaceProvider')
  return value
}

/** The workspace when there is one: a conversation can also render on its own. */
export function useWorkspaceOptional(): WorkspaceValue | null {
  return useContext(WorkspaceContext)
}
