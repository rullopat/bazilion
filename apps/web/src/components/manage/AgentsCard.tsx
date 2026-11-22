// The Agents page's list: every Agent, grouped by Team, found by name, with what can be done to
// each.

import type { Agent, ChatModelEntry, ProfileSummary, Team } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import { Bot } from 'lucide-react'
import { useState } from 'react'
import { archiveAgent, deleteAgent, unarchiveAgent } from '../../lib/agent-actions'
import { errorMessage } from '../../lib/api'
import {
  type AgentFilter,
  agentCounts,
  agentModel,
  count,
  groupAgents,
  templateName,
} from '../../lib/manage'
import { AgentAvatar } from '../AgentAvatar'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { Segmented } from '../Segmented'
import {
  CardBody,
  CardEmpty,
  CardList,
  CardToolbar,
  Chip,
  GroupHeader,
  ListRow,
  Notice,
  RowMenu,
  SearchField,
  SetupCard,
} from '../ui/parts'
import { MoveAgentDialog } from './MoveAgentDialog'

export function AgentsCard({
  agents,
  teams,
  templates,
  chat,
  onSpawn,
  onChanged,
}: {
  /** Every Agent, archived ones included. */
  agents: Agent[]
  teams: Team[]
  templates: ProfileSummary[]
  chat: ChatModelEntry[]
  /** Open the spawn dialog. */
  onSpawn: () => void
  /** Called after a change; resolves once the page has the new list. */
  onChanged: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AgentFilter>('current')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [archived, setArchived] = useState<Agent | null>(null)
  const [moving, setMoving] = useState<Agent | null>(null)
  const [deleting, setDeleting] = useState<Agent | null>(null)
  const counts = agentCounts(agents)
  const groups = groupAgents(agents, teams, filter, query)

  async function run(agent: Agent, work: () => Promise<void>) {
    setBusy(agent.id)
    setError(null)
    try {
      await work()
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }
  const archive = (agent: Agent) =>
    run(agent, async () => {
      await archiveAgent(agent.id)
      setArchived(agent)
    })
  const restore = (agent: Agent) =>
    run(agent, async () => {
      await unarchiveAgent(agent.id)
      setArchived(null)
    })

  return (
    <SetupCard
      labelledBy="manage-agents"
      icon={<Bot className="size-5" />}
      title="Agents"
      description="Grouped by Team. An archived Agent keeps its files and conversations, takes no work, and can be restored."
    >
      <CardToolbar>
        <SearchField
          label="Find an Agent"
          placeholder="Find by name, creature or vibe"
          value={query}
          onChange={setQuery}
          className="min-w-0 flex-1 basis-60"
        />
        <Segmented
          label="Which Agents"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'current', label: `Current ${counts.current}` },
            { id: 'archived', label: `Archived ${counts.archived}` },
            { id: 'all', label: 'All' },
          ]}
        />
      </CardToolbar>

      {archived && (
        <CardBody className="py-3">
          <Notice
            tone="neutral"
            actions={
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void restore(archived)}
              >
                Restore {archived.name}
              </Button>
            }
          >
            {archived.name} is archived. It keeps its files and conversations and takes no work
            until it is restored.
          </Notice>
        </CardBody>
      )}
      {error && (
        <CardBody className="py-3">
          <Notice tone="warning" role="alert" title="That did not work.">
            {error}
          </Notice>
        </CardBody>
      )}

      {agents.length === 0 ? (
        <CardEmpty
          icon={<Bot className="size-5" />}
          title="No Agents yet"
          action={
            <Button variant="primary" onClick={onSpawn}>
              Spawn an agent
            </Button>
          }
        >
          An Agent is spawned from a template into a Team, and starts talking as soon as it is.
        </CardEmpty>
      ) : groups.length === 0 ? (
        <CardEmpty
          title={query.trim() ? `No Agent matches “${query.trim()}”` : emptyFilter(filter)}
        >
          {query.trim()
            ? 'Try another name, or look in all of them.'
            : 'Archived Agents appear here when there are any.'}
        </CardEmpty>
      ) : (
        groups.map(({ team, agents: members }) => (
          <section key={team.id} aria-label={team.name}>
            <GroupHeader
              title={team.name}
              meta={`${count(members.length, 'Agent')} · ${team.policyMode === 'restricted' ? 'Restricted' : 'Open'}`}
              action={
                <Link to="/" search={{ team: team.id, panel: 'team' }}>
                  Open Team
                </Link>
              }
            />
            <CardList>
              {members.map((agent) => {
                const template = templates.find((entry) => entry.id === agent.profileId)
                const model = agentModel(agent, templates, chat)
                const isArchived = agent.status === 'archived'
                const identity = [agent.identity?.creature, agent.identity?.vibe]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <ListRow
                    inline
                    key={agent.id}
                    leading={<AgentAvatar identity={agent.identity} size={32} />}
                    title={
                      isArchived ? (
                        agent.name
                      ) : (
                        <Link
                          to="/"
                          search={{ agent: agent.id }}
                          className="text-foreground hover:text-primary"
                        >
                          {agent.name}
                        </Link>
                      )
                    }
                    chip={isArchived && <Chip tone="neutral">Archived</Chip>}
                    meta={
                      <>
                        {identity && <span>{identity}</span>}
                        <span>
                          {template ? (
                            <a href={`/templates/agents/${encodeURIComponent(template.id)}`}>
                              {templateName(template)}
                            </a>
                          ) : (
                            agent.profileId
                          )}{' '}
                          template
                        </span>
                        {model && (
                          <span className={model.missing ? 'font-semibold text-warning' : ''}>
                            {model.name}
                            {model.missing ? ', not in Chat' : model.inherited ? '' : ', its own'}
                          </span>
                        )}
                      </>
                    }
                    actions={
                      <>
                        {isArchived && (
                          <Button
                            variant="ghost"
                            disabled={busy === agent.id}
                            onClick={() => void restore(agent)}
                          >
                            Restore
                          </Button>
                        )}
                        <RowMenu
                          label={`More for ${agent.name}`}
                          disabled={busy === agent.id}
                          items={[
                            teams.length > 1 && {
                              label: 'Move to another Team…',
                              onSelect: () => setMoving(agent),
                            },
                            !isArchived && {
                              label: 'Archive',
                              onSelect: () => void archive(agent),
                            },
                            {
                              label: 'Delete permanently…',
                              danger: true,
                              onSelect: () => setDeleting(agent),
                            },
                          ]}
                        />
                      </>
                    }
                  />
                )
              })}
            </CardList>
          </section>
        ))
      )}

      {moving && (
        <MoveAgentDialog
          agent={moving}
          teams={teams}
          onClose={() => setMoving(null)}
          onMoved={async () => {
            setMoving(null)
            await onChanged()
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete ${deleting?.name ?? 'this Agent'} permanently?`}
        description={
          <p className="m-0">
            This removes the Agent, its conversations, messages, schedules, skill attachments and
            its folder. It cannot be undone. To keep them, archive it instead.
          </p>
        }
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          if (!deleting) return
          await deleteAgent(deleting.id)
          if (archived?.id === deleting.id) setArchived(null)
          await onChanged()
        }}
      />
    </SetupCard>
  )
}

function emptyFilter(filter: AgentFilter): string {
  return filter === 'archived' ? 'No archived Agents' : 'No current Agents'
}
