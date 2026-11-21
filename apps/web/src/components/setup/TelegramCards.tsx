// The cards of the Telegram page: the bot's credentials, what Telegram answers when it is asked
// about the bot and its group, who owns the bot and who else may use it.

import type {
  TelegramAllowedUser,
  TelegramConfigState,
  TelegramHealth,
  TelegramPairingChallenge,
  TelegramPairingStatus,
  TelegramPollingState,
} from '@bazilion/api-types'
import { Bot, ListChecks, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { ago } from '../../lib/model-facts'
import {
  allowedName,
  allowedState,
  type CardState,
  type CredentialsDraft,
  credentialsForm,
  hasOwner,
  hasToken,
  pairingState,
  preflightChecks,
  preflightHint,
  preflightState,
} from '../../lib/telegram-setup'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { Problem, SaveBar, SecretField, saveStatus, TextField } from './form'
import {
  Banner,
  CardBody,
  CardForm,
  CardList,
  CardRow,
  CheckItem,
  CheckList,
  Chip,
  Fact,
  Facts,
  ListRow,
  Notice,
  SetupCard,
  Waiting,
} from './parts'

export const TELEGRAM_PATH = '/api/config/telegram'

function StateChip({ state }: { state: CardState | null }) {
  return state && <Chip tone={state.tone}>{state.label}</Chip>
}

/** Telegram moved the group to a new id, and the bot still points at the old one. */
export function MigrationBanner({
  toChatId,
  onReconnected,
}: {
  toChatId: string
  onReconnected: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reconnect() {
    setBusy(true)
    setError(null)
    try {
      await api(`${TELEGRAM_PATH}/reconnect`, { method: 'POST' })
      await onReconnected()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2">
      <Banner
        tone="warning"
        lead={
          <>
            Telegram moved this group to a new chat id, <code>{toChatId}</code>.
          </>
        }
        action={
          <Button variant="primary" disabled={busy} onClick={() => void reconnect()}>
            {busy ? 'Reconnecting…' : 'Reconnect'}
          </Button>
        }
      >
        The bot still points at the old id. Reconnecting moves it over and creates the{' '}
        <code>⚙ bazilion</code> service topic again in the new group; each Agent’s topic follows
        when it is next used.
      </Banner>
      {error && (
        <Banner tone="warning" role="alert" lead="The bot was not reconnected.">
          {error}
        </Banner>
      )}
    </div>
  )
}

/** The bot's token and the group it works in, saved together. */
export function BotCard({
  stored,
  state,
  justSaved,
  onSaved,
  onDisconnected,
}: {
  stored: TelegramConfigState
  state: CardState | null
  /** The credentials were saved a moment ago. */
  justSaved: boolean
  /** Called after a save; resolves once the page has the new state. */
  onSaved: () => Promise<void>
  onDisconnected: () => Promise<void>
}) {
  // A saved token is never put back into the field: the row says that one is stored.
  const [draft, setDraft] = useState<CredentialsDraft>({ token: '', chatId: stored.chatId })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const form = credentialsForm(stored, draft)

  const edit = (change: Partial<CredentialsDraft>) => {
    setTouched(true)
    setError(null)
    setDraft((current) => ({ ...current, ...change }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!form.body || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(TELEGRAM_PATH, { method: 'PUT', body: form.body })
      await onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const status = form.incomplete
    ? ({
        text: 'The token and the group’s id are saved together: fill in both.',
        tone: 'warning',
      } as const)
    : saveStatus({
        error,
        dirty: form.dirty,
        saved: justSaved && !touched,
        savedText: 'Saved. The bot starts again with these credentials.',
        footnote: stored.configured
          ? 'A new token or group restarts the bot and starts pairing over: the owner and the allowed users are forgotten.'
          : 'Saving starts the bot.',
      })

  return (
    <SetupCard
      labelledBy="telegram-bot"
      icon={<Bot className="size-5" />}
      title="Bot"
      description="The bot your Agents speak through, and the forum supergroup it works in."
      action={<StateChip state={state} />}
    >
      <CardForm onSubmit={save}>
        <SecretField
          label="Bot token"
          saved={hasToken(stored)}
          preview={stored.botTokenPreview}
          value={draft.token}
          open={form.needsToken}
          disabled={busy}
          placeholder="1234567890:ABC…"
          hint={
            <>
              From @BotFather → /newbot. Disable Privacy Mode in{' '}
              <em>Bot Settings → Group Privacy → Turn off</em>.
            </>
          }
          notes={
            form.problems.token ? (
              <Problem>{form.problems.token}</Problem>
            ) : (
              form.needsToken && (
                <Problem>Type the bot token again: a new group is saved together with it.</Problem>
              )
            )
          }
          onChange={(token) => edit({ token })}
        />
        <TextField
          label="Supergroup chat ID"
          value={draft.chatId}
          disabled={busy}
          placeholder="-1001234567890"
          mono
          hint={
            <>
              Forum-enabled supergroup the bot is admin in (with <code>can_manage_topics</code>).
            </>
          }
          problem={form.problems.chatId}
          onChange={(chatId) => edit({ chatId })}
        />
        <SaveBar busy={busy} disabled={!form.body} status={status} />
      </CardForm>
      {stored.configured && (
        <CardRow className="py-3">
          <span className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
            Disconnecting removes the token and the group, and stops the bot.
          </span>
          <Button variant="danger" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
            Disconnect Telegram
          </Button>
        </CardRow>
      )}
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Telegram?"
        description={
          <p className="m-0">
            This permanently removes the saved bot token and supergroup ID. Telegram polling,
            ingress, and outbound delivery stop until new credentials are saved and pairing is
            completed again.
          </p>
        }
        confirmLabel="Disconnect Telegram"
        onConfirm={async () => {
          await api(TELEGRAM_PATH, { method: 'DELETE' })
          await onDisconnected()
        }}
      />
    </SetupCard>
  )
}

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
      <CardRow className="bg-muted/50 py-2 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
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

/** The one person the bot belongs to: paired with a code sent in the group. */
export function PairingCard({
  onReset,
}: {
  /** The owner was revoked, and the allowed users went with them. */
  onReset: () => void
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
          onReset()
        }}
      />
    </SetupCard>
  )
}

/** The Telegram users who may use the bot besides its owner. */
export function AllowedUsersCard() {
  const [users, setUsers] = useState<TelegramAllowedUser[] | null>(null)
  const [userId, setUserId] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<TelegramAllowedUser | null>(null)
  const path = `${TELEGRAM_PATH}/acl`
  const load = async () => setUsers(await api<TelegramAllowedUser[]>(path))

  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded once, when the card appears.
  useEffect(() => {
    load().catch((cause) => setError(errorMessage(cause)))
  }, [])

  const id = userId.trim()
  const idProblem =
    id !== '' && !/^\d+$/.test(id) ? 'A Telegram user id is a number, like 123456789.' : undefined

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (id === '' || idProblem || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(path, { body: { userId: Number(id), label: label.trim() || null } })
      setUserId('')
      setLabel('')
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SetupCard
      labelledBy="telegram-allowed"
      icon={<Users className="size-5" />}
      title="Allowed users"
      description={
        <>
          The Telegram users who can use the bot, for commands and chat. Anyone finds their id by
          sending <code>/whoami</code>.
        </>
      }
      action={<StateChip state={allowedState(users)} />}
    >
      {users === null && !error && (
        <CardRow className="py-4">
          <Waiting>Loading…</Waiting>
        </CardRow>
      )}
      {users && !hasOwner(users) && (
        <CardRow className="py-4 text-sm text-muted-foreground">
          Closed: the bot has no owner yet. Others can be added once the owner is paired above.
        </CardRow>
      )}
      {users && users.length > 0 && (
        <CardList>
          {users.map((user) => {
            const name = allowedName(user)
            return (
              <ListRow
                key={user.userId}
                title={name}
                meta={
                  <>
                    <span>{user.role === 'owner' ? 'Owner' : 'Member'}</span>
                    {name !== String(user.userId) && <code>{user.userId}</code>}
                  </>
                }
                actions={
                  user.role !== 'owner' && (
                    <Button
                      variant="danger"
                      disabled={busy}
                      aria-label={`Remove ${name}`}
                      onClick={() => setRemoving(user)}
                    >
                      Remove
                    </Button>
                  )
                }
              />
            )
          })}
        </CardList>
      )}
      {users && hasOwner(users) && (
        <CardForm onSubmit={add}>
          <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,18rem)]">
            <TextField
              label="Telegram user ID"
              value={userId}
              disabled={busy}
              placeholder="123456789"
              mono
              inputMode="numeric"
              problem={idProblem}
              onChange={setUserId}
            />
            <TextField
              label="Label (optional)"
              value={label}
              disabled={busy}
              placeholder="e.g. Pat"
              onChange={setLabel}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              variant="primary"
              type="submit"
              disabled={busy || id === '' || idProblem !== undefined}
            >
              {busy ? 'Adding…' : 'Add user'}
            </Button>
          </div>
        </CardForm>
      )}
      {error && (
        <CardBody>
          <Notice tone="warning" role="alert" title="That did not work.">
            {error}
          </Notice>
        </CardBody>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${removing ? allowedName(removing) : ''}?`}
        description={
          <p className="m-0">
            Telegram user <code>{removing?.userId}</code> immediately loses command and chat access.
            Their Telegram account is not changed, and they can be allowed again later.
          </p>
        }
        confirmLabel="Remove Telegram access"
        onConfirm={async () => {
          if (!removing) return
          await api(`${path}/${removing.userId}`, { method: 'DELETE' })
          await load()
        }}
      />
    </SetupCard>
  )
}
