import type { Profile, TeamPolicy, TeamPolicyMode, TeamTemplate } from '@bazilion/api-types'
import { ListTree, Plus, Save, TableProperties, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import {
  defaultPosition,
  edgeKey,
  endpointLabel,
  hasEdge,
  liveDocument,
  liveEdges,
  OUTSIDE,
  type PolicyDocument,
  type PolicyMember,
  sameDocument,
  setEdge,
  templateDocument,
  templateInput,
} from '../../lib/team-policy'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { UnsavedChangesGuard } from '../UnsavedChangesGuard'
import { TeamPolicyFlow } from './TeamPolicyFlow'
import { TeamPolicyMatrix } from './TeamPolicyMatrix'

type Source = { kind: 'live'; policy: TeamPolicy } | { kind: 'template'; template: TeamTemplate }

const MODE_HELP: Record<TeamPolicyMode, string> = {
  open: 'Members message each other freely; edges only matter for messages to and from other teams.',
  restricted: 'Members message each other only along allow edges.',
}

export function TeamPolicyEditor({ source, profiles }: { source: Source; profiles: Profile[] }) {
  const [server, setServer] = useState(() =>
    source.kind === 'live' ? liveDocument(source.policy) : templateDocument(source.template),
  )
  const [draft, setDraft] = useState(server)
  const [view, setView] = useState<'flow' | 'matrix'>('flow')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = !sameDocument(server, draft)
  const incomplete = useMemo(
    () =>
      new Set(
        draft.members
          .filter((member) => !profiles.some((profile) => profile.id === member.profileId))
          .map((member) => member.key),
      ),
    [draft.members, profiles],
  )

  const toggle = (from: string, to: string, allowed: boolean) =>
    setDraft((current) => setEdge(current, from, to, allowed))

  const save = async () => {
    setSaving(true)
    setNotice(null)
    try {
      const saved =
        source.kind === 'live'
          ? keepLayout(
              liveDocument(
                await api<TeamPolicy>(
                  `/api/teams/${encodeURIComponent(source.policy.teamId)}/policy`,
                  { method: 'PATCH', body: { mode: draft.mode, edges: liveEdges(draft) } },
                ),
              ),
              draft,
            )
          : templateDocument(
              await api<TeamTemplate>(
                `/api/team-templates/${encodeURIComponent(source.template.id)}`,
                { method: 'PUT', body: templateInput(draft, profiles) },
              ),
            )
      setServer(saved)
      setDraft(saved)
      setSelectedId(null)
      setNotice('Saved.')
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <UnsavedChangesGuard when={dirty} subject="Team policy draft" />
      <section
        className="overflow-hidden rounded-lg border border-frost bg-snow"
        aria-label="Team policy editor"
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-frost bg-cream p-3">
          <div className="mr-auto min-w-0">
            {draft.kind === 'template' ? (
              <label className="m-0 text-xs">
                Template name
                <input
                  value={draft.name}
                  onChange={(event) => {
                    const name = event.target.value
                    setDraft((current) => ({ ...current, name }))
                  }}
                />
              </label>
            ) : (
              <h2 className="m-0 truncate text-lg">{draft.name}</h2>
            )}
            <p className="muted m-0 text-xs">{MODE_HELP[draft.mode]}</p>
          </div>
          <fieldset
            className="m-0 flex min-w-0 rounded-md border border-frost bg-ivory p-0.5"
            aria-label="Policy mode"
          >
            {(['open', 'restricted'] as const).map((mode) => (
              <Toggle
                key={mode}
                active={draft.mode === mode}
                label={mode === 'open' ? 'Open' : 'Restricted'}
                onClick={() => setDraft((current) => ({ ...current, mode }))}
              />
            ))}
          </fieldset>
          <fieldset
            className="m-0 flex min-w-0 rounded-md border border-frost bg-ivory p-0.5"
            aria-label="Editor view"
          >
            <Toggle
              active={view === 'flow'}
              label="Flow"
              icon={<ListTree className="h-4 w-4" />}
              onClick={() => setView('flow')}
            />
            <Toggle
              active={view === 'matrix'}
              label="Matrix"
              icon={<TableProperties className="h-4 w-4" />}
              onClick={() => setView('matrix')}
            />
          </fieldset>
          <Button
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => setConfirmDiscard(true)}
          >
            Discard
          </Button>
          <Button variant="primary" disabled={!dirty || saving} onClick={save}>
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </header>
        {notice && (
          <div role="status" className="border-b border-frost bg-ivory px-4 py-2 text-sm">
            {notice}
          </div>
        )}
        <div className="grid min-h-[620px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-h-[480px] overflow-hidden">
            {view === 'flow' ? (
              <TeamPolicyFlow
                document={draft}
                selectedId={selectedId}
                incompleteKeys={incomplete}
                onSelect={setSelectedId}
                onConnect={(from, to) => toggle(from, to, true)}
                onRemoveEdge={(from, to) => toggle(from, to, false)}
                onMoveMember={(key, position) =>
                  setDraft((current) => ({
                    ...current,
                    members: current.members.map((member) =>
                      member.key === key ? { ...member, position } : member,
                    ),
                  }))
                }
                onOpenMember={(member) =>
                  draft.kind === 'live'
                    ? window.location.assign(`/agents/${encodeURIComponent(member.key)}`)
                    : setSelectedId(member.key)
                }
              />
            ) : (
              <TeamPolicyMatrix
                document={draft}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onToggle={toggle}
              />
            )}
          </div>
          <aside className="border-t border-frost p-4 lg:border-l lg:border-t-0">
            <Inspector
              document={draft}
              selectedId={selectedId}
              profiles={profiles}
              onDraft={setDraft}
              onSelect={setSelectedId}
              onToggle={toggle}
            />
          </aside>
        </div>
      </section>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this Team policy draft?"
        description={<p>This discards every unsaved change. The saved policy stays as it is.</p>}
        confirmLabel="discard draft"
        onConfirm={() => {
          setDraft(server)
          setSelectedId(null)
          setNotice(null)
        }}
        onOpenChange={setConfirmDiscard}
      />
    </>
  )
}

/** A live Team stores no layout: keep the nodes where the operator dragged them. */
function keepLayout(saved: PolicyDocument, draft: PolicyDocument): PolicyDocument {
  const positions = new Map(draft.members.map((member) => [member.key, member.position]))
  return {
    ...saved,
    members: saved.members.map((member) => ({
      ...member,
      position: positions.get(member.key) ?? member.position,
    })),
  }
}

function Toggle({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${active ? 'bg-snow text-sapphire shadow-sm' : 'text-mocha'}`}
    >
      {icon}
      {label}
    </button>
  )
}

function Inspector({
  document,
  selectedId,
  profiles,
  onDraft,
  onSelect,
  onToggle,
}: {
  document: PolicyDocument
  selectedId: string | null
  profiles: Profile[]
  onDraft: React.Dispatch<React.SetStateAction<PolicyDocument>>
  onSelect: (id: string | null) => void
  onToggle: (from: string, to: string, allowed: boolean) => void
}) {
  const actors = [...document.members.map((member) => member.key), OUTSIDE]
  const edge = document.edges.find((item) => edgeKey(item.from, item.to) === selectedId)
  const selected = selectedId && actors.includes(selectedId) ? selectedId : null
  const member = document.members.find((item) => item.key === selected)
  const editTemplate = document.kind === 'template'
  const updateMember = (change: Partial<PolicyMember>) =>
    onDraft((current) => ({
      ...current,
      members: current.members.map((item) =>
        item.key === member?.key ? { ...item, ...change } : item,
      ),
    }))

  if (edge) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase text-mocha-light">Allow edge</p>
        <p className="text-sm">
          {endpointLabel(document, edge.from)} → {endpointLabel(document, edge.to)}
        </p>
        <Button
          variant="danger"
          onClick={() => {
            onToggle(edge.from, edge.to, false)
            onSelect(null)
          }}
        >
          <X className="h-4 w-4" /> Remove edge
        </Button>
      </div>
    )
  }

  if (!selected) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase text-mocha-light">Summary</p>
          <p className="muted text-xs">
            {document.members.length} {editTemplate ? 'slots' : 'members'} · {document.edges.length}{' '}
            allow edges
          </p>
          <p className="muted mt-2 text-xs">
            Select a node to edit who it may message. Drag from one node's handle to another to add
            an edge. Other teams need an edge to Other teams in the sender's Team and one from Other
            teams in the recipient's Team.
          </p>
        </div>
        {editTemplate && (
          <>
            <label className="text-xs">
              USER.md for spawned Teams
              <textarea
                rows={6}
                value={document.userMd ?? ''}
                onChange={(event) => {
                  const userMd = event.target.value
                  onDraft((current) => ({ ...current, userMd: userMd || null }))
                }}
                className="font-mono text-[0.85em]"
              />
            </label>
            <Button
              variant="ghost"
              onClick={() =>
                onDraft((current) => ({
                  ...current,
                  members: [
                    ...current.members,
                    {
                      key: `draft:${crypto.randomUUID()}`,
                      profileId: profiles[0]?.id ?? '',
                      name: `Agent ${current.members.length + 1}`,
                      position: defaultPosition(current.members.length),
                    },
                  ],
                }))
              }
            >
              <Plus className="h-4 w-4" /> Add slot
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase text-mocha-light">
          {member ? 'Member' : 'Boundary'}
        </p>
        <h3 className="mt-1 text-base">{endpointLabel(document, selected)}</h3>
      </div>
      {member && editTemplate && (
        <div className="space-y-2">
          <label className="text-xs">
            Agent name
            <input
              value={member.name}
              onChange={(event) => updateMember({ name: event.target.value })}
            />
          </label>
          <label className="text-xs">
            Agent template
            <select
              value={member.profileId}
              onChange={(event) => updateMember({ profileId: event.target.value })}
            >
              {!profiles.some((profile) => profile.id === member.profileId) && (
                <option value={member.profileId}>{member.profileId || 'Select a template'}</option>
              )}
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs font-semibold">May send to</p>
        {actors
          .filter((target) => target !== selected)
          .map((target) => {
            const allowed = hasEdge(document, selected, target)
            return (
              <button
                key={target}
                type="button"
                aria-pressed={allowed}
                onClick={() => onToggle(selected, target, !allowed)}
                className="flex w-full items-center justify-between rounded border border-frost p-2 text-xs"
              >
                <span>{endpointLabel(document, target)}</span>
                {allowed ? 'Allowed' : 'Not allowed'}
              </button>
            )
          })}
      </div>
      {member && editTemplate && (
        <Button
          variant="danger"
          onClick={() => {
            onDraft((current) => ({
              ...current,
              members: current.members.filter((item) => item.key !== member.key),
              edges: current.edges.filter(
                (item) => item.from !== member.key && item.to !== member.key,
              ),
            }))
            onSelect(null)
          }}
        >
          <X className="h-4 w-4" /> Remove slot and its edges
        </Button>
      )}
    </div>
  )
}
