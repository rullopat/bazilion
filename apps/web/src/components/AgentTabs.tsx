// Shared sub-nav for the agent detail tree. Renders the active-tab
// underline + an `archived` pill when the agent is in that state.
//
// Memory deliberately isn't a tab here — it's per-group, not per-agent, and
// lives at /groups/:slug/memory. The agent's chat header surfaces a link to
// the group's shared memory for one-click access.

type Tab = 'chat' | 'inbox' | 'triggers'

interface Props {
  agentId: string
  active: Tab
  archived: boolean
}

const TABS: { key: Tab; href: (id: string) => string; label: string }[] = [
  { key: 'chat', href: (id) => `/agents/${id}`, label: 'chat' },
  { key: 'inbox', href: (id) => `/agents/${id}/inbox`, label: 'inbox' },
  { key: 'triggers', href: (id) => `/agents/${id}/triggers`, label: 'triggers' },
]

export function AgentTabs({ agentId, active, archived }: Props) {
  return (
    <nav className="flex gap-1 border-b mb-6">
      {TABS.map((t) => (
        <a
          key={t.key}
          href={t.href(agentId)}
          className={`px-3 py-2 text-sm border-b-2 -mb-px ${
            t.key === active
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t.label}
        </a>
      ))}
      {archived && (
        <span className="ml-auto self-center text-xs uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
          archived
        </span>
      )}
    </nav>
  )
}
