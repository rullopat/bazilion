// /config/telegram: the bot's credentials, the checks Telegram answers, owner pairing,
// Attention notifications and who else may use the bot.

import type {
  NotificationSettingsResponse,
  TelegramConfigState,
  TelegramHealth,
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ConfigPage } from '../../components/ConfigPage'
import { NotificationsCard } from '../../components/setup/NotificationsCard'
import { AllowedUsersCard } from '../../components/setup/telegram/AllowedUsersCard'
import { BotCard } from '../../components/setup/telegram/BotCard'
import { MigrationBanner } from '../../components/setup/telegram/MigrationBanner'
import { PairingCard } from '../../components/setup/telegram/PairingCard'
import { PreflightCard } from '../../components/setup/telegram/PreflightCard'
import { TELEGRAM_PATH } from '../../components/setup/telegram/parts'
import { api, errorMessage } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'
import { botState } from '../../lib/telegram-setup'
import { useResource } from '../../lib/use-resource'

const fetchTelegramConfig = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<TelegramConfigState>('/api/config/telegram'),
)

export const Route = createFileRoute('/config/telegram')({
  loader: () => fetchTelegramConfig(),
  component: TelegramPage,
})

function TelegramPage() {
  const stored = Route.useLoaderData()
  const router = useRouter()
  // They also say whether the bot is up, without asking Telegram.
  const notifications = useResource(
    (signal) => api<NotificationSettingsResponse>('/api/notifications', { signal }),
    [],
  )
  const [check, setCheck] = useState<{ health: TelegramHealth; at: number } | null>(null)
  const [working, setWorking] = useState<'check' | 'restart' | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Cards that hold what was typed start again from what is stored after a change.
  const [changes, setChanges] = useState(0)
  const [justSaved, setJustSaved] = useState(false)
  // Pairing or revoking the owner changes the allowed users, which that card loads for itself.
  const [ownerResets, setOwnerResets] = useState(0)

  async function runPreflight() {
    setWorking('check')
    setCheck(null)
    setNote(null)
    setError(null)
    try {
      const health = await api<TelegramHealth>(`${TELEGRAM_PATH}/health`)
      setCheck({ health, at: Date.now() })
      setRestarting(false)
      void notifications.reload()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setWorking(null)
    }
  }

  async function restartBot() {
    setWorking('restart')
    setCheck(null)
    setNote(null)
    setError(null)
    try {
      await api(`${TELEGRAM_PATH}/restart`, { method: 'POST' })
      // The restart finishes in the background; the next preflight shows how the bot is doing.
      setRestarting(true)
      setNote('Restarting. Run the preflight in a few seconds to see how the bot is doing.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setWorking(null)
    }
  }

  /** The credentials changed: what was known about the old bot no longer holds. */
  async function changed(now: { saved: boolean; restarting: boolean }) {
    await router.invalidate({ sync: true })
    setCheck(null)
    setNote(null)
    setError(null)
    setRestarting(now.restarting)
    setJustSaved(now.saved)
    setChanges((count) => count + 1)
    void notifications.reload()
  }

  return (
    <ConfigPage
      title="Telegram"
      description="Connect one forum-supergroup bot with one topic per Agent, so conversations stay reachable from your phone."
    >
      {stored.migratedChatId && (
        <MigrationBanner
          toChatId={stored.migratedChatId}
          onReconnected={() => changed({ saved: false, restarting: true })}
        />
      )}
      <BotCard
        key={`bot:${changes}`}
        stored={stored}
        state={botState({
          configured: stored.configured,
          restarting,
          health: check?.health ?? null,
          ready: notifications.data?.telegramReady,
        })}
        justSaved={justSaved}
        onSaved={() => changed({ saved: true, restarting: false })}
        onDisconnected={() => changed({ saved: false, restarting: false })}
      />
      <PreflightCard
        configured={stored.configured}
        health={check?.health ?? null}
        now={check?.at ?? 0}
        working={working}
        note={note}
        error={error}
        onRun={() => void runPreflight()}
        onRestart={() => void restartBot()}
      />
      {stored.configured && (
        <PairingCard
          key={`pairing:${changes}`}
          onOwnerChange={() => setOwnerResets((count) => count + 1)}
        />
      )}
      <NotificationsCard
        settings={notifications.data}
        error={notifications.error}
        onSaved={notifications.reload}
      />
      {stored.configured && <AllowedUsersCard key={`allowed:${changes}:${ownerResets}`} />}
    </ConfigPage>
  )
}
