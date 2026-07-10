import type { Profile } from '@bazilion/api-types'
import { CopyPlus, GitCompareArrows, Plus, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'
import {
  diffLiveHarness,
  type HarnessDiff,
  type HarnessDocument,
  type HarnessMember,
  type ProfileCommunicationDefaults,
} from '../../lib/harness-prototype'
import { harnessEndpointLabel } from '../../lib/harness-presenter'
import { PrototypeBadge } from './PrototypeBadge'

interface AddMemberDialogProps {
  harness: HarnessDocument
  profiles: Profile[]
  profileDefaults: Record<string, ProfileCommunicationDefaults>
  onAdd: (member: HarnessMember, defaults?: ProfileCommunicationDefaults) => void
}

export function AddMemberDialog({
  harness,
  profiles,
  profileDefaults,
  onAdd,
}: AddMemberDialogProps) {
  const [open, setOpen] = useState(false)
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '')
  const profile = profiles.find((candidate) => candidate.id === profileId)
  const [name, setName] = useState('')
  const [applyDefaults, setApplyDefaults] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!profile) {
      setError('Choose a profile.')
      return
    }
    const now = Date.now()
    const slotId = `${harness.id}-slot-${now}`
    const member: HarnessMember = {
      slotId,
      profileId: profile.id,
      name: name.trim() || profile.name,
      position: {
        x: 280 + (harness.members.length % 3) * 240,
        y: 120 + Math.floor(harness.members.length / 3) * 170,
      },
    }
    onAdd(member, applyDefaults ? profileDefaults[profile.id] : undefined)
    setOpen(false)
    setName('')
    setApplyDefaults(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" title="Add a local member">
          <Plus className="h-4 w-4" />
          add member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Add member</DialogTitle>
            <PrototypeBadge />
          </div>
          <DialogDescription>
            The member starts isolated. Applying profile defaults is an explicit optional step.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={add} className="space-y-4">
          {error && <div className="err">{error}</div>}
          <label className="m-0">
            Profile
            <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              {profiles.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <label className="m-0">
            Member name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={profile?.name ?? 'Agent name'}
            />
          </label>
          {profile && profileDefaults[profile.id] && (
            <label className="m-0 flex cursor-pointer items-start gap-2 rounded-md border border-frost bg-ivory px-3 py-2.5">
              <input
                type="checkbox"
                checked={applyDefaults}
                onChange={(event) => setApplyDefaults(event.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-semibold text-chocolate">
                  Apply profile defaults
                </span>
                <span className="block text-xs leading-5 text-mocha-light">
                  Otherwise this member has no edges until you configure it.
                </span>
              </span>
            </label>
          )}
          {harness.kind === 'live' && (
            <p className="rounded-md border border-frost bg-ivory px-3 py-2 text-xs leading-5 text-mocha-light">
              This creates a local-only live member. It has no real agent id or chat until the
              production persistence work is implemented.
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-frost pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!profile}>
              add isolated member
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface HarnessDiffDialogProps {
  liveHarness: HarnessDocument
  sourceTemplate?: HarnessDocument
  onUpdateSource: (includeLiveOnlySlots: Set<string>) => void
  onSaveAsNew: (name: string) => void
}

export function HarnessDiffDialog({
  liveHarness,
  sourceTemplate,
  onUpdateSource,
  onSaveAsNew,
}: HarnessDiffDialogProps) {
  const [open, setOpen] = useState(false)
  const [includeSlots, setIncludeSlots] = useState<Set<string>>(new Set())
  const [reviewedRemovalSlots, setReviewedRemovalSlots] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState(`${liveHarness.name} template`)
  const diff = useMemo(
    () => diffLiveHarness(sourceTemplate, liveHarness),
    [sourceTemplate, liveHarness],
  )

  const toggleSlot = (slotId: string) => {
    setIncludeSlots((current) => {
      const next = new Set(current)
      if (next.has(slotId)) next.delete(slotId)
      else next.add(slotId)
      return next
    })
  }

  const toggleReviewedRemoval = (slotId: string) => {
    setReviewedRemovalSlots((current) => {
      const next = new Set(current)
      if (next.has(slotId)) next.delete(slotId)
      else next.add(slotId)
      return next
    })
  }
  const allRemovalsReviewed = diff.removedMembers.every((member) =>
    reviewedRemovalSlots.has(member.slotId),
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" title="Compare live harness with its source template">
          <GitCompareArrows className="h-4 w-4" />
          compare
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Template comparison</DialogTitle>
            <PrototypeBadge />
          </div>
          <DialogDescription>
            Live and template policies are independent snapshots. Review every local difference
            before updating the source or creating another template.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <DiffStat label="Added members" value={diff.addedMembers.length} />
          <DiffStat label="Missing members" value={diff.removedMembers.length} />
          <DiffStat label="Changed members" value={diff.changedMembers.length} />
          <DiffStat label="Added edges" value={diff.addedEdges.length} />
          <DiffStat label="Removed edges" value={diff.removedEdges.length} />
        </div>

        {!sourceTemplate && (
          <div className="err">The source template no longer exists. Save this harness as a new template.</div>
        )}

        {sourceTemplate && !diff.modified && (
          <p className="rounded-md border border-sapphire-light bg-sapphire-glow px-3 py-3 text-sm text-mocha">
            This live harness matches {sourceTemplate.name}.
          </p>
        )}

        {diff.addedMembers.length > 0 && (
          <section>
            <h4 className="text-sm font-semibold text-chocolate">Live-only members</h4>
            <p className="mt-1 text-xs text-mocha-light">
              They remain excluded unless explicitly checked for source-template inclusion.
            </p>
            <div className="mt-2 space-y-1.5">
              {diff.addedMembers.map((member) => (
                <label
                  key={member.slotId}
                  className="m-0 flex cursor-pointer items-center gap-2 rounded-md border border-frost bg-ivory px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={includeSlots.has(member.slotId)}
                    onChange={() => toggleSlot(member.slotId)}
                  />
                  <span className="text-sm text-chocolate">{member.name}</span>
                  <span className="ml-auto text-xs text-mocha-light">new template slot</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {sourceTemplate && diff.removedMembers.length > 0 && (
          <section>
            <h4 className="text-sm font-semibold text-chocolate">Members missing from live</h4>
            <p className="mt-1 text-xs leading-5 text-mocha-light">
              Updating the source removes these slots and their permissions. Check each removal to
              confirm it was reviewed.
            </p>
            <div className="mt-2 space-y-2">
              {diff.removedMembers.map((member) => {
                const incident = sourceTemplate.policy.edges.filter(
                  (edge) =>
                    (edge.source.kind === 'member_slot' &&
                      edge.source.slotId === member.slotId) ||
                    (edge.target.kind === 'member_slot' && edge.target.slotId === member.slotId),
                )
                return (
                  <label
                    key={member.slotId}
                    className="m-0 block cursor-pointer rounded-md border border-rose-baziu/30 bg-rose-baziu/5 px-3 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={reviewedRemovalSlots.has(member.slotId)}
                        onChange={() => toggleReviewedRemoval(member.slotId)}
                      />
                      <strong className="min-w-0 truncate text-sm text-chocolate">
                        {member.name}
                      </strong>
                      <span className="ml-auto text-xs text-mocha-light">
                        {incident.length} permission{incident.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    {incident.length > 0 && (
                      <span className="mt-2 block space-y-1 border-t border-rose-baziu/20 pt-2">
                        {incident.map((edge) => (
                          <span key={edge.id} className="block text-[0.68rem] text-mocha-light">
                            {harnessEndpointLabel(sourceTemplate, edge.source)} -&gt;{' '}
                            {harnessEndpointLabel(sourceTemplate, edge.target)}
                          </span>
                        ))}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </section>
        )}

        {diff.changedMembers.length > 0 && (
          <section>
            <h4 className="text-sm font-semibold text-chocolate">Changed member settings</h4>
            <div className="mt-2 space-y-1.5">
              {diff.changedMembers.map(({ source, live }) => (
                <div
                  key={live.slotId}
                  className="rounded-md border border-frost bg-ivory px-3 py-2 text-xs text-mocha"
                >
                  <strong className="text-chocolate">{source.name}</strong> -&gt; {live.name}
                  <span className="mt-1 block text-mocha-light">
                    profile {source.profileId} -&gt; {live.profileId}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <DiffEdges title="Added permissions" edges={diff.addedEdges} harness={liveHarness} />
        <DiffEdges title="Removed permissions" edges={diff.removedEdges} harness={liveHarness} />

        <section className="border-t border-frost pt-4">
          <h4 className="text-sm font-semibold text-chocolate">Promote reviewed changes</h4>
          <p className="mt-1 text-xs leading-5 text-mocha-light">
            Updating affects future local snapshots only. Existing live harnesses never change.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!sourceTemplate || !diff.modified || !allRemovalsReviewed}
              onClick={() => {
                if (!confirm('Update the local source template with these reviewed changes?')) return
                onUpdateSource(includeSlots)
                setOpen(false)
              }}
            >
              <RefreshCw className="h-4 w-4" /> update source template
            </Button>
          </div>
        </section>

        <section className="border-t border-frost pt-4">
          <h4 className="text-sm font-semibold text-chocolate">Save independently</h4>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input value={newName} onChange={(event) => setNewName(event.target.value)} />
            <Button
              variant="ghost"
              disabled={!newName.trim()}
              onClick={() => {
                onSaveAsNew(newName.trim())
                setOpen(false)
              }}
              className="whitespace-nowrap"
            >
              <CopyPlus className="h-4 w-4" /> save as new
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}

function DiffStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-frost bg-ivory px-2.5 py-2">
      <p className="text-[0.64rem] uppercase text-mocha-light">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${value > 0 ? 'text-chocolate' : 'text-fawn'}`}>
        {value}
      </p>
    </div>
  )
}

function DiffEdges({
  title,
  edges,
  harness,
}: {
  title: string
  edges: HarnessDiff['addedEdges']
  harness: HarnessDocument
}) {
  if (edges.length === 0) return null
  return (
    <section>
      <h4 className="text-sm font-semibold text-chocolate">{title}</h4>
      <div className="mt-2 max-h-32 overflow-y-auto rounded-md border border-frost bg-ivory">
        {edges.map((edge) => (
          <div key={edge.id} className="border-b border-frost px-3 py-2 text-xs text-mocha last:border-0">
            {harnessEndpointLabel(harness, edge.source)} -&gt;{' '}
            {harnessEndpointLabel(harness, edge.target)}
          </div>
        ))}
      </div>
    </section>
  )
}
