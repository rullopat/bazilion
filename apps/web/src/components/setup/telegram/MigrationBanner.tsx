import { useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { Button } from '../../Button'
import { Banner } from '../../ui/parts'
import { TELEGRAM_PATH } from './parts'

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
