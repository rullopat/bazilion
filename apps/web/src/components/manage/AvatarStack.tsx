import type { Agent } from '@bazilion/api-types'
import { AgentAvatar } from '../AgentAvatar'

/** The first few members of a group, overlapping, with how many more there are. */
/** At most `max` circles, the last a "+N" when there are more: the stack keeps one width. */
export function AvatarStack({ agents, max = 4 }: { agents: Agent[]; max?: number }) {
  const shown = agents.slice(0, agents.length > max ? max - 1 : max)
  const more = agents.length - shown.length
  return (
    <span className="flex items-center" aria-hidden="true">
      {shown.map((agent, index) => (
        <span
          key={agent.id}
          className={`rounded-full ring-2 ring-card ${index > 0 ? '-ml-2' : ''}`}
        >
          <AgentAvatar identity={agent.identity} size={28} />
        </span>
      ))}
      {more > 0 && (
        <span className="-ml-2 flex size-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground ring-2 ring-card">
          +{more}
        </span>
      )}
    </span>
  )
}
