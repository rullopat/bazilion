// Shared sub-nav for the agent detail tree. Renders the active-tab
// underline + an `archived` pill when the agent is in that state.
//
// Memory deliberately isn't a tab here — it's per-team, not per-agent, and
// lives at /teams/:slug/memory. The agent's chat header surfaces a link to
// the team's shared memory for one-click access.

import { SECTION_TABS_CLASS, sectionTabClass } from './SectionTabs'
import { StatusBadge } from './Page'

type Tab = 'chat' | 'inbox' | 'triggers' | 'learning'

interface Props {
  agentId: string
  active: Tab
  archived: boolean
}

const TABS: { key: Tab; href: (id: string) => string; label: string }[] = [
  { key: 'chat', href: (id) => `/agents/${id}`, label: 'Chat' },
  { key: 'inbox', href: (id) => `/agents/${id}/inbox`, label: 'Inbox' },
  { key: 'triggers', href: (id) => `/agents/${id}/triggers`, label: 'Triggers' },
  { key: 'learning', href: (id) => `/agents/${id}/learning`, label: 'Learning' },
]

export function AgentTabs({ agentId, active, archived }: Props) {
  return (
    <nav className={SECTION_TABS_CLASS}>
      {TABS.map((t) => (
        <a
          key={t.key}
          href={t.href(agentId)}
          className={sectionTabClass(t.key === active)}
        >
          {t.label}
        </a>
      ))}
      {archived && (
        <StatusBadge variant="warning" className="ml-auto self-center uppercase tracking-wide">
          archived
        </StatusBadge>
      )}
    </nav>
  )
}
