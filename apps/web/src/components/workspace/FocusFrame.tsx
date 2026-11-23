// The frame of a full-width view of the Team: the way back to the conversation, the three views
// to hop between, and room for the view's own actions.

import { Link } from '@tanstack/react-router'
import { ArrowLeft, Code2, Images, Network } from 'lucide-react'
import type { ReactNode } from 'react'
import { FOCUS_VIEWS, type FocusView } from '../../lib/workspace'
import { useWorkspace } from './context'
import { useTeamCounts } from './counts'

const VIEW = {
  connections: { label: 'Connections', icon: Network },
  changes: { label: 'Changes', icon: Code2 },
  files: { label: 'Files', icon: Images },
} as const

export function FocusFrame({
  view,
  actions,
  children,
}: {
  view: FocusView
  actions?: ReactNode
  children: ReactNode
}) {
  const { team, agent, to } = useWorkspace()
  const counts = useTeamCounts(team?.id)
  return (
    <section
      aria-label={`${VIEW[view].label} of ${team?.name ?? 'the Team'}`}
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-baziu-sm"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted/60 px-3 py-2">
        <Link
          to="/"
          search={to({ view: undefined, result: undefined, panel: view })}
          className="inline-flex h-8 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-[10px] border border-border bg-card px-2.5 text-sm font-semibold text-foreground hover:border-sapphire-light hover:text-sapphire"
        >
          <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{agent ? agent.agent.name : 'Back'}</span>
        </Link>
        <h1 className="m-0 min-w-0 truncate font-display text-xl leading-tight text-charcoal">
          {team?.name}
        </h1>
        <nav
          aria-label="Team views"
          className="flex rounded-[12px] border border-border bg-card p-0.5"
        >
          {FOCUS_VIEWS.filter(
            // Changes only for a Team whose folder is a Git repository.
            (id) => id !== 'changes' || id === view || counts.repository !== false,
          ).map((id) => {
            const Icon = VIEW[id].icon
            const current = id === view
            return (
              <Link
                key={id}
                to="/"
                search={to({ view: id })}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex h-7 items-center gap-1.5 rounded-[9px] px-2.5 text-sm font-semibold ${
                  current
                    ? 'bg-accent text-accent-foreground'
                    : 'text-mocha hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                <span className={current ? '' : 'hidden sm:inline'}>{VIEW[id].label}</span>
              </Link>
            )
          })}
        </nav>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}
