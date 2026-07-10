import type { Agent, Profile } from '@bazilion/api-types'
import {
  ArrowLeft,
  Bot,
  Check,
  ListTree,
  Menu,
  PanelRight,
  ShieldAlert,
  TableProperties,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../Button'
import { useHarnessPrototype } from '../../hooks/use-harness-prototype'
import {
  addHarnessEdge,
  addHarnessMember,
  applyProfileDefaults,
  createBlockedAttempt,
  defaultHarnessUiState,
  diffLiveHarness,
  endpointForMember,
  endpointKey,
  getHarnessById,
  hasHarnessEdge,
  isValidHarnessConnection,
  removeHarnessEdge,
  removeHarnessMember,
  saveLiveAsTemplate,
  updateTemplateFromLive,
  upsertHarness,
  type HarnessBlockedAttempt,
  type HarnessDocument,
  type HarnessEndpoint,
  type HarnessMember,
  type HarnessPosition,
  type HarnessUiState,
} from '../../lib/harness-prototype'
import { HARNESS_PRESET_META, harnessEndpointLabel } from '../../lib/harness-presenter'
import { AddMemberDialog, HarnessDiffDialog } from './HarnessBuilderDialogs'
import { HarnessFlow } from './HarnessFlow'
import { HarnessMatrix } from './HarnessMatrix'
import { PrototypeBadge } from './PrototypeBadge'
import { HarnessSidePanel } from './HarnessSidePanel'

interface HarnessBuilderProps {
  harnessId: string
  profiles: Profile[]
  agents: Agent[]
}

export function HarnessBuilder({ harnessId, profiles, agents }: HarnessBuilderProps) {
  const { state, hydrated, update } = useHarnessPrototype()
  const storedHarness = getHarnessById(state, harnessId)
  const harness = useMemo(() => {
    if (!storedHarness || storedHarness.kind !== 'live') return storedHarness
    const currentAgents = new Map(agents.map((agent) => [agent.id, agent]))
    return {
      ...storedHarness,
      members: storedHarness.members.map((member) => {
        const agent = member.agentId ? currentAgents.get(member.agentId) : undefined
        return agent
          ? { ...member, name: agent.name, profileId: agent.profileId, status: agent.status }
          : member
      }),
    }
  }, [storedHarness, agents])
  const ui = state.ui[harnessId] ?? defaultHarnessUiState()
  const [mobilePanel, setMobilePanel] = useState<'roster' | 'inspector' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inspectRequest, setInspectRequest] = useState(0)
  const mobileInspectorTimer = useRef<number | null>(null)
  const [simulatedPath, setSimulatedPath] = useState<{
    source: HarnessEndpoint
    target: HarnessEndpoint
    decision: 'allow' | 'deny'
  } | null>(null)
  const incompleteSlotIds = useMemo(
    () =>
      new Set(
        (harness?.members ?? [])
          .filter(
            (member) =>
              !profiles.some((profile) => profile.id === member.profileId) ||
              (harness?.kind === 'live' && !member.agentId),
          )
          .map((member) => member.slotId),
      ),
    [harness?.kind, harness?.members, profiles],
  )

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2800)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(
    () => () => {
      if (mobileInspectorTimer.current !== null) {
        window.clearTimeout(mobileInspectorTimer.current)
      }
    },
    [],
  )

  if (!hydrated) {
    return <div className="flex h-full items-center justify-center text-sm text-mocha-light">Loading harness...</div>
  }
  if (!harness) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <ShieldAlert className="mx-auto h-7 w-7 text-rose-baziu" />
        <h1 className="mt-3">Harness not found</h1>
        <p className="muted mt-2">It may have been removed or reset from local prototype data.</p>
        <a href="/harnesses" className="ghost-btn mt-5">
          back to harnesses
        </a>
      </div>
    )
  }

  const sourceTemplate =
    harness.kind === 'live'
      ? state.templates.find((template) => template.id === harness.sourceTemplateId)
      : undefined
  const diff = harness.kind === 'live' ? diffLiveHarness(sourceTemplate, harness) : null
  const attempts = state.blockedAttempts.filter((attempt) => attempt.harnessId === harness.id)

  const updateUi = (patch: Partial<HarnessUiState>) => {
    update((current) => ({
      ...current,
      ui: {
        ...current.ui,
        [harnessId]: { ...(current.ui[harnessId] ?? defaultHarnessUiState()), ...patch },
      },
    }))
  }

  const select = (selectedId: string | null) => {
    updateUi({ selectedId })
    if (selectedId) setInspectRequest((current) => current + 1)
    if (mobileInspectorTimer.current !== null) {
      window.clearTimeout(mobileInspectorTimer.current)
      mobileInspectorTimer.current = null
    }
    if (selectedId && window.matchMedia('(max-width: 1279px)').matches) {
      mobileInspectorTimer.current = window.setTimeout(() => {
        setMobilePanel('inspector')
        mobileInspectorTimer.current = null
      }, 220)
    }
  }

  const mutateHarness = (mutate: (current: HarnessDocument) => HarnessDocument) => {
    update((current) => {
      const target = getHarnessById(current, harnessId)
      if (!target) return current
      const next = mutate(target)
      return upsertHarness(current, { ...next, updatedAt: Date.now() })
    })
  }

  const toggleEdge = (source: HarnessEndpoint, target: HarnessEndpoint, allowed: boolean) => {
    if (!isValidHarnessConnection(source, target)) {
      setNotice('That boundary-to-boundary or self connection is not valid.')
      return
    }
    mutateHarness((current) => ({
      ...current,
      policy: allowed
        ? addHarnessEdge(current.policy, source, target)
        : removeHarnessEdge(current.policy, source, target),
    }))
  }

  const connect = (source: HarnessEndpoint, target: HarnessEndpoint) => {
    if (!isValidHarnessConnection(source, target)) {
      setNotice('That connection is not valid.')
      return
    }
    if (hasHarnessEdge(harness.policy, source, target)) {
      setNotice('That directed permission already exists.')
      return
    }
    toggleEdge(source, target, true)
    setNotice('Communication permission added.')
  }

  const updateMember = (slotId: string, patch: Partial<HarnessMember>) => {
    mutateHarness((current) => ({
      ...current,
      members: current.members.map((member) =>
        member.slotId === slotId ? { ...member, ...patch } : member,
      ),
    }))
  }

  const moveMember = (slotId: string, position: HarnessPosition) => {
    updateMember(slotId, { position })
  }

  const addMember = (
    member: HarnessMember,
    defaults?: Parameters<typeof applyProfileDefaults>[3],
  ) => {
    mutateHarness((current) => addHarnessMember(current, member, defaults))
    updateUi({ selectedId: endpointKey(endpointForMember(harness, member)) })
    setMobilePanel('inspector')
    setNotice(defaults ? 'Member added with profile defaults.' : 'Member added in isolation.')
  }

  const removeMember = (member: HarnessMember) => {
    const endpoint = endpointForMember(harness, member)
    const incident = harness.policy.edges.filter(
      (edge) =>
        endpointKey(edge.source) === endpointKey(endpoint) ||
        endpointKey(edge.target) === endpointKey(endpoint),
    )
    const incidentPreview = incident
      .map(
        (edge) =>
          `${harnessEndpointLabel(harness, edge.source)} -> ${harnessEndpointLabel(harness, edge.target)}`,
      )
      .join('\n')
    if (
      !confirm(
        `Remove "${member.name}" from this local harness and delete ${incident.length} incident permission${incident.length === 1 ? '' : 's'}?${incidentPreview ? `\n\nPermissions removed:\n${incidentPreview}` : ''}`,
      )
    ) {
      return
    }
    mutateHarness((current) => removeHarnessMember(current, member.slotId))
    updateUi({ selectedId: null })
    setNotice('Local member and incident permissions removed.')
  }

  const applyDefaults = (
    member: HarnessMember,
    defaults: Parameters<typeof applyProfileDefaults>[3],
  ) => {
    mutateHarness((current) => ({
      ...current,
      policy: applyProfileDefaults(current.policy, current, member, defaults),
    }))
    setNotice('Profile defaults applied to this snapshot.')
  }

  const openMember = (member: HarnessMember) => {
    if (mobileInspectorTimer.current !== null) {
      window.clearTimeout(mobileInspectorTimer.current)
      mobileInspectorTimer.current = null
    }
    const selectedId = endpointKey(endpointForMember(harness, member))
    updateUi({ selectedId })
    if (harness.kind === 'live' && member.agentId) {
      window.location.assign(
        `/agents/${encodeURIComponent(member.agentId)}?harness=${encodeURIComponent(harness.id)}`,
      )
      return
    }
    setMobilePanel('inspector')
    setNotice(
      harness.kind === 'template'
        ? 'Template slots open configuration; chat is available after spawn.'
        : 'This local-only member has no real agent chat.',
    )
  }

  const recordBlock = (
    attempt: Omit<HarnessBlockedAttempt, 'id' | 'createdAt' | 'channel'>,
  ) => {
    update((current) => ({
      ...current,
      blockedAttempts: [createBlockedAttempt(attempt), ...current.blockedAttempts].slice(0, 200),
    }))
  }

  const updateSource = (includeLiveOnlySlots: Set<string>) => {
    if (harness.kind !== 'live' || !sourceTemplate) return
    update((current) => {
      const currentLive = current.liveHarnesses.find((candidate) => candidate.id === harness.id)
      const currentSource = current.templates.find(
        (candidate) => candidate.id === harness.sourceTemplateId,
      )
      if (!currentLive || !currentSource) return current
      const updated = updateTemplateFromLive({
        sourceTemplate: currentSource,
        liveHarness: { ...currentLive, members: harness.members },
        includeLiveOnlySlots,
      })
      return {
        ...current,
        templates: current.templates.map((template) =>
          template.id === updated.id ? updated : template,
        ),
      }
    })
    setNotice('Source template updated for future local snapshots only.')
  }

  const saveAsNew = (name: string) => {
    if (harness.kind !== 'live') return
    const template = saveLiveAsTemplate({ liveHarness: harness, name })
    update((current) => upsertHarness(current, template))
    setNotice(`Saved "${name}" as an independent local template.`)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex min-h-14 flex-none flex-wrap items-center gap-2 border-b border-frost bg-cream px-2 py-2 sm:px-3">
        <a
          href="/harnesses"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-mocha hover:bg-sapphire-glow hover:text-sapphire"
          aria-label="Back to harnesses"
          title="Back to harnesses"
        >
          <ArrowLeft className="h-4 w-4" />
        </a>
        <div className="mr-auto min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="m-0 max-w-[15rem] truncate font-body text-sm font-semibold text-chocolate sm:max-w-md">
              {harness.name}
            </h1>
            <PrototypeBadge compact />
            {diff?.modified && (
              <span className="hidden rounded-sm bg-rose-baziu/15 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase text-[#8a5558] dark:text-[#e5b0b3] sm:inline">
                Modified
              </span>
            )}
          </div>
          <p className="mt-0.5 max-w-[15rem] truncate text-[0.67rem] text-mocha-light sm:max-w-md">
            {harness.kind === 'live'
              ? `Live snapshot · Based on ${sourceTemplate?.name ?? 'missing template'}`
              : 'Template'}{' '}
            ·{' '}
            {HARNESS_PRESET_META[harness.preset].label} · saved locally
          </p>
        </div>

        <div className="flex h-8 items-center rounded-md border border-frost bg-ivory p-0.5">
          <ViewButton
            active={ui.view === 'flow'}
            icon={ListTree}
            label="Flow"
            onClick={() => updateUi({ view: 'flow' })}
          />
          <ViewButton
            active={ui.view === 'matrix'}
            icon={TableProperties}
            label="Matrix"
            onClick={() => updateUi({ view: 'matrix' })}
          />
        </div>

        <div className="hidden items-center gap-1 xl:flex">
          <AddMemberDialog
            harness={harness}
            profiles={profiles}
            profileDefaults={state.profileDefaults}
            onAdd={addMember}
          />
          {harness.kind === 'live' && (
            <HarnessDiffDialog
              liveHarness={harness}
              sourceTemplate={sourceTemplate}
              onUpdateSource={updateSource}
              onSaveAsNew={saveAsNew}
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobilePanel('roster')}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-frost bg-ivory text-mocha hover:text-sapphire xl:hidden"
          aria-label="Open roster"
          title="Roster"
        >
          <Menu className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('inspector')}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-frost bg-ivory text-mocha hover:text-sapphire xl:hidden"
          aria-label="Open inspector"
          title="Inspector"
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[230px_minmax(0,1fr)_310px]">
        <div className="hidden min-h-0 border-r border-frost xl:block">
          <HarnessRoster
            harness={harness}
            selectedId={ui.selectedId}
            incompleteSlotIds={incompleteSlotIds}
            onSelect={select}
            onOpen={openMember}
          />
        </div>
        <main className="relative min-h-0 overflow-hidden">
          {ui.view === 'flow' ? (
            <HarnessFlow
              harness={harness}
              selectedId={ui.selectedId}
              viewport={ui.viewport}
              incompleteSlotIds={incompleteSlotIds}
              simulatedPath={simulatedPath}
              onSelect={select}
              onConnect={connect}
              onRemoveEdge={(source, target) => toggleEdge(source, target, false)}
              onMoveMember={moveMember}
              onViewportChange={(viewport) => updateUi({ viewport })}
              onOpenMember={openMember}
            />
          ) : (
            <HarnessMatrix
              harness={harness}
              selectedId={ui.selectedId}
              onSelect={select}
              onToggle={toggleEdge}
            />
          )}
          {notice && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md border border-frost bg-snow px-3 py-2 text-center text-xs text-mocha shadow-baziu-md">
              {notice}
            </div>
          )}
        </main>
        <div className="hidden min-h-0 border-l border-frost xl:block">
          <HarnessSidePanel
            harness={harness}
            selectedId={ui.selectedId}
            inspectRequest={inspectRequest}
            profiles={profiles}
            profileDefaults={state.profileDefaults}
            blockedAttempts={attempts}
            onToggle={toggleEdge}
            onUpdateMember={updateMember}
            onRemoveMember={removeMember}
            onApplyProfileDefaults={applyDefaults}
            onRemoveEdge={(source, target) => toggleEdge(source, target, false)}
            onBlocked={recordBlock}
            onSimulated={setSimulatedPath}
          />
        </div>
      </div>

      {mobilePanel && (
        <MobilePanel title={mobilePanel === 'roster' ? 'Roster' : 'Inspector'} onClose={() => setMobilePanel(null)}>
          {mobilePanel === 'roster' ? (
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap gap-2 border-b border-frost p-3">
                <AddMemberDialog
                  harness={harness}
                  profiles={profiles}
                  profileDefaults={state.profileDefaults}
                  onAdd={addMember}
                />
                {harness.kind === 'live' && (
                  <HarnessDiffDialog
                    liveHarness={harness}
                    sourceTemplate={sourceTemplate}
                    onUpdateSource={updateSource}
                    onSaveAsNew={saveAsNew}
                  />
                )}
              </div>
              <div className="min-h-0 flex-1">
                <HarnessRoster
                  harness={harness}
                  selectedId={ui.selectedId}
                  incompleteSlotIds={incompleteSlotIds}
                  onSelect={(selectedId) => {
                    updateUi({ selectedId })
                    setMobilePanel('inspector')
                  }}
                  onOpen={openMember}
                />
              </div>
            </div>
          ) : (
            <HarnessSidePanel
              harness={harness}
              selectedId={ui.selectedId}
              inspectRequest={inspectRequest}
              profiles={profiles}
              profileDefaults={state.profileDefaults}
              blockedAttempts={attempts}
              onToggle={toggleEdge}
              onUpdateMember={updateMember}
              onRemoveMember={removeMember}
              onApplyProfileDefaults={applyDefaults}
              onRemoveEdge={(source, target) => toggleEdge(source, target, false)}
              onBlocked={recordBlock}
              onSimulated={setSimulatedPath}
            />
          )}
        </MobilePanel>
      )}
    </div>
  )
}

function ViewButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof ListTree
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs font-semibold ${
        active ? 'bg-snow text-sapphire shadow-baziu-sm' : 'text-mocha-light hover:text-mocha'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function HarnessRoster({
  harness,
  selectedId,
  incompleteSlotIds,
  onSelect,
  onOpen,
}: {
  harness: HarnessDocument
  selectedId: string | null
  incompleteSlotIds: Set<string>
  onSelect: (id: string) => void
  onOpen: (member: HarnessMember) => void
}) {
  return (
    <aside className="flex h-full min-h-0 flex-col bg-snow">
      <div className="flex h-11 flex-none items-center justify-between border-b border-frost px-3">
        <span className="text-xs font-semibold uppercase text-mocha-light">Members</span>
        <span className="text-xs text-mocha-light">{harness.members.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {harness.members.map((member) => {
          const endpoint = endpointForMember(harness, member)
          const id = endpointKey(endpoint)
          const isolated = !harness.policy.edges.some(
            (edge) =>
              endpointKey(edge.source) === id || endpointKey(edge.target) === id,
          )
          const incomplete = incompleteSlotIds.has(member.slotId)
          return (
            <button
              key={member.slotId}
              type="button"
              onClick={() => onSelect(id)}
              onDoubleClick={() => onOpen(member)}
              title={
                harness.kind === 'live' && member.agentId
                  ? `Open ${member.name} chat`
                  : `Configure ${member.name}`
              }
              className={`mb-1 flex min-h-12 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                selectedId === id ? 'bg-sapphire-glow' : 'hover:bg-ivory'
              }`}
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-ivory text-sapphire">
                <Bot className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-chocolate">
                  {member.name}
                </span>
                <span className="mt-0.5 block truncate text-[0.65rem] text-mocha-light">
                  {incomplete
                    ? 'incomplete · missing profile or agent'
                    : member.role ?? member.status ?? member.profileId}
                </span>
              </span>
              {isolated ? (
                <ShieldAlert className="h-3.5 w-3.5 flex-none text-rose-baziu" aria-label="Isolated" />
              ) : member.status === 'running' ? (
                <span className="h-2 w-2 flex-none rounded-full bg-sapphire" title="Running" />
              ) : (
                <Check className="h-3.5 w-3.5 flex-none text-mocha-light" aria-label="Configured" />
              )}
            </button>
          )
        })}
        {harness.members.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-mocha-light">No members yet.</p>
        )}
      </div>
    </aside>
  )
}

function MobilePanel({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px] xl:hidden"
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-[min(92vw,360px)] flex-col border-l border-frost bg-snow shadow-baziu-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-12 flex-none items-center justify-between border-b border-frost px-3">
          <span className="text-sm font-semibold text-chocolate">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-mocha hover:bg-sapphire-glow hover:text-sapphire"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
