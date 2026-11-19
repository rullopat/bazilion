// The workspace's right side: everything about the work in the conversation, one tab each. The
// Agent tab is about the open Agent; the other four are about its Team.

import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { PANEL_LABELS, PANEL_TABS, type PanelTab } from '../../lib/workspace'
import { useWorkspace } from '../workspace/context'
import { useTeamCounts } from '../workspace/counts'
import { AgentPanel } from './AgentPanel'
import { ChangesPanel } from './ChangesPanel'
import { ConnectionsPanel } from './ConnectionsPanel'
import { FilesPanel } from './FilesPanel'
import { TeamPanel } from './TeamPanel'

export function SidePanel({ tab }: { tab: PanelTab }) {
  const { agent, team, to } = useWorkspace()
  const counts = useTeamCounts(team?.id)
  const count: Partial<Record<PanelTab, number | null>> = {
    changes: counts.changes,
    files: counts.files,
  }
  return (
    <aside
      aria-label="About the work"
      className="flex h-full flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-baziu-sm"
    >
      <div
        role="tablist"
        aria-label="Side panel"
        className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/60 p-2"
      >
        {PANEL_TABS.map((id) => {
          const selected = id === tab
          const number = count[id]
          return (
            <Link
              key={id}
              to="/"
              search={to({ panel: id, section: undefined })}
              role="tab"
              aria-selected={selected}
              className={`inline-flex h-8 items-center gap-1.5 rounded-[10px] border px-2 text-[0.8rem] font-semibold ${
                selected
                  ? 'border-border bg-card text-foreground shadow-baziu-sm'
                  : 'border-transparent text-mocha hover:bg-card/70 hover:text-foreground'
              }`}
            >
              {PANEL_LABELS[id]}
              {typeof number === 'number' && number > 0 && (
                <span className="rounded-full bg-frost px-1.5 font-mono text-[0.7rem] font-medium text-chocolate">
                  {number}
                </span>
              )}
            </Link>
          )
        })}
        <Link
          to="/"
          search={to({ panel: 'none', section: undefined })}
          aria-label="Close the side panel"
          className="ml-auto flex size-8 items-center justify-center rounded-[10px] text-mocha hover:bg-card hover:text-foreground xl:hidden"
        >
          <X className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3.5">
        {tab === 'agent' ? (
          agent ? (
            <AgentPanel key={agent.agent.id} agent={agent} />
          ) : (
            <Nothing>Open an Agent's conversation to see its settings here.</Nothing>
          )
        ) : !team ? (
          <Nothing>Pick an Agent or a Team on the left.</Nothing>
        ) : tab === 'team' ? (
          <TeamPanel key={team.id} team={team} />
        ) : tab === 'connections' ? (
          <ConnectionsPanel key={team.id} team={team} />
        ) : tab === 'changes' ? (
          <ChangesPanel key={team.id} team={team} />
        ) : (
          <FilesPanel key={team.id} team={team} />
        )}
      </div>
    </aside>
  )
}

function Nothing({ children }: { children: string }) {
  return <p className="m-0 py-10 text-center text-sm text-muted-foreground">{children}</p>
}

/** A small heading inside a panel. */
export function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="m-0 mb-1.5 mt-5 font-body text-[0.72rem] font-bold uppercase tracking-[0.08em] text-muted-foreground first:mt-0">
      {children}
    </h2>
  )
}

/** A bordered group of rows. */
export function PanelGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-frost/70 overflow-hidden rounded-2xl border border-border">
      {children}
    </div>
  )
}
