import type { TelegramHealth, TelegramPollingState } from '@bazilion/api-types'
import { ListChecks } from 'lucide-react'
import { ago } from '../../../lib/model-facts'
import { preflightChecks, preflightHint, preflightState } from '../../../lib/telegram-setup'
import { Button } from '../../Button'
import {
  CardBody,
  CardRow,
  CheckItem,
  CheckList,
  Fact,
  Facts,
  Notice,
  SetupCard,
  Waiting,
} from '../../ui/parts'
import { StateChip } from './parts'

/** What Telegram answers about the bot and its group, and how the running bot is doing. */
export function PreflightCard({
  configured,
  health,
  working,
  note,
  error,
  now,
  onRun,
  onRestart,
}: {
  configured: boolean
  /** The last preflight run on this page. */
  health: TelegramHealth | null
  /** What is being waited for. */
  working: 'check' | 'restart' | null
  /** What to know after a restart was asked for. */
  note: string | null
  /** Why the preflight or the restart could not be asked for. */
  error: string | null
  /** When `health` arrived: times are counted from it. */
  now: number
  onRun: () => void
  onRestart: () => void
}) {
  return (
    <SetupCard
      labelledBy="telegram-preflight"
      icon={<ListChecks className="size-5" />}
      title="Preflight checks"
      description="Asks Telegram whether the bot and its group are set up the way Bazilion needs."
      action={<StateChip state={preflightState(health)} />}
    >
      <CardBody>
        {configured ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={working !== null} onClick={onRun}>
              {working === 'check' ? 'Checking…' : 'Run preflight'}
            </Button>
            <Button variant="ghost" disabled={working !== null} onClick={onRestart}>
              {working === 'restart' ? 'Restarting…' : 'Restart bot'}
            </Button>
          </div>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">
            Save the bot’s credentials above first.
          </p>
        )}
        {working === 'check' && <Waiting>Asking Telegram…</Waiting>}
        {note && <Notice tone="neutral">{note}</Notice>}
        {error && (
          <Notice tone="warning" role="alert" title="That did not work.">
            {error}
          </Notice>
        )}
        {health?.error && (
          <Notice
            tone="warning"
            role="alert"
            title={
              <>
                Failed at <code>{health.error.step}</code>
              </>
            }
          >
            <p className="m-0">{health.error.message}</p>
            <p className="m-0 mt-1 text-muted-foreground">{preflightHint(health.error.step)}</p>
          </Notice>
        )}
        {health?.preflight && (
          <div role="status" aria-live="polite" aria-atomic="true" className="grid gap-3">
            <CheckList>
              {preflightChecks(health.preflight).map((check) => (
                <CheckItem key={check.label} ok={check.ok} label={check.label}>
                  {check.detail}
                </CheckItem>
              ))}
            </CheckList>
            <p className="m-0 text-sm text-muted-foreground">
              Group members: {health.preflight.memberCount ?? 'unknown'}. Everyone in the group can
              read the Agents’ replies.
            </p>
          </div>
        )}
        {health && !health.error && !health.preflight && (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            No preflight data.
          </p>
        )}
      </CardBody>
      {health?.polling && <PollingFacts polling={health.polling} now={now} />}
    </SetupCard>
  )
}

function PollingFacts({ polling, now }: { polling: TelegramPollingState; now: number }) {
  const moment = (at: number) => <time dateTime={new Date(at).toISOString()}>{ago(at, now)}</time>
  return (
    <>
      <CardRow className="bg-muted/50 py-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
        The running bot
      </CardRow>
      <Facts className="border-t-0">
        <Fact label="Polling" tone={polling.running ? 'success' : 'warning'}>
          {polling.running ? 'Running' : 'Stopped'}
        </Fact>
        <Fact label="Group setup" tone={polling.activated ? 'success' : 'warning'}>
          {polling.activated ? 'Activated' : 'Awaiting activation'}
        </Fact>
        {polling.startedAt !== null && <Fact label="Started">{moment(polling.startedAt)}</Fact>}
        {polling.lastSuccessfulPollAt !== null && (
          <Fact label="Last poll">{moment(polling.lastSuccessfulPollAt)}</Fact>
        )}
        {polling.lastUpdateId !== null && (
          <Fact label="Last update">
            <span className="font-mono text-[0.9em]">{polling.lastUpdateId}</span>
          </Fact>
        )}
        {polling.error && (
          <Fact label="Error" tone="warning">
            {polling.error}
          </Fact>
        )}
      </Facts>
    </>
  )
}
