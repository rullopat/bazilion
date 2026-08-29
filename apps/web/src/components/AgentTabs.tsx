// Shared sub-nav for the agent detail tree. Renders the active-tab
// underline + an `archived` pill when the agent is in that state.
//
// Memory deliberately isn't a tab here — it's per-team, not per-agent, and
// lives at /teams/:slug/memory. The agent's chat header surfaces a link to
// the team's shared memory for one-click access.

import { SECTION_TABS_CLASS, sectionTabClass } from './SectionTabs'
import { StatusBadge } from './Page'

type Tab = 'chat' | 'inbox' | 'triggers' | 'learning' | 'settings'

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
  { key: 'settings', href: (id) => `/agents/${id}?mode=settings`, label: 'Settings' },
]

export function AgentTabs({ agentId, active, archived }: Props) {
  return (
    <nav aria-label="Agent sections" className={SECTION_TABS_CLASS}>
      {TABS.map((t) => (
        <a
          key={t.key}
          href={t.href(agentId)}
          aria-current={t.key === active ? 'page' : undefined}
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
