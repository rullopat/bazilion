import type { CommandApproval } from '@bazilion/api-types'
import { useState } from 'react'
import { Button } from '../Button'
import { TextField } from '../ui/form'

/** What the review model said, in a line the owner reads. */
function reviewLine(approval: CommandApproval): string | null {
  const review = approval.review
  if (!review) return null
  const verdict =
    review.decision === 'allow'
      ? 'allowed it'
      : review.decision === 'deny'
        ? 'refused it'
        : 'passed it on to you'
  return `The review model (${review.model}) ${verdict}: ${review.reason}`
}

const OUTCOME: Record<CommandApproval['status'], string> = {
  pending: 'Waiting for a decision.',
  allowed: 'Allowed once — the command may run for this tool call only.',
  denied: 'Denied — the command was not run.',
  auto_denied: 'Automatically denied — no interactive approval path was available.',
  expired: 'Expired — the command was not run.',
  cancelled: 'Cancelled — the command was not run.',
}

const TOOL_OUTCOME: Record<CommandApproval['status'], string> = {
  pending: 'Waiting for a decision.',
  allowed: 'Allowed once — for this call only.',
  denied: 'Denied — nothing was sent.',
  auto_denied: 'Denied — nobody could approve it in this turn, so nothing was sent.',
  expired: 'Expired — nothing was sent.',
  cancelled: 'Cancelled — nothing was sent.',
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
  onDecision?: (
    approval: CommandApproval,
    decision: 'allow' | 'deny',
    remember?: { prefix: string },
  ) => void
}) {
  const pending = approval.status === 'pending'
  // Always for this Agent: the beginning of commands it may run from now on, editable first.
  const [remembering, setRemembering] = useState(false)
  const [prefix, setPrefix] = useState(approval.suggestedRule ?? '')
  const review = reviewLine(approval)
  return (
    <section
      className="my-3 rounded-lg border border-danger/50 bg-danger/5 p-4 text-chocolate"
      aria-label={approval.tool ? 'Approval before it goes out' : 'Shell command approval'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="m-0 text-[0.72em] font-semibold uppercase tracking-wider text-danger">
            {approval.tool ? 'Before it goes out' : 'Shell command approval'}
          </p>
          <h2 className="m-0 mt-1 font-body text-[0.95em] font-semibold">
            {approval.tool
              ? pending
                ? `It wants to use ${approval.tool}`
                : 'Decision recorded'
              : pending
                ? 'A risky command is waiting for you'
                : 'Command decision recorded'}
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

      {review && <p className="mt-3 text-[0.84em] leading-[1.4] text-mocha">{review}</p>}

      {pending ? (
        <>
          <p className="mt-3 text-[0.78em] text-mocha-light">
            This approval expires{' '}
            <time dateTime={new Date(approval.expiresAt).toISOString()}>
              {new Date(approval.expiresAt).toLocaleString()}
            </time>
            . Deny blocks only this {approval.tool ? 'call' : 'command'}; Stop ends the whole turn.
          </p>
          {error && (
            <p
              role="alert"
              className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-[0.82em] text-danger"
            >
              {error}
            </p>
          )}
          {onDecision && !remembering && (
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
              {approval.suggestedRule && (
                <Button variant="ghost" disabled={busy} onClick={() => setRemembering(true)}>
                  Always for this Agent…
                </Button>
              )}
            </div>
          )}
          {onDecision && remembering && (
            <form
              className="mt-3 grid gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                onDecision(approval, 'allow', { prefix })
              }}
            >
              <TextField
                label="Allow commands that start with"
                value={prefix}
                onChange={setPrefix}
                mono
                hint="Whole words, from the start. It applies to single commands only: one joined to another with ; && | or a redirect still asks. You can remove it under Setup → Tools."
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" type="submit" disabled={busy || !prefix.trim()}>
                  Allow and remember
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setRemembering(false)}>
                  Back
                </Button>
              </div>
            </form>
          )}
        </>
      ) : (
        <p role="status" className="mt-3 text-[0.84em] font-medium text-mocha">
          {approval.tool ? TOOL_OUTCOME[approval.status] : OUTCOME[approval.status]}
        </p>
      )}
    </section>
  )
}
