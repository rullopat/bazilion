import type { Profile } from '@bazilion/api-types'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  CheckCircle2,
  CircleUserRound,
  FlaskConical,
  Globe2,
  Network,
  Play,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  OUTSIDE_GROUP_ENDPOINT,
  USER_ENDPOINT,
  endpointForMember,
  endpointFromKey,
  endpointKey,
  evaluateHarnessPolicy,
  findHarnessMember,
  hasHarnessEdge,
  type HarnessBlockedAttempt,
  type HarnessDocument,
  type HarnessEndpoint,
  type HarnessMember,
  type HarnessOrigin,
  type ProfileCommunicationDefaults,
} from '../../lib/harness-prototype'
import { formatHarnessTime, harnessEndpointLabel } from '../../lib/harness-presenter'
import { ProfileCommunicationEditor } from './ProfileCommunicationEditor'

interface HarnessSidePanelProps {
  harness: HarnessDocument
  selectedId: string | null
  inspectRequest: number
  profiles: Profile[]
  profileDefaults: Record<string, ProfileCommunicationDefaults>
  blockedAttempts: HarnessBlockedAttempt[]
  onToggle: (source: HarnessEndpoint, target: HarnessEndpoint, allowed: boolean) => void
  onUpdateMember: (slotId: string, patch: Partial<HarnessMember>) => void
  onRemoveMember: (member: HarnessMember) => void
  onApplyProfileDefaults: (
    member: HarnessMember,
    defaults: ProfileCommunicationDefaults,
  ) => void
  onRemoveEdge: (source: HarnessEndpoint, target: HarnessEndpoint) => void
  onBlocked: (attempt: Omit<HarnessBlockedAttempt, 'id' | 'createdAt' | 'channel'>) => void
  onSimulated: (attempt: {
    source: HarnessEndpoint
    target: HarnessEndpoint
    decision: 'allow' | 'deny'
  }) => void
}

export function HarnessSidePanel(props: HarnessSidePanelProps) {
  const [tab, setTab] = useState<'inspect' | 'test'>('inspect')

  useEffect(() => {
    if (props.selectedId) setTab('inspect')
  }, [props.inspectRequest, props.selectedId])

  return (
    <aside className="flex h-full min-h-0 flex-col bg-snow">
      <div className="flex h-11 flex-none border-b border-frost px-2">
        <PanelTab active={tab === 'inspect'} onClick={() => setTab('inspect')}>
          Inspect
        </PanelTab>
        <PanelTab active={tab === 'test'} onClick={() => setTab('test')}>
          Test policy
        </PanelTab>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'inspect' ? <Inspector {...props} /> : <Simulator {...props} />}
      </div>
    </aside>
  )
}

function PanelTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 px-2 text-xs font-semibold ${
        active ? 'text-sapphire' : 'text-mocha-light hover:text-mocha'
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-sapphire" />}
    </button>
  )
}

function Inspector({
  harness,
  selectedId,
  profiles,
  profileDefaults,
  blockedAttempts,
  onToggle,
  onUpdateMember,
  onRemoveMember,
  onApplyProfileDefaults,
  onRemoveEdge,
}: HarnessSidePanelProps) {
  const edge = harness.policy.edges.find((candidate) => candidate.id === selectedId)
  if (edge) {
    return (
      <div>
        <Eyebrow>Directed permission</Eyebrow>
        <h3 className="m-0 font-body text-base font-semibold normal-case text-chocolate">
          {harnessEndpointLabel(harness, edge.source)}
          <span className="mx-1.5 text-sapphire">-&gt;</span>
          {harnessEndpointLabel(harness, edge.target)}
        </h3>
        <p className="mt-2 text-xs leading-5 text-mocha-light">
          This edge permits communication. It does not trigger or sequence either agent.
        </p>
        <button
          type="button"
          onClick={() => onRemoveEdge(edge.source, edge.target)}
          className="danger-btn mt-4"
        >
          <Trash2 className="h-3.5 w-3.5" /> remove permission
        </button>
      </div>
    )
  }

  const endpoint = selectedId ? endpointFromKey(selectedId) : null
  if (endpoint?.kind === 'user' || endpoint?.kind === 'outside_group') {
    const isUser = endpoint.kind === 'user'
    const Icon = isUser ? CircleUserRound : Globe2
    const connections = harness.policy.edges.filter(
      (candidate) =>
        endpointKey(candidate.source) === endpointKey(endpoint) ||
        endpointKey(candidate.target) === endpointKey(endpoint),
    )
    return (
      <div>
        <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-rose-baziu/10 text-rose-baziu">
          <Icon className="h-4 w-4" />
        </span>
        <Eyebrow>Boundary actor</Eyebrow>
        <h3 className="m-0 font-body text-base font-semibold normal-case text-chocolate">
          {isUser ? 'User' : 'Other groups'}
        </h3>
        <p className="mt-2 text-xs leading-5 text-mocha-light">
          {isUser
            ? 'Represents direct human communication through web, CLI, and Telegram.'
            : 'Represents agents in any other local Bazilion group.'}
        </p>
        <p className="mt-4 text-xs font-medium text-mocha">
          {connections.length} directed connection{connections.length === 1 ? '' : 's'}
        </p>
      </div>
    )
  }

  const member = endpoint ? findHarnessMember(harness, endpoint) : undefined
  if (!member) return <HarnessSummary harness={harness} />

  return (
    <MemberInspector
      harness={harness}
      member={member}
      profiles={profiles}
      defaults={profileDefaults[member.profileId]}
      attempts={blockedAttempts.filter(
        (attempt) =>
          endpointKey(attempt.source) === endpointKey(endpointForMember(harness, member)) ||
          endpointKey(attempt.target) === endpointKey(endpointForMember(harness, member)),
      )}
      onToggle={onToggle}
      onUpdateMember={onUpdateMember}
      onRemoveMember={onRemoveMember}
      onApplyProfileDefaults={onApplyProfileDefaults}
    />
  )
}

function HarnessSummary({ harness }: { harness: HarnessDocument }) {
  const isolated = harness.members.filter((member) => {
    const endpoint = endpointForMember(harness, member)
    return !harness.policy.edges.some(
      (edge) =>
        endpointKey(edge.source) === endpointKey(endpoint) ||
        endpointKey(edge.target) === endpointKey(endpoint),
    )
  }).length
  return (
    <div>
      <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-sapphire-glow text-sapphire">
        <Network className="h-4 w-4" />
      </span>
      <Eyebrow>{harness.kind === 'live' ? 'Live harness' : 'Harness template'}</Eyebrow>
      <h3 className="m-0 font-body text-base font-semibold normal-case text-chocolate">
        {harness.name}
      </h3>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <Stat label="Members" value={harness.members.length} />
        <Stat label="Allow edges" value={harness.policy.edges.length} />
        <Stat label="Isolated" value={isolated} warning={isolated > 0} />
        <Stat label="Mode" value={harness.kind} />
      </dl>
      <p className="mt-4 text-xs leading-5 text-mocha-light">
        Select an agent or permission edge to inspect and edit it. Use Test policy to simulate a
        path without sending a real message.
      </p>
    </div>
  )
}

function Stat({
  label,
  value,
  warning = false,
}: {
  label: string
  value: string | number
  warning?: boolean
}) {
  return (
    <div className="rounded-md border border-frost bg-ivory px-2.5 py-2">
      <dt className="text-[0.67rem] uppercase text-mocha-light">{label}</dt>
      <dd className={`mt-0.5 font-semibold ${warning ? 'text-[#a56568]' : 'text-chocolate'}`}>
        {value}
      </dd>
    </div>
  )
}

function MemberInspector({
  harness,
  member,
  profiles,
  defaults,
  attempts,
  onToggle,
  onUpdateMember,
  onRemoveMember,
  onApplyProfileDefaults,
}: {
  harness: HarnessDocument
  member: HarnessMember
  profiles: Profile[]
  defaults?: ProfileCommunicationDefaults
  attempts: HarnessBlockedAttempt[]
  onToggle: (source: HarnessEndpoint, target: HarnessEndpoint, allowed: boolean) => void
  onUpdateMember: (slotId: string, patch: Partial<HarnessMember>) => void
  onRemoveMember: (member: HarnessMember) => void
  onApplyProfileDefaults: (
    member: HarnessMember,
    defaults: ProfileCommunicationDefaults,
  ) => void
}) {
  const endpoint = endpointForMember(harness, member)
  const peers = harness.members.filter((candidate) => candidate.slotId !== member.slotId)
  const incidentCount = harness.policy.edges.filter(
    (edge) =>
      endpointKey(edge.source) === endpointKey(endpoint) ||
      endpointKey(edge.target) === endpointKey(endpoint),
  ).length
  const isolated = incidentCount === 0
  const incomplete =
    !profiles.some((profile) => profile.id === member.profileId) ||
    (harness.kind === 'live' && !member.agentId)
  const gates = [
    {
      label: 'User input',
      icon: ArrowDownToLine,
      source: USER_ENDPOINT,
      target: endpoint,
    },
    {
      label: 'User output',
      icon: ArrowUpFromLine,
      source: endpoint,
      target: USER_ENDPOINT,
    },
    {
      label: 'Other-group input',
      icon: Globe2,
      source: OUTSIDE_GROUP_ENDPOINT,
      target: endpoint,
    },
    {
      label: 'Other-group output',
      icon: Network,
      source: endpoint,
      target: OUTSIDE_GROUP_ENDPOINT,
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-sapphire-glow text-sapphire">
            <Bot className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <Eyebrow>{harness.kind === 'live' ? member.status ?? 'Local-only' : 'Member slot'}</Eyebrow>
            <h3 className="m-0 truncate font-body text-base font-semibold normal-case text-chocolate">
              {member.name}
            </h3>
            <span className="text-[0.68rem] text-mocha-light">{member.role ?? member.profileId}</span>
          </span>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2 border-t border-frost pt-4">
        <div
          className={`rounded-md border px-2.5 py-2 ${
            isolated
              ? 'border-rose-baziu/40 bg-rose-baziu/10'
              : 'border-sapphire-light bg-sapphire-glow'
          }`}
        >
          <p className="text-[0.65rem] font-semibold uppercase text-mocha-light">Connectivity</p>
          <p className="mt-0.5 text-xs font-semibold text-chocolate">
            {isolated ? 'Isolated' : `${incidentCount} directed edges`}
          </p>
        </div>
        <div
          className={`rounded-md border px-2.5 py-2 ${
            incomplete ? 'border-amber-500/40 bg-amber-500/10' : 'border-frost bg-ivory'
          }`}
        >
          <p className="text-[0.65rem] font-semibold uppercase text-mocha-light">Definition</p>
          <p className="mt-0.5 text-xs font-semibold text-chocolate">
            {incomplete ? 'Incomplete' : 'Ready'}
          </p>
        </div>
      </section>

      {(harness.kind === 'template' || !member.agentId) && (
        <section className="space-y-2 border-t border-frost pt-4">
          <Eyebrow>Slot configuration</Eyebrow>
          <label className="m-0 text-xs">
            Name
            <input
              value={member.name}
              onChange={(event) => onUpdateMember(member.slotId, { name: event.target.value })}
            />
          </label>
          <label className="m-0 text-xs">
            Profile
            <select
              value={member.profileId}
              onChange={(event) => {
                const profile = profiles.find((candidate) => candidate.id === event.target.value)
                onUpdateMember(member.slotId, {
                  profileId: event.target.value,
                  ...(profile && member.name === member.profileId ? { name: profile.name } : {}),
                })
              }}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
              {!profiles.some((profile) => profile.id === member.profileId) && (
                <option value={member.profileId}>{member.profileId} (fixture)</option>
              )}
            </select>
          </label>
          {defaults && (
            <button
              type="button"
              className="ghost-btn w-full justify-center"
              onClick={() => onApplyProfileDefaults(member, defaults)}
            >
              apply profile defaults
            </button>
          )}
        </section>
      )}

      <section className="border-t border-frost pt-4">
        <Eyebrow>Boundary gates</Eyebrow>
        <div className="mt-2 space-y-1.5">
          {gates.map((gate) => {
            const Icon = gate.icon
            const allowed = hasHarnessEdge(harness.policy, gate.source, gate.target)
            return (
              <label
                key={gate.label}
                className="m-0 flex cursor-pointer items-center gap-2 rounded-md border border-frost bg-ivory px-2.5 py-2"
              >
                <input
                  type="checkbox"
                  checked={allowed}
                  onChange={(event) => onToggle(gate.source, gate.target, event.target.checked)}
                />
                <Icon className="h-3.5 w-3.5 text-sapphire" />
                <span className="text-xs font-medium text-chocolate">{gate.label}</span>
              </label>
            )
          })}
        </div>
      </section>

      <section className="border-t border-frost pt-4">
        <Eyebrow>Peer permissions</Eyebrow>
        <div className="mt-2 space-y-2">
          {peers.map((peer) => {
            const peerEndpoint = endpointForMember(harness, peer)
            const outbound = hasHarnessEdge(harness.policy, endpoint, peerEndpoint)
            const inbound = hasHarnessEdge(harness.policy, peerEndpoint, endpoint)
            return (
              <div key={peer.slotId} className="rounded-md border border-frost bg-ivory px-2.5 py-2">
                <p className="truncate text-xs font-semibold text-chocolate">{peer.name}</p>
                <div className="mt-1.5 flex gap-3">
                  <label className="m-0 flex cursor-pointer items-center gap-1 text-[0.68rem] text-mocha">
                    <input
                      type="checkbox"
                      checked={inbound}
                      onChange={(event) =>
                        onToggle(peerEndpoint, endpoint, event.target.checked)
                      }
                    />
                    input
                  </label>
                  <label className="m-0 flex cursor-pointer items-center gap-1 text-[0.68rem] text-mocha">
                    <input
                      type="checkbox"
                      checked={outbound}
                      onChange={(event) =>
                        onToggle(endpoint, peerEndpoint, event.target.checked)
                      }
                    />
                    output
                  </label>
                </div>
              </div>
            )
          })}
          {peers.length === 0 && <p className="text-xs text-mocha-light">No peers in this harness.</p>}
        </div>
      </section>

      <section className="border-t border-frost pt-4">
        <Eyebrow>Recent blocks</Eyebrow>
        <AttemptList harness={harness} attempts={attempts.slice(0, 4)} />
      </section>

      <button
        type="button"
        className="danger-btn w-full justify-center"
        onClick={() => onRemoveMember(member)}
      >
        <Trash2 className="h-3.5 w-3.5" /> remove local member
      </button>
    </div>
  )
}

function Simulator({
  harness,
  blockedAttempts,
  onBlocked,
  onSimulated,
}: HarnessSidePanelProps) {
  const actors = useMemo<HarnessEndpoint[]>(
    () => [
      USER_ENDPOINT,
      ...harness.members.map((member) => endpointForMember(harness, member)),
      OUTSIDE_GROUP_ENDPOINT,
    ],
    [harness],
  )
  const [sourceKey, setSourceKey] = useState(endpointKey(USER_ENDPOINT))
  const [targetKey, setTargetKey] = useState(
    endpointKey(actors.find((actor) => actor.kind === 'agent' || actor.kind === 'member_slot') ?? OUTSIDE_GROUP_ENDPOINT),
  )
  const [origin, setOrigin] = useState<HarnessOrigin>('web')
  const [result, setResult] = useState<{
    source: HarnessEndpoint
    target: HarnessEndpoint
    decision: ReturnType<typeof evaluateHarnessPolicy>
  } | null>(null)

  useEffect(() => {
    if (!actors.some((actor) => endpointKey(actor) === sourceKey)) {
      setSourceKey(endpointKey(USER_ENDPOINT))
    }
    if (!actors.some((actor) => endpointKey(actor) === targetKey)) {
      const member = actors.find((actor) => actor.kind === 'agent' || actor.kind === 'member_slot')
      setTargetKey(endpointKey(member ?? OUTSIDE_GROUP_ENDPOINT))
    }
  }, [actors, sourceKey, targetKey])

  const run = () => {
    const source = endpointFromKey(sourceKey)
    const target = endpointFromKey(targetKey)
    if (!source || !target) return
    const decision = evaluateHarnessPolicy(harness.policy, source, target)
    setResult({ source, target, decision })
    onSimulated({ source, target, decision: decision.decision })
    if (decision.decision === 'deny') {
      onBlocked({ harnessId: harness.id, source, target, origin, reason: decision.reason })
    }
  }

  const recent = blockedAttempts.filter((attempt) => attempt.harnessId === harness.id).slice(0, 8)

  return (
    <div className="space-y-5">
      <div>
        <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-sapphire-glow text-sapphire">
          <FlaskConical className="h-4 w-4" />
        </span>
        <Eyebrow>Dry run</Eyebrow>
        <h3 className="m-0 font-body text-base font-semibold normal-case text-chocolate">
          Test a communication path
        </h3>
        <p className="mt-2 text-xs leading-5 text-mocha-light">
          Evaluates the local edge set and records denied attempts. No real message is sent.
        </p>
      </div>

      <div className="space-y-3">
        <ActorSelect label="Source" value={sourceKey} actors={actors} harness={harness} onChange={setSourceKey} />
        <ActorSelect label="Target" value={targetKey} actors={actors} harness={harness} onChange={setTargetKey} />
        <label className="m-0 text-xs">
          Transport origin
          <select value={origin} onChange={(event) => setOrigin(event.target.value as HarnessOrigin)}>
            <option value="web">Web</option>
            <option value="cli">CLI</option>
            <option value="telegram">Telegram</option>
            <option value="agent_tool">Agent tool</option>
            <option value="api">API</option>
          </select>
        </label>
        <button type="button" className="btn-primary w-full" onClick={run}>
          <Play className="h-3.5 w-3.5" /> simulate
        </button>
      </div>

      {result && (
        <section
          className={`rounded-md border px-3 py-3 ${
            result.decision.decision === 'allow'
              ? 'border-sapphire-light bg-sapphire-glow'
              : 'border-rose-baziu/50 bg-rose-baziu/10'
          }`}
        >
          <div className="flex items-center gap-2">
            {result.decision.decision === 'allow' ? (
              <CheckCircle2 className="h-4 w-4 text-sapphire" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-baziu" />
            )}
            <strong className="text-sm text-chocolate">
              {result.decision.decision === 'allow' ? 'Allowed' : 'Denied'}
            </strong>
          </div>
          <p className="mt-2 text-xs leading-5 text-mocha">
            {harnessEndpointLabel(harness, result.source)} -&gt;{' '}
            {harnessEndpointLabel(harness, result.target)}
          </p>
          <p className="mt-1 text-xs leading-5 text-mocha-light">{result.decision.reason}</p>
          {result.decision.edgeId && (
            <code className="mt-2 block truncate text-[0.65rem]">{result.decision.edgeId}</code>
          )}
        </section>
      )}

      <section className="border-t border-frost pt-4">
        <Eyebrow>Blocked attempts</Eyebrow>
        <AttemptList harness={harness} attempts={recent} />
      </section>
    </div>
  )
}

function ActorSelect({
  label,
  value,
  actors,
  harness,
  onChange,
}: {
  label: string
  value: string
  actors: HarnessEndpoint[]
  harness: HarnessDocument
  onChange: (value: string) => void
}) {
  return (
    <label className="m-0 text-xs">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {actors.map((actor) => (
          <option key={endpointKey(actor)} value={endpointKey(actor)}>
            {harnessEndpointLabel(harness, actor)}
          </option>
        ))}
      </select>
    </label>
  )
}

function AttemptList({
  harness,
  attempts,
}: {
  harness: HarnessDocument
  attempts: HarnessBlockedAttempt[]
}) {
  if (attempts.length === 0) {
    return <p className="mt-2 text-xs text-mocha-light">No blocked attempts recorded.</p>
  }
  return (
    <div className="mt-2 space-y-2">
      {attempts.map((attempt) => (
        <div key={attempt.id} className="rounded-md border border-frost bg-ivory px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 flex-none text-rose-baziu" />
            <span className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold text-chocolate">
              {harnessEndpointLabel(harness, attempt.source)} -&gt;{' '}
              {harnessEndpointLabel(harness, attempt.target)}
            </span>
          </div>
          <p className="mt-1 truncate text-[0.65rem] text-mocha-light">
            {attempt.channel} · {attempt.origin} · {formatHarnessTime(attempt.createdAt)}
          </p>
          <p className="mt-1 text-[0.68rem] leading-4 text-mocha">{attempt.reason}</p>
        </div>
      ))}
    </div>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[0.65rem] font-semibold uppercase text-mocha-light">{children}</p>
  )
}

export function ProfileDefaultsPreview({
  value,
  onChange,
}: {
  value: ProfileCommunicationDefaults
  onChange: (value: ProfileCommunicationDefaults) => void
}) {
  return <ProfileCommunicationEditor value={value} onChange={onChange} compact />
}
