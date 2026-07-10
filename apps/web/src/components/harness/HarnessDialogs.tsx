import type { Agent, Group, Profile } from '@bazilion/api-types'
import { ArrowDown, ArrowUp, Network, Plus, RotateCcw } from 'lucide-react'
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
import { useHarnessPrototype } from '../../hooks/use-harness-prototype'
import {
  bindLiveGroup,
  createHarnessTemplate,
  upsertHarness,
  type HarnessPreset,
} from '../../lib/harness-prototype'
import { HARNESS_PRESET_META, harnessEndpointLabel } from '../../lib/harness-presenter'
import { PrototypeBadge } from './PrototypeBadge'

interface CreateHarnessDialogProps {
  profiles: Profile[]
}

const PRESETS = Object.keys(HARNESS_PRESET_META) as HarnessPreset[]

export function CreateHarnessDialog({ profiles }: CreateHarnessDialogProps) {
  const { state, update } = useHarnessPrototype()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [preset, setPreset] = useState<HarnessPreset>('coordinator')
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const selectedProfiles = selected
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter((profile): profile is Profile => Boolean(profile))
    .map((profile) => ({ id: profile.id, name: profile.name }))

  const preview = useMemo(
    () =>
      createHarnessTemplate({
        id: 'template-preview',
        name: name.trim() || 'Untitled harness',
        preset,
        profiles: selectedProfiles,
        profileDefaults: state.profileDefaults,
        now: 0,
      }),
    [name, preset, selectedProfiles, state.profileDefaults],
  )

  const toggleProfile = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id],
    )
  }

  const move = (id: string, direction: -1 | 1) => {
    setSelected((current) => {
      const index = current.indexOf(id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      if (item) next.splice(nextIndex, 0, item)
      return next
    })
  }

  const create = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (selectedProfiles.length === 0) {
      setError('Select at least one profile.')
      return
    }
    if (preset === 'review_pipeline' && selectedProfiles.length < 4) {
      setError('Review Pipeline needs at least four profiles for its four roles.')
      return
    }
    const template = createHarnessTemplate({
      name: name.trim(),
      preset,
      profiles: selectedProfiles,
      profileDefaults: state.profileDefaults,
    })
    update((current) => upsertHarness(current, template))
    setOpen(false)
    setName('')
    setSelected([])
    window.location.assign(`/harnesses/${encodeURIComponent(template.id)}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          new harness
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Create harness template</DialogTitle>
            <PrototypeBadge />
          </div>
          <DialogDescription>
            Choose an explicit starting posture, order profile slots, and review the resolved
            communication graph before creating it locally.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={create} className="space-y-5">
          {error && <div className="err">{error}</div>}
          <label className="m-0">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Research review team"
              autoFocus
            />
          </label>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-chocolate">Starting preset</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRESETS.map((value) => (
                <label
                  key={value}
                  className={`m-0 cursor-pointer rounded-md border px-3 py-2.5 transition-colors ${
                    preset === value
                      ? 'border-sapphire bg-sapphire-glow'
                      : 'border-frost bg-ivory hover:border-sapphire-light'
                  }`}
                >
                  <span className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="harness-preset"
                      value={value}
                      checked={preset === value}
                      onChange={() => setPreset(value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-chocolate">
                        {HARNESS_PRESET_META[value].label}
                      </span>
                      <span className="block text-xs leading-5 text-mocha-light">
                        {HARNESS_PRESET_META[value].summary}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-chocolate">Profile slots</legend>
            {profiles.length === 0 ? (
              <p className="rounded-md border border-frost bg-ivory px-3 py-3 text-sm text-mocha-light">
                Create a profile first. Harness templates need at least one reusable profile.
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-md border border-frost bg-ivory">
                {profiles.map((profile) => {
                  const index = selected.indexOf(profile.id)
                  return (
                    <div
                      key={profile.id}
                      className="flex min-h-12 items-center gap-2 border-b border-frost px-3 py-2 last:border-0"
                    >
                      <input
                        type="checkbox"
                        checked={index >= 0}
                        onChange={() => toggleProfile(profile.id)}
                        aria-label={`Select ${profile.name}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-chocolate">
                        {profile.name}
                        <span className="ml-2 font-mono text-xs text-mocha-light">{profile.id}</span>
                      </span>
                      {index >= 0 && (
                        <>
                          <span className="text-xs text-mocha-light">
                            {preview.members[index]?.role ?? `slot ${index + 1}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => move(profile.id, -1)}
                            disabled={index === 0}
                            className="rounded-sm p-1 text-mocha hover:bg-sapphire-glow hover:text-sapphire disabled:opacity-30"
                            aria-label={`Move ${profile.name} up`}
                            title="Move up"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(profile.id, 1)}
                            disabled={index === selected.length - 1}
                            className="rounded-sm p-1 text-mocha hover:bg-sapphire-glow hover:text-sapphire disabled:opacity-30"
                            aria-label={`Move ${profile.name} down`}
                            title="Move down"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </fieldset>

          <section className="rounded-md border border-sapphire-light/60 bg-sapphire-glow px-4 py-3">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-sapphire" aria-hidden="true" />
              <h4 className="text-sm font-semibold text-chocolate">Resolved preview</h4>
            </div>
            <p className="mt-1 text-xs leading-5 text-mocha">
              {preview.members.length} member{preview.members.length === 1 ? '' : 's'} ·{' '}
              {preview.policy.edges.length} directed allow edge
              {preview.policy.edges.length === 1 ? '' : 's'} ·{' '}
              {HARNESS_PRESET_META[preset].label}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {preview.members.map((member) => (
                <span
                  key={member.slotId}
                  className="rounded-sm border border-frost bg-snow px-2 py-1 text-xs text-mocha"
                >
                  {member.role ? `${member.role}: ` : ''}
                  {member.name}
                </span>
              ))}
              {preview.members.length === 0 && (
                <span className="text-xs text-mocha-light">Select profiles to resolve the graph.</span>
              )}
            </div>
            <div className="mt-3 max-h-28 overflow-y-auto rounded-md border border-frost bg-snow">
              {preview.policy.edges.map((edge) => (
                <div
                  key={edge.id}
                  className="border-b border-frost px-2.5 py-1.5 text-xs text-mocha last:border-0"
                >
                  {harnessEndpointLabel(preview, edge.source)} -&gt;{' '}
                  {harnessEndpointLabel(preview, edge.target)}
                </div>
              ))}
              {preview.policy.edges.length === 0 && (
                <p className="px-2.5 py-2 text-xs text-mocha-light">
                  No communication paths. Every selected member will start isolated.
                </p>
              )}
            </div>
          </section>

          <div className="flex justify-end gap-2 border-t border-frost pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button variant="primary" type="submit">
              create locally
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface BindLiveHarnessDialogProps {
  groups: Group[]
  agents: Agent[]
}

export function BindLiveHarnessDialog({ groups, agents }: BindLiveHarnessDialogProps) {
  const { state, update } = useHarnessPrototype()
  const [open, setOpen] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [templateId, setTemplateId] = useState('template-open-team')
  const [error, setError] = useState<string | null>(null)

  const alreadyBound = new Set(state.liveHarnesses.map((harness) => harness.boundGroupId))
  const availableGroups = groups.filter((group) => !alreadyBound.has(group.id))
  const selectedGroup = groups.find((group) => group.id === groupId)
  const selectedTemplate = state.templates.find((template) => template.id === templateId)
  const groupAgents = agents.filter((agent) => agent.groupId === groupId)

  const bind = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!selectedGroup || !selectedTemplate) {
      setError('Choose both a live group and a source template.')
      return
    }
    if (groupAgents.length === 0) {
      setError('The selected group has no agents to bind.')
      return
    }
    const live = bindLiveGroup({
      group: selectedGroup,
      agents: groupAgents,
      sourceTemplate: selectedTemplate,
    })
    update((current) => upsertHarness(current, live))
    setOpen(false)
    window.location.assign(`/harnesses/${encodeURIComponent(live.id)}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Network className="h-4 w-4" aria-hidden="true" />
          bind live group
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Bind a live group</DialogTitle>
            <PrototypeBadge />
          </div>
          <DialogDescription>
            Read real agent ids for chat navigation while keeping every harness policy change in
            this browser.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={bind} className="space-y-4">
          {error && <div className="err">{error}</div>}
          <label className="m-0">
            Live group
            <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              <option value="">-- choose a group --</option>
              {availableGroups.map((group) => {
                const count = agents.filter((agent) => agent.groupId === group.id).length
                return (
                  <option key={group.id} value={group.id} disabled={count === 0}>
                    {group.name} ({count} agent{count === 1 ? '' : 's'})
                  </option>
                )
              })}
            </select>
          </label>
          <label className="m-0">
            Source template
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              {state.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {HARNESS_PRESET_META[template.preset].label}
                </option>
              ))}
            </select>
          </label>
          {selectedGroup && (
            <p className="rounded-md border border-frost bg-ivory px-3 py-2 text-xs leading-5 text-mocha">
              {groupAgents.length} live agent{groupAgents.length === 1 ? '' : 's'} will map to
              source slots by roster order. Extra agents remain live-only until explicitly added
              back to the template.
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-frost pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              cancel
            </Button>
            <Button variant="primary" type="submit">
              bind locally
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ResetHarnessPrototypeButton() {
  const { reset } = useHarnessPrototype()
  const onReset = () => {
    if (!confirm('Reset every local harness, profile default, layout, and block event?')) return
    reset()
  }
  return (
    <Button variant="ghost" onClick={onReset} title="Reset local prototype data">
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
      reset
    </Button>
  )
}
