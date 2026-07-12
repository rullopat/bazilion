import { ArrowDownToLine, ArrowUpFromLine, Network, UserRound } from 'lucide-react'
import type {
  ProfileCommunicationDefaults,
  ProfilePeerDefault,
} from '../../lib/team-policy'

interface ProfileCommunicationEditorProps {
  value: ProfileCommunicationDefaults
  onChange: (value: ProfileCommunicationDefaults) => void
  compact?: boolean
}

const PEER_OPTIONS: Array<{
  value: ProfilePeerDefault
  label: string
  description: string
}> = [
  {
    value: 'inherit_team_policy',
    label: 'Inherit teamPolicy',
    description: 'Keep peer edges created by the selected teamPolicy preset.',
  },
  {
    value: 'allow_all',
    label: 'Allow all peers',
    description: 'Add inbound and outbound edges to every current member.',
  },
  {
    value: 'deny_all',
    label: 'Deny all peers',
    description: 'Remove every peer edge incident to this profile slot.',
  },
]

export function ProfileCommunicationEditor({
  value,
  onChange,
  compact = false,
}: ProfileCommunicationEditorProps) {
  const set = <Key extends keyof ProfileCommunicationDefaults>(
    key: Key,
    next: ProfileCommunicationDefaults[Key],
  ) => onChange({ ...value, [key]: next })

  const gates: Array<{
    key: keyof Pick<
      ProfileCommunicationDefaults,
      'userInput' | 'userOutput' | 'outsideTeamInput' | 'outsideTeamOutput'
    >
    label: string
    detail: string
    icon: typeof UserRound
  }> = [
    {
      key: 'userInput',
      label: 'User input',
      detail: 'Humans may send directly through web, CLI, or Telegram.',
      icon: ArrowDownToLine,
    },
    {
      key: 'userOutput',
      label: 'User output',
      detail: 'Replies and proactive notifications may reach a human.',
      icon: ArrowUpFromLine,
    },
    {
      key: 'outsideTeamInput',
      label: 'Other-team input',
      detail: 'Agents in other local teams may send to this agent.',
      icon: UserRound,
    },
    {
      key: 'outsideTeamOutput',
      label: 'Other-team output',
      detail: 'This agent may send to agents in other local teams.',
      icon: Network,
    },
  ]

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className={compact ? 'space-y-1' : 'grid gap-2 sm:grid-cols-2'}>
        {gates.map((gate) => {
          const Icon = gate.icon
          return (
            <label
              key={gate.key}
              className="m-0 flex cursor-pointer items-start gap-3 rounded-md border border-frost bg-ivory px-3 py-2.5 transition-colors hover:border-sapphire-light"
            >
              <input
                type="checkbox"
                checked={value[gate.key]}
                onChange={(event) => set(gate.key, event.target.checked)}
                className="mt-1"
              />
              <Icon className="mt-0.5 h-4 w-4 flex-none text-sapphire" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-chocolate">{gate.label}</span>
                {!compact && (
                  <span className="block text-xs leading-5 text-mocha-light">{gate.detail}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>

      <label className="m-0 block">
        <span className="mb-1 block text-sm font-semibold text-chocolate">Peer posture</span>
        <select
          value={value.peerDefault}
          onChange={(event) => set('peerDefault', event.target.value as ProfilePeerDefault)}
        >
          {PEER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {!compact && (
          <span className="mt-1 block text-xs leading-5 text-mocha-light">
            {PEER_OPTIONS.find((option) => option.value === value.peerDefault)?.description}
          </span>
        )}
      </label>
    </div>
  )
}
