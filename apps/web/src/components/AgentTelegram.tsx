import type { Agent, TelegramBindResponse, TelegramMirrorMode } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'

/** An Agent's Telegram forum topic: bind, open, unbind, mirroring and the topic icon. */
export function AgentTelegram({ agent }: { agent: Agent }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mirrorMode, setMirrorMode] = useState<TelegramMirrorMode>(agent.telegramMirrorMode)
  const [iconEmoji, setIconEmoji] = useState(agent.telegramIconEmoji ?? '')
  const [confirmUnbind, setConfirmUnbind] = useState(false)
  const path = `/api/agents/${encodeURIComponent(agent.id)}`
  const bound = agent.telegramTopicId !== null

  async function run(request: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await request()
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  async function bind() {
    await run(async () => {
      const { deepLink } = await api<TelegramBindResponse>(`${path}/telegram/bind`, {
        method: 'POST',
      })
      // Opens the topic in Telegram desktop and Android; iOS shows the topic list.
      window.open(deepLink, '_blank', 'noopener')
    }).catch(() => {})
  }

  async function saveMirrorMode(next: TelegramMirrorMode) {
    setMirrorMode(next)
    await run(() => api(path, { method: 'PATCH', body: { telegramMirrorMode: next } })).catch(() =>
      setMirrorMode(agent.telegramMirrorMode),
    )
  }

  return (
    <>
      <div className="text-[0.9em]">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {bound ? (
            <>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                bound
              </span>
              <span className="font-mono text-mocha">topic #{agent.telegramTopicId}</span>
              <Button variant="ghost" onClick={() => void bind()} disabled={busy}>
                Open in Telegram
              </Button>
              <Button variant="danger" onClick={() => setConfirmUnbind(true)} disabled={busy}>
                Unbind
              </Button>
            </>
          ) : (
            <>
              <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                unbound
              </span>
              <Button variant="ghost" onClick={() => void bind()} disabled={busy}>
                {busy ? 'Binding…' : 'Bind a topic'}
              </Button>
            </>
          )}
        </div>

        <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-mocha-light">Mirror mode</span>
          <select
            value={mirrorMode}
            onChange={(event) => void saveMirrorMode(event.target.value as TelegramMirrorMode)}
            className="sm:max-w-sm"
            disabled={busy}
          >
            <option value="minimal">minimal — assistant messages only</option>
            <option value="verbose">verbose — also tool calls</option>
          </select>
        </label>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="m-0">
            Topic icon
            <input
              value={iconEmoji}
              onChange={(event) => setIconEmoji(event.target.value)}
              placeholder="(template default)"
              maxLength={8}
              className="w-40 font-mono"
              disabled={busy}
            />
          </label>
          <Button
            variant="ghost"
            onClick={() =>
              void run(() =>
                api(path, {
                  method: 'PATCH',
                  body: { telegramIconEmoji: iconEmoji.trim() || null },
                }),
              ).catch(() => {})
            }
            disabled={busy || iconEmoji === (agent.telegramIconEmoji ?? '')}
          >
            Save icon
          </Button>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}

        <p className="mt-3 text-[0.85em] text-mocha-light">
          While bound, every assistant turn of this Agent is mirrored to the topic, and a message in
          the topic starts a turn. On iOS, Telegram opens the topic list instead of the topic.
        </p>
      </div>
      <ConfirmDialog
        open={confirmUnbind}
        onOpenChange={setConfirmUnbind}
        title={`Unbind ${agent.name} from Telegram?`}
        description={
          <p>
            Telegram ingress and mirroring stop for this Agent. The forum topic stays in Telegram
            until you remove it there.
          </p>
        }
        confirmLabel="Unbind Telegram topic"
        onConfirm={() => run(() => api(`${path}/telegram/binding`, { method: 'DELETE' }))}
      />
    </>
  )
}
