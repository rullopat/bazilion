// The cards of the System page: whether the installation is in order, how Agents run commands,
// and a backup of everything.

import type { HealthReport, ServiceState } from '@bazilion/api-types'
import { Archive, Download, HeartPulse, SquareTerminal } from 'lucide-react'
import type { Tone } from '../../lib/model-facts'
import { CardBody, CardRow, Chip, Fact, Facts, Notice, SetupCard } from '../ui/parts'

const TONE: Record<ServiceState['tone'], Tone> = {
  on: 'success',
  warning: 'warning',
  off: 'neutral',
}

/** Whether the home, the database and what they hold are in order. */
export function HealthCard({ ok }: { ok: boolean }) {
  return (
    <SetupCard
      labelledBy="system-health"
      icon={<HeartPulse className="size-5" />}
      title="Health"
      description="The Bazilion home, its database and what they hold."
      action={<Chip tone={ok ? 'success' : 'warning'}>{ok ? 'Healthy' : 'Issues found'}</Chip>}
    >
      <CardBody>
        {ok ? (
          <p className="m-0 text-sm text-muted-foreground">
            Run <code>bazilion doctor</code> in a terminal for the full report.
          </p>
        ) : (
          <Notice tone="warning" title="Something in the installation is not as it should be.">
            Run <code>bazilion doctor</code> in a terminal: its report names what.
          </Notice>
        )}
      </CardBody>
    </SetupCard>
  )
}

/**
 * How Agents run commands. The sandbox and the approval apply the same way to every turn: chat,
 * Telegram, schedules and inbox.
 */
export function RuntimeCard({
  shell,
  state,
}: {
  shell: HealthReport['shellSecurity']
  /** What the Commands card under Tools says is in effect. */
  state?: ServiceState | null
}) {
  return (
    <SetupCard
      labelledBy="system-runtime"
      icon={<SquareTerminal className="size-5" />}
      title="Agent runtime"
      description="How Agents run commands in every kind of turn: chat, Telegram, schedules and inbox. Unattended turns deny dangerous commands by themselves."
      action={state && <Chip tone={TONE[state.tone]}>{state.label}</Chip>}
    >
      {shell.ok ? (
        <Facts>
          <Fact label="Sandbox">
            {shell.sandboxMode === 'docker'
              ? `Docker (${shell.sandboxImage}) — bash in a network-disabled container`
              : 'Off — bash and file tools run on the host, unisolated'}
          </Fact>
          {shell.docker && (
            <Fact label="Docker" tone={shell.docker.ready ? 'success' : 'warning'}>
              {shell.docker.ready ? 'Ready' : `Unavailable — ${shell.docker.reason}`}
            </Fact>
          )}
          {shell.docker?.remediation && <Fact label="Remediation">{shell.docker.remediation}</Fact>}
          <Fact label="Dangerous-command approval">
            {shell.approvalMode === 'dangerous'
              ? 'On — chat can allow once; unattended turns auto-deny'
              : 'Off'}
          </Fact>
        </Facts>
      ) : (
        <CardBody>
          <Notice tone="warning" role="alert" title="The command settings cannot be used.">
            {shell.error}
          </Notice>
        </CardBody>
      )}
      <CardRow className="bg-muted/50 py-3 text-sm text-muted-foreground">
        <span>
          These are set on the Commands card under{' '}
          <a href="/config/tools#tool-commands" className="font-semibold">
            Tools
          </a>
          .
        </span>
      </CardRow>
    </SetupCard>
  )
}

/** The same archive as `bazilion backup create`, saved by the browser straight from the daemon. */
export function BackupCard() {
  return (
    <SetupCard
      labelledBy="system-backup"
      icon={<Archive className="size-5" />}
      title="Backup"
      description="One archive of the Bazilion home: Agents, conversations, settings and credentials."
      action={
        <a href="/api/backup" download className="btn-primary no-underline">
          <Download className="size-4" aria-hidden="true" />
          Download backup
        </a>
      }
    >
      <CardBody>
        <Notice tone="warning">
          The archive is not encrypted and holds every stored credential. For an encrypted copy run{' '}
          <code>bazilion backup create --recipient &lt;age1…&gt;</code>.
        </Notice>
        <p className="m-0 text-sm text-muted-foreground">
          It is a tar.gz. Restore it with <code>bazilion backup restore</code> while the daemon is
          stopped.
        </p>
      </CardBody>
    </SetupCard>
  )
}
