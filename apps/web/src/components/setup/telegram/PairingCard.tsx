import type { TelegramPairingChallenge, TelegramPairingStatus } from '@bazilion/api-types'
import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { pairingState } from '../../../lib/telegram-setup'
import { Button } from '../../Button'
import { ConfirmDialog } from '../../ConfirmDialog'
import { CardBody, Notice, SetupCard, Waiting } from '../../ui/parts'
import { StateChip, TELEGRAM_PATH } from './parts'

/** The one person the bot belongs to: paired with a code sent in the group. */
export function PairingCard({
  onOwnerChange,
}: {
  /** An owner was paired, or revoked with the allowed users: the list of them is out of date. */
  onOwnerChange: () => void
}) {
  const [status, setStatus] = useState<TelegramPairingStatus | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const path = `${TELEGRAM_PATH}/pairing`
  const load = async () => setStatus(await api<TelegramPairingStatus>(path))

  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded once, when the card appears.
  useEffect(() => {
    load().catch((cause) => setError(errorMessage(cause)))
  }, [])

  // The code is sent in Telegram, not here: while one waits, ask every few seconds whether it was.
  const waiting = status !== null && !status.paired && status.challengeActive
  // biome-ignore lint/correctness/useExhaustiveDependencies: restarted only when waiting starts or stops.
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => {
      api<TelegramPairingStatus>(path)
        .then((next) => {
          setStatus(next)
          if (next.paired) {
            setCode(null)
            onOwnerChange()
          }
        })
        .catch(() => {
          // The next tick tries again; the card keeps what it showed.
        })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [waiting])

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const createCode = () =>
    run(async () => {
      const challenge = await api<TelegramPairingChallenge>(`${path}/challenge`, { method: 'POST' })
      setCode(challenge.code)
      setStatus(challenge)
    })
  const cancelCode = () =>
    run(async () => {
      await api(`${path}/challenge`, { method: 'DELETE' })
      setCode(null)
      await load()
    })

  return (
    <SetupCard
      labelledBy="telegram-pairing"
      icon={<ShieldCheck className="size-5" />}
      title="Owner pairing"
      description={
        <>
          Telegram stays closed until one owner sends a short-lived code in the{' '}
          <code>⚙ bazilion</code> service topic.
        </>
      }
      action={<StateChip state={pairingState(status)} />}
    >
      <CardBody>
        {status === null && !error && <Waiting>Loading…</Waiting>}
        {status?.paired && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="m-0 min-w-0 flex-1 basis-64 text-sm text-foreground">
              The owner is paired
              {status.ownerUserId !== null && (
                <>
                  : Telegram user <span className="font-mono">{status.ownerUserId}</span>
                </>
              )}
              .
            </p>
            <Button variant="danger" disabled={busy} onClick={() => setConfirmReset(true)}>
              Reset owner
            </Button>
          </div>
        )}
        {status && !status.paired && (
          <>
            <p className="m-0 text-sm text-warning">
              Unpaired: nothing sent to the bot is accepted.
            </p>
            {code && (
              <Notice tone="neutral" title="Send this in the service topic">
                <code className="text-[0.95em]">/pair {code}</code>
                <p className="m-0 mt-1 text-muted-foreground">
                  The code is shown once and expires in ten minutes.
                </p>
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void createCode()}>
                {code || status.challengeActive
                  ? 'Generate a new pairing code'
                  : 'Generate pairing code'}
              </Button>
              {status.challengeActive && (
                <Button variant="ghost" disabled={busy} onClick={() => void cancelCode()}>
                  Cancel code
                </Button>
              )}
            </div>
          </>
        )}
        {error && (
          <Notice tone="warning" role="alert" title="That did not work.">
            {error}
          </Notice>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Revoke the paired Telegram owner?"
        description={
          <p className="m-0">
            This immediately revokes the current owner, removes everyone else from the allowed users
            and closes all Telegram ingress. No one can use the bot until a new one-time pairing
            code is generated and consumed.
          </p>
        }
        confirmLabel="Revoke owner and close ingress"
        onConfirm={async () => {
          await api(`${path}/reset`, { body: { confirm: true } })
          setCode(null)
          await load()
          onOwnerChange()
        }}
      />
    </SetupCard>
  )
}
