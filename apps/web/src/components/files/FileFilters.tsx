// The one way to narrow down saved files, in the Files tab and in the full Files view alike: what
// kind (all, pictures, videos, audio, documents) and whose (the whole Team, one member, the open
// conversation).

import type { AgentResult, Team } from '@bazilion/api-types'
import { useState } from 'react'
import { Segmented } from '../Segmented'
import { FilterSelect, type SelectOption } from '../ui/form'
import { useWorkspace } from '../workspace/context'
import type { ResultFilter } from './use-results'

export type FileKind = 'all' | 'pictures' | 'video' | 'audio' | 'documents'

const KINDS: ReadonlyArray<{ id: FileKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pictures', label: 'Pictures' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'documents', label: 'Documents' },
]

export const isPicture = (result: AgentResult) => result.mimeType.startsWith('image/')

/** The kind a saved file is listed under. */
export function kindOf(result: AgentResult): Exclude<FileKind, 'all'> {
  if (isPicture(result)) return 'pictures'
  if (result.mimeType.startsWith('video/')) return 'video'
  if (result.mimeType.startsWith('audio/')) return 'audio'
  return 'documents'
}

/** "pictures", "videos", "audio files": the kind in words. */
export const KIND_WORDS: Record<Exclude<FileKind, 'all'>, string> = {
  pictures: 'pictures',
  video: 'videos',
  audio: 'audio files',
  documents: 'documents',
}

export interface FileFilterState {
  kind: FileKind
  setKind: (kind: FileKind) => void
  /** 'team', 'conversation' or `agent:<id>`. */
  who: string
  setWho: (who: string) => void
  options: SelectOption<string>[]
  /** What the daemon is asked for; the kind is applied to what it returns. */
  filter: ResultFilter
  /** Narrowed to one Agent or one conversation. */
  narrowed: boolean
  matches: (result: AgentResult) => boolean
}

export function useFileFilters(team: Team): FileFilterState {
  const { agents, agent: open, conversationId } = useWorkspace()
  const [kind, setKind] = useState<FileKind>('all')
  const [chosen, setWho] = useState('team')
  const openHere = open && open.team.id === team.id ? open.agent : null
  const options: SelectOption<string>[] = [
    { value: 'team', label: `Everyone in ${team.name}` },
    ...agents
      .filter((agent) => agent.teamId === team.id)
      .map((agent) => ({ value: `agent:${agent.id}`, label: agent.name })),
    ...(openHere && conversationId
      ? [{ value: 'conversation', label: 'This conversation', hint: openHere.name }]
      : []),
  ]
  // A choice that no longer exists (another Agent opened) falls back to the whole Team.
  const who = options.some((option) => option.value === chosen) ? chosen : 'team'
  const filter: ResultFilter = who.startsWith('agent:')
    ? { agentId: who.slice('agent:'.length) }
    : who === 'conversation' && conversationId
      ? { sessionId: conversationId }
      : {}
  return {
    kind,
    setKind,
    who,
    setWho,
    options,
    filter,
    narrowed: who !== 'team',
    matches: (result) => kind === 'all' || kindOf(result) === kind,
  }
}

export function FileFilters({ state }: { state: FileFilterState }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Segmented label="Kind of file" value={state.kind} options={KINDS} onChange={state.setKind} />
      <FilterSelect
        label="Whose files"
        value={state.who}
        options={state.options}
        onChange={state.setWho}
      />
    </div>
  )
}
