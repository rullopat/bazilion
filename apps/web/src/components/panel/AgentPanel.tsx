// The Agent tab: who the open Agent is, what it runs on, and the ways into its deeper pages
// (schedules, learning, mailbox, skills, Telegram, browser), which open as sheets.

import type {
  ListAgentLessonProposalsResponse,
  ListInboxResponse,
  ListTriggersResponse,
  ResolvedAgent,
} from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import {
  BookOpenCheck,
  CalendarClock,
  ChevronRight,
  Globe,
  Inbox,
  type LucideIcon,
  Send,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { shortTime, useActivity } from '../../lib/activity'
import { archiveAgent, deleteAgent, unarchiveAgent } from '../../lib/agent-actions'
import { api, errorMessage } from '../../lib/api'
import { useHydrated, useResource } from '../../lib/use-resource'
import type { AgentSection } from '../../lib/workspace'
import { AgentAvatar } from '../AgentAvatar'
import { AgentModel } from '../agent/AgentModel'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { CopyButton } from '../CopyButton'
import { StatusBadge } from '../Page'
import { useWorkspace } from '../workspace/context'
import { RenameAgentDialog, STATE_DOT } from '../workspace/Rail'
import { PanelGroup, PanelHeading } from './SidePanel'

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

export function AgentPanel({ agent: resolved }: { agent: ResolvedAgent }) {
  const { agent } = resolved
  const { teams, to, search } = useWorkspace()
  const activity = useActivity()
  const router = useRouter()
  const hydrated = useHydrated()
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const archived = agent.status === 'archived'
  const base = `/api/agents/${encodeURIComponent(agent.id)}`
  const state = activity.stateOf(agent.id)
  const lastActivityAt = activity.byAgent.get(agent.id)?.lastActivityAt ?? null

  // What the rows say at a glance; a sheet closing or a turn ending may have changed it.
  const glance = useResource(
    async (signal) => {
      const [triggers, proposals, unread] = await Promise.all([
        api<ListTriggersResponse>(`${base}/triggers`, { signal }),
        api<ListAgentLessonProposalsResponse>(`${base}/lesson-proposals`, { signal }),
        api<ListInboxResponse>(`${base}/messages?unread=1`, { signal }),
      ])
      return {
        schedules: triggers.triggers.filter((trigger) => trigger.enabled).length,
        schedulesOff: triggers.triggers.filter((trigger) => !trigger.enabled).length,
        proposals: proposals.proposals.filter((proposal) => proposal.status === 'pending').length,
        unread: unread.messages.length,
      }
    },
    [base, activity.turnsEnded, search.section],
  )
  const telegram = useResource(
    (signal) =>
      api<{ configured: boolean }>('/api/config/telegram', { signal }).catch(() => ({
        configured: false,
      })),
    [],
  )

  async function restore() {
    setError(null)
    try {
      await unarchiveAgent(agent.id)
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const info = glance.data
  const rows: Array<{ section: AgentSection; icon: LucideIcon; label: string; detail: string }> = [
    {
      section: 'schedules',
      icon: CalendarClock,
      label: 'Schedules',
      detail: info
        ? info.schedules + info.schedulesOff === 0
          ? 'None'
          : `${info.schedules} on${info.schedulesOff ? `, ${info.schedulesOff} off` : ''}`
        : '',
    },
    {
      section: 'learning',
      icon: BookOpenCheck,
      label: 'Learning',
      detail: info?.proposals
        ? `${plural(info.proposals, 'lesson')} to review`
        : resolved.privateLessons.length
          ? `${plural(resolved.privateLessons.length, 'lesson')} applied`
          : agent.reviewEnabled
            ? `Reviews every ${agent.reviewEveryNTurns} turns`
            : 'Periodic review off',
    },
    {
      section: 'mailbox',
      icon: Inbox,
      label: 'Mailbox',
      detail: info ? (info.unread ? `${info.unread} unread` : 'Nothing unread') : '',
    },
    {
      section: 'skills',
      icon: Sparkles,
      label: 'Skills',
      detail:
        resolved.profile.skillsMode === 'all' && resolved.skills.length === 0
          ? 'From the template'
          : `${resolved.skills.length} attached`,
    },
    ...(telegram.data?.configured
      ? [
          {
            section: 'telegram' as const,
            icon: Send,
            label: 'Telegram',
            detail:
              agent.telegramTopicId === null ? 'Not bound' : `Topic #${agent.telegramTopicId}`,
          },
        ]
      : []),
    { section: 'browser', icon: Globe, label: 'Browser', detail: 'Session and saved profile' },
  ]

  return (
    <div>
      <div className="flex min-w-0 items-center gap-3">
        <AgentAvatar identity={agent.identity} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-base font-semibold text-foreground">
              {agent.name}
            </span>
            {archived && <StatusBadge variant="warning">Archived</StatusBadge>}
          </div>
          {(agent.identity?.creature || agent.identity?.vibe) && (
            <p className="m-0 truncate text-xs text-muted-foreground">
              {[agent.identity?.creature, agent.identity?.vibe].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-mocha">
            <span
              className={`size-[7px] shrink-0 rounded-full ${STATE_DOT[state.kind]}`}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{state.text}</span>
            {hydrated && lastActivityAt !== null && state.kind !== 'working' && (
              <span className="shrink-0 text-muted-foreground">
                · last active {shortTime(lastActivityAt)}
              </span>
            )}
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="err mt-3">
          {error}
        </p>
      )}
      {archived && (
        <div className="mt-3 rounded-[10px] border border-warning/30 bg-warning/[0.07] px-3 py-2 text-sm text-chocolate">
          This Agent is archived: it is hidden from the list and receives no work.
          <div className="mt-2">
            <Button variant="ghost" onClick={() => void restore()}>
              Restore
            </Button>
          </div>
        </div>
      )}

      <PanelHeading>Model</PanelHeading>
      <AgentModel agent={resolved} />

      <PanelHeading>More about this Agent</PanelHeading>
      <PanelGroup>
        {rows.map(({ section, icon: Icon, label, detail }) => (
          <Link
            key={section}
            to="/"
            search={to({ panel: 'agent', section })}
            className="flex min-h-11 items-center gap-2.5 px-3 py-2 text-foreground hover:bg-accent/50"
          >
            <Icon className="size-4 shrink-0 text-mocha" aria-hidden="true" />
            <span className="shrink-0 text-sm font-semibold">{label}</span>
            <span
              className={`min-w-0 flex-1 truncate text-right text-xs ${
                (section === 'learning' && info?.proposals) ||
                (section === 'mailbox' && info?.unread)
                  ? 'font-semibold text-warning'
                  : 'text-muted-foreground'
              }`}
            >
              {detail}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </PanelGroup>

      <PanelHeading>Team</PanelHeading>
      <MoveTeam key={resolved.team.id} agentId={agent.id} teamId={resolved.team.id} teams={teams} />

      <PanelHeading>Details</PanelHeading>
      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Template</dt>
        <dd className="m-0 min-w-0 truncate">
          <a href={`/templates/agents/${encodeURIComponent(resolved.profile.id)}`}>
            {resolved.profile.name || resolved.profile.id}
          </a>
        </dd>
        <dt className="text-muted-foreground">ID</dt>
        <dd className="m-0 flex min-w-0 items-center gap-1">
          <span className="min-w-0 select-all truncate font-mono text-mocha">{agent.id}</span>
          <CopyButton value={agent.id} ariaLabel="Copy the Agent's ID" title="Copy the ID" />
        </dd>
        <dt className="text-muted-foreground">Files</dt>
        <dd className="m-0 min-w-0 truncate font-mono text-mocha" title={agent.dir}>
          {agent.dir}
        </dd>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setRenaming(true)}>
          Rename
        </Button>
        {!archived && (
          <Button variant="ghost" onClick={() => setConfirm('archive')}>
            Archive
          </Button>
        )}
        <Button variant="danger" onClick={() => setConfirm('delete')}>
          Delete
        </Button>
      </div>

      {renaming && (
        <RenameAgentDialog
          agent={agent}
          onClose={() => setRenaming(false)}
          onRenamed={() => router.invalidate()}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={
          confirm === 'delete' ? `Delete ${agent.name} permanently?` : `Archive ${agent.name}?`
        }
        description={
          confirm === 'delete' ? (
            <p>
              This removes its conversations, messages, schedules, skill attachments and private
              files. Files it saved for the Team stay. This cannot be undone.
            </p>
          ) : (
            <p>
              The Agent leaves the list and receives no work. Restore it later under Manage, Agents,
              with “Show archived”.
            </p>
          )
        }
        confirmLabel={confirm === 'delete' ? 'Delete permanently' : 'Archive agent'}
        confirmVariant={confirm === 'delete' ? 'danger' : 'primary'}
        onConfirm={async () => {
          if (confirm === 'delete') await deleteAgent(agent.id)
          else await archiveAgent(agent.id)
          await router.navigate({ to: '/', search: { team: resolved.team.id } })
          await router.invalidate()
        }}
      />
    </div>
  )
}

function MoveTeam({
  agentId,
  teamId: currentTeamId,
  teams,
}: {
  agentId: string
  teamId: string
  teams: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [teamId, setTeamId] = useState(currentTeamId)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function move(event: React.FormEvent) {
    event.preventDefault()
    setMoving(true)
    setError(null)
    try {
      await api(`/api/agents/${encodeURIComponent(agentId)}/team`, {
        method: 'PATCH',
        body: { teamId },
      })
      await router.invalidate({ sync: true })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setMoving(false)
    }
  }

  return (
    <form onSubmit={(event) => void move(event)}>
      <div className="flex items-center gap-2">
        <select
          aria-label="Team"
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
          className="min-w-0 flex-1"
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <Button variant="primary" type="submit" disabled={moving || teamId === currentTeamId}>
          {moving ? 'Moving…' : 'Move'}
        </Button>
      </div>
      {teamId !== currentTeamId && (
        <p className="m-0 mt-1.5 text-xs text-muted-foreground">
          Moving leaves this Agent's connections behind; it joins the other Team with none.
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  )
}
