import type { TelegramAllowedUser } from '@bazilion/api-types'
import { Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { allowedName, allowedState, hasOwner } from '../../../lib/telegram-setup'
import { Button } from '../../Button'
import { ConfirmDialog } from '../../ConfirmDialog'
import { TextField } from '../../ui/form'
import {
  CardBody,
  CardForm,
  CardList,
  CardRow,
  ListRow,
  Notice,
  SetupCard,
  Waiting,
} from '../../ui/parts'
import { StateChip, TELEGRAM_PATH } from './parts'

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
