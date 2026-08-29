import { Check, Minus, X } from 'lucide-react'
import {
  OUTSIDE_GROUP_ENDPOINT,
  USER_ENDPOINT,
  endpointForMember,
  endpointKey,
  hasTeamPolicyEdge,
  isValidTeamPolicyConnection,
  type TeamPolicyDocument,
  type TeamPolicyEndpoint,
} from '../../lib/team-policy'
import { teamPolicyEndpointLabel } from '../../lib/team-policy-presenter'

interface TeamPolicyMatrixProps {
  teamPolicy: TeamPolicyDocument
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggle: (source: TeamPolicyEndpoint, target: TeamPolicyEndpoint, allowed: boolean) => void
}

export function TeamPolicyMatrix({
  teamPolicy,
  selectedId,
  onSelect,
  onToggle,
}: TeamPolicyMatrixProps) {
  const actors: TeamPolicyEndpoint[] = [
    USER_ENDPOINT,
    ...teamPolicy.members.map((member) => endpointForMember(teamPolicy, member)),
    OUTSIDE_GROUP_ENDPOINT,
  ]

  return (
    <div className="h-full min-h-[420px] overflow-auto bg-ivory p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="m-0 font-body text-base font-semibold text-chocolate">Communication matrix</h2>
        <p className="mt-1 text-xs text-mocha-light">
          Rows send; columns receive. Every cell edits the same directed edge set as Flow.
        </p>
      </div>
      <table className="m-0 min-w-[720px] table-fixed overflow-visible rounded-md text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 w-40 bg-ivory">source / target</th>
            {actors.map((target) => (
              <th
                key={endpointKey(target)}
                className="w-24 max-w-24 text-center normal-case tracking-normal"
              >
                <button
                  type="button"
                  onClick={() => onSelect(endpointKey(target))}
                  className={`w-full truncate rounded-sm px-1 py-1 hover:bg-sapphire-glow ${
                    selectedId === endpointKey(target) ? 'text-sapphire' : 'text-mocha'
                  }`}
                  title={teamPolicyEndpointLabel(teamPolicy, target)}
                >
                  {teamPolicyEndpointLabel(teamPolicy, target)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {actors.map((source) => (
            <tr key={endpointKey(source)}>
              <th className="sticky left-0 z-10 max-w-40 bg-snow normal-case tracking-normal">
                <button
                  type="button"
                  onClick={() => onSelect(endpointKey(source))}
                  className={`w-full truncate rounded-sm px-1 py-1 text-left hover:bg-sapphire-glow ${
                    selectedId === endpointKey(source) ? 'text-sapphire' : 'text-mocha'
                  }`}
                  title={teamPolicyEndpointLabel(teamPolicy, source)}
                >
                  {teamPolicyEndpointLabel(teamPolicy, source)}
                </button>
              </th>
              {actors.map((target) => {
                const valid = isValidTeamPolicyConnection(source, target)
                const allowed = valid && hasTeamPolicyEdge(teamPolicy.policy, source, target)
                const label = `${teamPolicyEndpointLabel(teamPolicy, source)} to ${teamPolicyEndpointLabel(teamPolicy, target)}`
                return (
                  <td key={endpointKey(target)} className="h-14 p-1 text-center">
                    {valid ? (
                      <button
                        type="button"
                        onClick={() => onToggle(source, target, !allowed)}
                        aria-pressed={allowed}
                        aria-label={`${allowed ? 'Deny' : 'Allow'} ${label}`}
                        title={`${allowed ? 'Allowed' : 'Denied'}: ${label}`}
                        className={`mx-auto flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                          allowed
                            ? 'border-sapphire bg-sapphire text-snow hover:bg-sapphire-deep'
                            : 'border-frost bg-ivory text-mocha-light hover:border-rose-baziu hover:text-rose-baziu'
                        }`}
                      >
                        {allowed ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                      </button>
                    ) : (
                      <span
                        className="mx-auto flex h-9 w-9 items-center justify-center text-mocha-light"
                        title="Not a valid communication path"
                      >
                        <Minus className="h-4 w-4" />
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
