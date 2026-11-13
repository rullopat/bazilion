import { Check, Minus, X } from 'lucide-react'
import { endpointLabel, hasEdge, OUTSIDE, type PolicyDocument } from '../../lib/team-policy'

interface TeamPolicyMatrixProps {
  document: PolicyDocument
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggle: (from: string, to: string, allowed: boolean) => void
}

export function TeamPolicyMatrix({
  document,
  selectedId,
  onSelect,
  onToggle,
}: TeamPolicyMatrixProps) {
  const actors = [...document.members.map((member) => member.key), OUTSIDE]

  return (
    <div className="h-full min-h-[420px] overflow-auto bg-ivory p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="m-0 font-body text-base font-semibold text-chocolate">
          Communication matrix
        </h2>
        <p className="mt-1 text-xs text-mocha-light">
          Rows send; columns receive. Every cell edits the same allow edges as Flow.
        </p>
      </div>
      <table className="m-0 min-w-[620px] table-fixed overflow-visible rounded-md text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 w-40 bg-ivory">from / to</th>
            {actors.map((target) => (
              <th key={target} className="w-24 max-w-24 text-center normal-case tracking-normal">
                <button
                  type="button"
                  onClick={() => onSelect(target)}
                  className={`w-full truncate rounded-sm px-1 py-1 hover:bg-sapphire-glow ${
                    selectedId === target ? 'text-sapphire' : 'text-mocha'
                  }`}
                  title={endpointLabel(document, target)}
                >
                  {endpointLabel(document, target)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {actors.map((source) => (
            <tr key={source}>
              <th className="sticky left-0 z-10 max-w-40 bg-snow normal-case tracking-normal">
                <button
                  type="button"
                  onClick={() => onSelect(source)}
                  className={`w-full truncate rounded-sm px-1 py-1 text-left hover:bg-sapphire-glow ${
                    selectedId === source ? 'text-sapphire' : 'text-mocha'
                  }`}
                  title={endpointLabel(document, source)}
                >
                  {endpointLabel(document, source)}
                </button>
              </th>
              {actors.map((target) => {
                const allowed = hasEdge(document, source, target)
                const label = `${endpointLabel(document, source)} to ${endpointLabel(document, target)}`
                return (
                  <td key={target} className="h-14 p-1 text-center">
                    {source !== target ? (
                      <button
                        type="button"
                        onClick={() => onToggle(source, target, !allowed)}
                        aria-pressed={allowed}
                        aria-label={`${allowed ? 'Deny' : 'Allow'} ${label}`}
                        title={`${allowed ? 'Allowed' : 'Not allowed'}: ${label}`}
                        className={`mx-auto flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                          allowed
                            ? 'border-sapphire bg-sapphire text-snow hover:bg-sapphire-deep'
                            : 'border-frost bg-ivory text-mocha-light hover:border-rose-baziu hover:text-rose-baziu'
                        }`}
                      >
                        {allowed ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                      </button>
                    ) : (
                      <span className="mx-auto flex h-9 w-9 items-center justify-center text-mocha-light">
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
