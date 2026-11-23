import type { TelegramConfigState } from '@bazilion/api-types'
import { Bot } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import {
  type CardState,
  type CredentialsDraft,
  credentialsForm,
  hasToken,
} from '../../../lib/telegram-setup'
import { Button } from '../../Button'
import { ConfirmDialog } from '../../ConfirmDialog'
import { Problem, SaveBar, SecretField, saveStatus, TextField } from '../../ui/form'
import { CardForm, CardRow, SetupCard } from '../../ui/parts'
import { StateChip, TELEGRAM_PATH } from './parts'

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
        savedText:
          'Saved. A new token or group restarts the bot: run the preflight in a few seconds.',
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
          open={form.tokenOpen}
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
