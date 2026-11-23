import type { Profile, TeamPolicyMode, TeamTemplate } from '@bazilion/api-types'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import {
  defaultPosition,
  edgeKey,
  endpointLabel,
  hasEdge,
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
import { Segmented } from '../Segmented'
import { UnsavedChangesGuard } from '../UnsavedChangesGuard'
import { SelectField, SwitchRow, TextField } from '../ui/form'
import { Notice } from '../ui/parts'
import { TeamPolicyFlow } from './TeamPolicyFlow'
import { TeamPolicyMatrix } from './TeamPolicyMatrix'

const MODE_HELP: Record<TeamPolicyMode, string> = {
  open: 'Every member can message every other member, with no connections needed; connections only matter for messages to and from other Teams, or if the Team is made restricted.',
  restricted: 'Members message each other only along connections.',
}

/** A Team template's roster and connections, as a flow or a matrix. */
export function TeamPolicyEditor({
  template,
  profiles,
  onSaved,
  onDirtyChange,
}: {
  template: TeamTemplate
  profiles: Profile[]
  /** Called after a save, so that the page around it shows the saved roster. */
  onSaved?: () => Promise<void>
  /** Told whether there are unsaved changes, so the page does not act on the saved roster. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [server, setServer] = useState(() => templateDocument(template))
  const [draft, setDraft] = useState(server)
  const [view, setView] = useState<'flow' | 'matrix'>('flow')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dirty = !sameDocument(server, draft)
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  const incomplete = useMemo(
    () =>
      new Set(
        draft.members
          .filter((member) => !profiles.some((profile) => profile.id === member.profileId))
          .map((member) => member.key),
      ),
    [draft.members, profiles],
  )

  const templateNames = useMemo(
    () =>
      Object.fromEntries(
        profiles.map((profile) => [profile.id, `${profile.name || profile.id} template`]),
      ),
    [profiles],
  )

  const toggle = (from: string, to: string, allowed: boolean) =>
    setDraft((current) => setEdge(current, from, to, allowed))

  const save = async () => {
    setSaving(true)
    setNotice(null)
    try {
      const saved = templateDocument(
        await api<TeamTemplate>(`/api/team-templates/${encodeURIComponent(template.id)}`, {
          method: 'PUT',
          body: templateInput(draft, profiles),
        }),
      )
      setServer(saved)
      setDraft(saved)
      setSelectedId(null)
      setNotice({ text: 'Saved.', ok: true })
      await onSaved?.()
    } catch (error) {
      setNotice({ text: errorMessage(error), ok: false })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <UnsavedChangesGuard when={dirty} subject="Team template draft" />
      <section
        className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm"
        aria-label="Roster and connections"
      >
        <header className="flex flex-wrap items-end gap-x-3 gap-y-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0 flex-1 basis-60">
            <TextField
              label="Name"
              value={draft.name}
              disabled={saving}
              required
              className="max-w-none"
              problem={draft.name.trim() ? undefined : 'A template needs a name.'}
              onChange={(name) => setDraft((current) => ({ ...current, name }))}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-semibold text-foreground">Messaging</span>
            <Segmented
              label="Messaging"
              value={draft.mode}
              onChange={(mode) => setDraft((current) => ({ ...current, mode }))}
              options={[
                { id: 'open', label: 'Open' },
                { id: 'restricted', label: 'Restricted' },
              ]}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-semibold text-foreground">View</span>
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { id: 'flow', label: 'Flow' },
                { id: 'matrix', label: 'Matrix' },
              ]}
            />
          </div>
          <p className="m-0 basis-full text-sm text-muted-foreground">{MODE_HELP[draft.mode]}</p>
        </header>
        <div className="grid min-h-[620px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-h-[480px] overflow-hidden">
            {view === 'flow' ? (
              <TeamPolicyFlow
                document={draft}
                templateNames={templateNames}
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
                onOpenMember={(member) => setSelectedId(member.key)}
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
          <aside className="border-t border-border p-4 lg:border-l lg:border-t-0">
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
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-4 sm:px-5">
          <Button
            variant="primary"
            disabled={!dirty || saving || !draft.name.trim()}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {dirty && (
            <Button variant="ghost" disabled={saving} onClick={() => setConfirmDiscard(true)}>
              Discard changes
            </Button>
          )}
          <p
            role="status"
            className={`m-0 min-w-0 flex-1 basis-56 text-sm font-medium ${
              notice && !notice.ok
                ? 'text-warning'
                : dirty
                  ? 'text-warning'
                  : notice
                    ? 'text-success'
                    : 'text-muted-foreground'
            }`}
          >
            {notice && !notice.ok
              ? `Nothing was saved: ${notice.text}`
              : dirty
                ? 'Not saved yet.'
                : notice
                  ? 'Saved. Teams spawned from now on get this roster.'
                  : 'Teams already spawned keep their own Agents and connections.'}
          </p>
        </footer>
      </section>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes to this template?"
        description={<p>The saved roster and connections stay as they are.</p>}
        confirmLabel="Discard changes"
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
  const updateMember = (change: Partial<PolicyMember>) =>
    onDraft((current) => ({
      ...current,
      members: current.members.map((item) =>
        item.key === member?.key ? { ...item, ...change } : item,
      ),
    }))

  if (edge) {
    return (
      <div className="grid gap-3">
        <h3 className="m-0 font-body text-sm font-semibold text-foreground">Connection</h3>
        <p className="m-0 text-sm">
          {endpointLabel(document, edge.from)} may message {endpointLabel(document, edge.to)}.
        </p>
        <div>
          <Button
            variant="danger"
            onClick={() => {
              onToggle(edge.from, edge.to, false)
              onSelect(null)
            }}
          >
            Remove connection
          </Button>
        </div>
      </div>
    )
  }

  if (!selected) {
    return (
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h3 className="m-0 font-body text-sm font-semibold text-foreground">
            {document.members.length === 1 ? '1 Agent' : `${document.members.length} Agents`} ·{' '}
            {document.edges.length === 1 ? '1 connection' : `${document.edges.length} connections`}
          </h3>
          <p className="m-0 text-sm text-muted-foreground">
            Select an Agent to choose who it may message, or drag from one Agent's dot to another. A
            message to another Team needs a connection to Other teams here, and one from Other teams
            in that Team.
          </p>
        </div>
        <div>
          <label
            htmlFor="team-template-user-md"
            className="m-0 text-sm font-semibold text-foreground"
          >
            USER.md
          </label>
          <textarea
            id="team-template-user-md"
            rows={6}
            value={document.userMd ?? ''}
            onChange={(event) => {
              const userMd = event.target.value
              onDraft((current) => ({ ...current, userMd: userMd || null }))
            }}
            className="mt-1.5 font-mono text-[0.85em]"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            What every Agent of a Team spawned from it knows about you.
          </span>
        </div>
        <div>
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
            <Plus className="size-4" aria-hidden="true" /> Add an Agent
          </Button>
        </div>
      </div>
    )
  }

  const known = member && profiles.some((profile) => profile.id === member.profileId)
  return (
    <div className="grid gap-4">
      <h3 className="m-0 font-body text-sm font-semibold text-foreground">
        {member ? member.name || 'Agent' : 'Other teams'}
      </h3>
      {member && (
        <>
          <TextField
            label="Name"
            value={member.name}
            className="max-w-none"
            onChange={(name) => updateMember({ name })}
          />
          <SelectField
            label="Template"
            value={member.profileId}
            className="max-w-none"
            options={[
              ...(known
                ? []
                : [{ value: member.profileId, label: member.profileId || 'Choose a template' }]),
              ...profiles.map((profile) => ({
                value: profile.id,
                label: profile.name || profile.id,
              })),
            ]}
            onChange={(profileId) => updateMember({ profileId })}
          />
          {!known && (
            <Notice tone="warning">
              Choose a template: an Agent cannot be spawned without one.
            </Notice>
          )}
        </>
      )}
      <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-semibold text-foreground">May message</legend>
        {actors
          .filter((target) => target !== selected)
          .map((target) => (
            <SwitchRow
              key={target}
              label={endpointLabel(document, target)}
              checked={hasEdge(document, selected, target)}
              onChange={(allowed) => onToggle(selected, target, allowed)}
            />
          ))}
      </fieldset>
      {member && (
        <div>
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
            Remove this Agent
          </Button>
        </div>
      )}
    </div>
  )
}
