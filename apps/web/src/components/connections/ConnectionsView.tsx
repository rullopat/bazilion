// The Connections view: the Team's map, the rule it lives by (open or restricted), and beside
// it what the selection is about: an Agent, a pair of Agents, or the Team's recent messages.

import type { Message, Team, TeamPolicy, TeamPolicyMode } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import { ArrowRight, MessageSquare, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useActivity } from '../../lib/activity'
import { api, errorMessage } from '../../lib/api'
import {
  endpointLabel,
  hasEdge,
  liveDocument,
  liveEdges,
  OUTSIDE,
  type PolicyDocument,
  type PolicyPosition,
  sameDocument,
  setEdge,
} from '../../lib/team-policy'
import { useResource } from '../../lib/use-resource'
import { AgentAvatar } from '../AgentAvatar'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { Segmented } from '../Segmented'
import { TeamPolicyMatrix } from '../team-policy/TeamPolicyMatrix'
import { UnsavedChangesGuard } from '../UnsavedChangesGuard'
import { useWorkspace } from '../workspace/context'
import { FocusFrame } from '../workspace/FocusFrame'
import { STATE_DOT } from '../workspace/state-style'
import { ConnectionsMap, type MapMember, pairId, pairOf } from './ConnectionsMap'
import { TeamThread, useTeamMessages } from './TeamThread'

const MODE_HELP: Record<TeamPolicyMode, string> = {
  open: 'Every member can message every other member, with no connections needed. Connections here only matter for other Teams, or if you make the Team restricted.',
  restricted: 'A member can message a teammate only along a connection.',
}

/** Members on an ellipse, the first at the top: every pair gets a line of its own. */
function ringPosition(index: number, count: number): PolicyPosition {
  if (count === 1) return { x: 220, y: 140 }
  const radius = Math.max(135, count * 38)
  const angle = (index / count) * 2 * Math.PI - Math.PI / 2
  return {
    x: Math.round(40 + radius * 1.3 * (1 + Math.cos(angle))),
    y: Math.round(40 + radius * (1 + Math.sin(angle))),
  }
}

const actorOf = (members: ReadonlySet<string>, agentId: string) =>
  members.has(agentId) ? agentId : OUTSIDE

const layoutKey = (teamId: string) => `bz_map_${teamId}`

function readLayout(teamId: string): Record<string, PolicyPosition> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(layoutKey(teamId)) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, PolicyPosition>) : {}
  } catch {
    return {}
  }
}

export function ConnectionsView({ team }: { team: Team }) {
  const policy = useResource(
    (signal) => api<TeamPolicy>(`/api/teams/${encodeURIComponent(team.id)}/policy`, { signal }),
    [team.id],
  )
  if (policy.error) {
    return (
      <FocusFrame view="connections">
        <p role="alert" className="err m-4">
          {policy.error}
        </p>
      </FocusFrame>
    )
  }
  if (!policy.data) {
    return (
      <FocusFrame view="connections">
        <p role="status" className="m-4 text-sm text-muted-foreground">
          Loading the connections…
        </p>
      </FocusFrame>
    )
  }
  return <Editor key={team.id} team={team} policy={policy.data} />
}

function Editor({ team, policy }: { team: Team; policy: TeamPolicy }) {
  const { agentById, search } = useWorkspace()
  const activity = useActivity()
  const router = useRouter()
  const messages = useTeamMessages(team.id, 300)
  const [server, setServer] = useState(() => liveDocument(policy))
  const [draft, setDraft] = useState(server)
  const [view, setView] = useState<'map' | 'matrix'>('map')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layout, setLayout] = useState<Record<string, PolicyPosition>>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = !sameDocument(server, draft)

  // Where the operator dragged the nodes is remembered in this browser.
  useEffect(() => setLayout(readLayout(team.id)), [team.id])
  const move = (id: string, position: PolicyPosition) => {
    setLayout((current) => {
      const next = { ...current, [id]: position }
      try {
        window.localStorage.setItem(layoutKey(team.id), JSON.stringify(next))
      } catch {
        // Storage is unavailable: the layout lasts for this page.
      }
      return next
    })
  }

  // Archived members keep their connections but are not on the map.
  const active = useMemo(
    () => draft.members.filter((member) => member.status !== 'archived'),
    [draft.members],
  )
  const memberIds = useMemo(() => new Set(active.map((member) => member.key)), [active])
  const members: MapMember[] = active.map((member, index) => ({
    id: member.key,
    name: member.name,
    identity: agentById(member.key)?.identity,
    state: activity.stateOf(member.key),
    isolated:
      draft.mode === 'restricted' &&
      !draft.edges.some((edge) => edge.from === member.key || edge.to === member.key),
    position: layout[member.key] ?? ringPosition(index, active.length),
  }))

  /** The actor of this Team a message's end stands for: a member, or everyone else. */
  const actor = (agentId: string) => actorOf(memberIds, agentId)
  const thread = messages.data
  const traffic = useMemo(() => {
    const counts = new Map<string, number>()
    for (const message of thread ?? []) {
      const from = actorOf(memberIds, message.fromAgentId)
      const to = actorOf(memberIds, message.toAgentId)
      if (from === to) continue
      const id = pairId(from, to)
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [thread, memberIds])

  const toggle = (from: string, to: string, allowed: boolean) => {
    setNotice(null)
    setDraft((current) => setEdge(current, from, to, allowed))
  }

  async function save() {
    setSaving(true)
    setNotice(null)
    try {
      const saved = liveDocument(
        await api<TeamPolicy>(`/api/teams/${encodeURIComponent(team.id)}/policy`, {
          method: 'PATCH',
          body: { mode: draft.mode, edges: liveEdges(draft) },
        }),
      )
      setServer(saved)
      setDraft(saved)
      setNotice({ error: false, text: 'Saved. It applies to the next message an Agent sends.' })
      // The Team's mode shows in the rail and the panel.
      await router.invalidate()
    } catch (cause) {
      setNotice({ error: true, text: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  const pair = pairOf(selectedId)
  const selectedActor =
    selectedId && (memberIds.has(selectedId) || selectedId === OUTSIDE) ? selectedId : null
  const involves = (message: Message, id: string) =>
    actor(message.fromAgentId) === id || actor(message.toAgentId) === id
  const all = thread ?? []
  const shownThread = pair
    ? all.filter((message) => involves(message, pair[0]) && involves(message, pair[1]))
    : selectedActor
      ? all.filter((message) => involves(message, selectedActor))
      : all

  return (
    <FocusFrame
      view="connections"
      actions={
        <>
          <Segmented
            label="How members reach each other"
            value={draft.mode}
            options={[
              { id: 'open', label: 'Open' },
              { id: 'restricted', label: 'Restricted' },
            ]}
            onChange={(mode) => {
              setNotice(null)
              setDraft((current) => ({ ...current, mode }))
            }}
          />
          <Segmented
            label="Show as"
            value={view}
            options={[
              { id: 'map', label: 'Map' },
              { id: 'matrix', label: 'Table' },
            ]}
            onChange={setView}
          />
          <Button
            variant="ghost"
            className="min-h-8 px-3 py-1 text-xs"
            disabled={!dirty || saving}
            onClick={() => setConfirmDiscard(true)}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            className="min-h-8 px-3 py-1 text-xs"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            <Save className="size-3.5" aria-hidden="true" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <UnsavedChangesGuard when={dirty} subject="connection changes" />
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-h-0 min-w-0 flex-col max-lg:h-[52vh]">
          <p
            className={`m-0 border-b border-border px-3 py-1.5 text-xs ${
              notice?.error ? 'text-danger' : dirty ? 'text-warning' : 'text-mocha'
            }`}
            role={notice?.error ? 'alert' : 'status'}
          >
            {notice?.text ??
              (dirty ? 'Unsaved changes. ' : '') +
                MODE_HELP[draft.mode] +
                (view === 'map' ? ' Drag from one Agent to another to connect them.' : '')}
          </p>
          <div className="min-h-0 flex-1">
            {active.length === 0 ? (
              <p className="m-0 p-6 text-center text-sm text-muted-foreground">
                This Team has no members to connect yet.
              </p>
            ) : view === 'map' ? (
              <ConnectionsMap
                document={draft}
                members={members}
                traffic={traffic}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onConnect={(from, to) => {
                  toggle(from, to, true)
                  setSelectedId(pairId(from, to))
                }}
                onMove={move}
                onOpenMember={(id) =>
                  void router.navigate({ to: '/', search: { agent: id, panel: 'connections' } })
                }
              />
            ) : (
              <TeamPolicyMatrix
                document={{ ...draft, members: active }}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onToggle={toggle}
              />
            )}
          </div>
        </div>

        <aside
          aria-label="About the selection"
          className="min-h-0 overflow-y-auto border-border p-3.5 max-lg:border-t lg:border-l"
        >
          {pair ? (
            <PairInspector
              document={draft}
              pair={pair}
              onToggle={toggle}
              onClear={() => setSelectedId(null)}
            />
          ) : selectedActor ? (
            <ActorInspector
              document={draft}
              actor={selectedActor}
              others={[...active.map((member) => member.key), OUTSIDE].filter(
                (id) => id !== selectedActor,
              )}
              panel={search.panel}
              onToggle={toggle}
              onSelectPair={(other) => setSelectedId(pairId(selectedActor, other))}
            />
          ) : (
            <div>
              <h2 className="m-0 font-body text-sm font-semibold text-foreground">
                {active.length} member{active.length === 1 ? '' : 's'} ·{' '}
                {draft.mode === 'open' ? 'open Team' : 'restricted Team'}
              </h2>
              <p className="m-0 mt-1 text-xs leading-relaxed text-mocha">
                Select an Agent to choose who it can message, or a line to see what two Agents said
                to each other. You can always talk to every Agent, and every Agent can always reach
                you.
              </p>
            </div>
          )}

          <h2 className="m-0 mb-1.5 mt-5 font-body text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {pair
              ? 'Messages between them'
              : selectedActor
                ? `Messages of ${endpointLabel(draft, selectedActor)}`
                : 'Recent messages'}
          </h2>
          {messages.error ? (
            <p role="alert" className="m-0 text-xs text-danger">
              {messages.error}
            </p>
          ) : (
            <TeamThread
              messages={shownThread}
              limit={30}
              empty={
                pair || selectedActor
                  ? 'None among the Team’s recent messages.'
                  : 'No messages between Agents yet.'
              }
            />
          )}
        </aside>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard the connection changes?"
        description={
          <p>Every unsaved change is dropped. The saved connections stay as they are.</p>
        }
        confirmLabel="Discard changes"
        onConfirm={() => {
          setDraft(server)
          setSelectedId(null)
          setNotice(null)
        }}
        onOpenChange={setConfirmDiscard}
      />
    </FocusFrame>
  )
}

/** One direction between two actors, as a switch. */
function Direction({
  document,
  from,
  to,
  onToggle,
}: {
  document: PolicyDocument
  from: string
  to: string
  onToggle: (from: string, to: string, allowed: boolean) => void
}) {
  const allowed = hasEdge(document, from, to)
  // In an open Team teammates need no connection to message each other.
  const implied = document.mode === 'open' && from !== OUTSIDE && to !== OUTSIDE
  return (
    <button
      type="button"
      role="switch"
      aria-checked={allowed}
      onClick={() => onToggle(from, to, !allowed)}
      className={`unstyled flex min-h-10 w-full items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-left text-sm ${
        allowed ? 'border-primary/30 bg-accent/60' : 'border-border bg-card hover:bg-muted'
      }`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate font-semibold text-foreground">
          {endpointLabel(document, from)}
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-mocha" aria-hidden="true" />
        <span className="min-w-0 truncate font-semibold text-foreground">
          {endpointLabel(document, to)}
        </span>
      </span>
      <span
        className={`shrink-0 text-xs font-semibold ${allowed ? 'text-accent-foreground' : 'text-muted-foreground'}`}
      >
        {allowed ? 'Connected' : implied ? 'Open anyway' : 'Not connected'}
      </span>
    </button>
  )
}

function PairInspector({
  document,
  pair: [a, b],
  onToggle,
  onClear,
}: {
  document: PolicyDocument
  pair: [string, string]
  onToggle: (from: string, to: string, allowed: boolean) => void
  onClear: () => void
}) {
  const connected = hasEdge(document, a, b) || hasEdge(document, b, a)
  return (
    <div>
      <h2 className="m-0 font-body text-sm font-semibold text-foreground">
        {endpointLabel(document, a)} and {endpointLabel(document, b)}
      </h2>
      <p className="m-0 mt-1 text-xs leading-relaxed text-mocha">
        Each direction is its own connection.
        {a === OUTSIDE || b === OUTSIDE
          ? ' Reaching another Team also needs that Team to connect its Agent to “Other teams”.'
          : ''}
      </p>
      <div className="mt-3 space-y-1.5">
        <Direction document={document} from={a} to={b} onToggle={onToggle} />
        <Direction document={document} from={b} to={a} onToggle={onToggle} />
      </div>
      {connected && (
        <div className="mt-2.5">
          <Button
            variant="danger"
            className="min-h-8 px-3 py-1 text-xs"
            onClick={() => {
              onToggle(a, b, false)
              onToggle(b, a, false)
              onClear()
            }}
          >
            Disconnect both ways
          </Button>
        </div>
      )}
    </div>
  )
}

function ActorInspector({
  document,
  actor,
  others,
  panel,
  onToggle,
  onSelectPair,
}: {
  document: PolicyDocument
  actor: string
  others: string[]
  panel: ReturnType<typeof useWorkspace>['search']['panel']
  onToggle: (from: string, to: string, allowed: boolean) => void
  onSelectPair: (other: string) => void
}) {
  const { agentById } = useWorkspace()
  const activity = useActivity()
  const agent = actor === OUTSIDE ? undefined : agentById(actor)
  const state = agent ? activity.stateOf(agent.id) : null
  return (
    <div>
      <div className="flex min-w-0 items-center gap-2.5">
        {actor !== OUTSIDE && <AgentAvatar identity={agent?.identity} size={34} />}
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate font-body text-sm font-semibold text-foreground">
            {endpointLabel(document, actor)}
          </h2>
          {state ? (
            <p className="m-0 flex min-w-0 items-center gap-1.5 text-xs text-mocha">
              <span
                className={`size-[7px] shrink-0 rounded-full ${STATE_DOT[state.kind]}`}
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">{state.text}</span>
            </p>
          ) : (
            <p className="m-0 text-xs text-mocha">Every Agent that is not in this Team.</p>
          )}
        </div>
        {agent && (
          <Link
            to="/"
            search={{ agent: agent.id, ...(panel ? { panel } : { panel: 'connections' }) }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-card px-2.5 text-xs font-semibold text-foreground hover:border-sapphire-light hover:text-sapphire"
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
            Open
          </Link>
        )}
      </div>
      <div className="mt-3 space-y-3">
        {others.map((other) => (
          <div key={other}>
            <button
              type="button"
              onClick={() => onSelectPair(other)}
              className="unstyled mb-1 text-xs font-semibold text-mocha hover:text-sapphire"
            >
              With {endpointLabel(document, other)}
            </button>
            <div className="space-y-1">
              <Direction document={document} from={actor} to={other} onToggle={onToggle} />
              <Direction document={document} from={other} to={actor} onToggle={onToggle} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
