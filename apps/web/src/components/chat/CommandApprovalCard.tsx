import type { CommandApproval } from '@bazilion/api-types'
import { Button } from '../Button'

const OUTCOME: Record<CommandApproval['status'], string> = {
  pending: 'Waiting for a decision.',
  allowed: 'Allowed once — the command may run for this tool call only.',
  denied: 'Denied — the command was not run.',
  auto_denied: 'Automatically denied — no interactive approval path was available.',
  expired: 'Expired — the command was not run.',
  cancelled: 'Cancelled — the command was not run.',
}

/** A risky shell command waiting for the user; Allow and Deny apply to this one call only. */
export function CommandApprovalCard({
  approval,
  busy = false,
  error,
  onDecision,
}: {
  approval: CommandApproval
  busy?: boolean
  error?: string
  onDecision?: (approval: CommandApproval, decision: 'allow' | 'deny') => void
}) {
  const pending = approval.status === 'pending'
  return (
    <section
      className="my-3 rounded-lg border border-danger/50 bg-danger/5 p-4 text-chocolate"
      aria-label="Shell command approval"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="m-0 text-[0.72em] font-semibold uppercase tracking-wider text-danger">
            Shell command approval
          </p>
          <h2 className="m-0 mt-1 font-body text-[0.95em] font-semibold">
            {pending ? 'A risky command is waiting for you' : 'Command decision recorded'}
          </h2>
        </div>
        <span className="rounded-full border border-danger/30 px-2 py-0.5 text-[0.75em] font-semibold uppercase tracking-wide text-danger">
          {approval.status.replaceAll('_', ' ')}
        </span>
      </div>

      <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-fawn bg-snow p-3 font-mono text-[0.82em] leading-[1.45] text-charcoal">
        {approval.command}
      </pre>

      <ul className="mt-3 space-y-1.5 pl-5 text-[0.84em] leading-[1.4] text-mocha">
        {approval.risks.map((risk) => (
          <li key={`${risk.code}:${risk.span.start}:${risk.span.end}`}>
            <span className="font-medium text-chocolate">{risk.message}</span>{' '}
            <code className="text-[0.9em]">{risk.code}</code>
          </li>
        ))}
      </ul>

      {pending ? (
        <>
          <p className="mt-3 text-[0.78em] text-mocha-light">
            This approval expires{' '}
            <time dateTime={new Date(approval.expiresAt).toISOString()}>
              {new Date(approval.expiresAt).toLocaleString()}
            </time>
            . Deny blocks only this command; Stop ends the whole turn.
          </p>
          {error && (
            <p
              role="alert"
              className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-[0.82em] text-danger"
            >
              {error}
            </p>
          )}
          {onDecision && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => onDecision(approval, 'deny')}
              >
                Deny
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => onDecision(approval, 'allow')}
              >
                Allow once
              </Button>
            </div>
          )}
        </>
      ) : (
        <p role="status" className="mt-3 text-[0.84em] font-medium text-mocha">
          {OUTCOME[approval.status]}
        </p>
      )}
    </section>
  )
}
