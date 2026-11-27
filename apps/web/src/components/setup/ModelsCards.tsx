import type {
  ChatModelEntry,
  ImageRouteEntry,
  MediaRouteEntry,
  ModelsResponse,
  ProviderConfigEntry,
  SetProviderModelsResponse,
  SpeakRequest,
  SpeechVoicesResponse,
} from '@bazilion/api-types'
import {
  AudioLines,
  ChevronRight,
  Clapperboard,
  Images,
  MessageSquare,
  Music,
  Plug,
  Plus,
  ShieldCheck,
  Speech,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { api, apiFetch, errorMessage } from '../../lib/api'
import {
  credentialLine,
  factsLine,
  modelName,
  priceLine,
  providerStatus,
  usedByLine,
  windowLine,
} from '../../lib/model-facts'
import { useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { SelectField } from '../ui/form'
import { Banner, CardBody, Chip, CARD_ROW as ROW, SetupCard } from '../ui/parts'
import { ModelWindowDialog } from './ModelWindowDialog'
import { ProviderAvatar, StateChip } from './provider-parts'

/** The line above the cards: whether everything Agents rely on answers, and what does not. */
export function StatusLine({
  providers,
  chat,
  now,
  onOpen,
  onTestAll,
  testing,
}: {
  /** The providers on the page. */
  providers: ProviderConfigEntry[]
  chat: ChatModelEntry[]
  now: number
  onOpen: (id: string) => void
  onTestAll: () => void
  testing: boolean
}) {
  const on = providers.filter((provider) => provider.enabled)
  if (on.length === 0) return null
  const broken = on.filter(
    (provider) => provider.state === 'failing' || provider.state === 'incomplete',
  )
  const untested = on.filter(
    (provider) => provider.state === 'untested' && provider.models.length > 0,
  )

  if (broken.length > 0) {
    return (
      <div className="grid gap-2">
        {broken.map((provider) => {
          const models = chat.filter((model) => model.provider === provider.id)
          const agents = models.reduce((sum, model) => sum + model.usedBy.agents, 0)
          return (
            <Banner
              key={provider.id}
              tone="warning"
              lead={
                <>
                  {provider.check?.failure?.title ??
                    `${provider.displayName}: ${providerStatus(provider, now).label.toLowerCase()}`}
                  .
                </>
              }
              action={
                <Button variant="ghost" onClick={() => onOpen(provider.id)}>
                  Open {provider.displayName}
                </Button>
              }
            >
              {models.length === 0
                ? 'No chat model runs on it.'
                : `${models.length === 1 ? '1 chat model runs' : `${models.length} chat models run`} on it${
                    agents === 0 ? '' : `, used by ${agents === 1 ? '1 Agent' : `${agents} Agents`}`
                  }.`}
            </Banner>
          )
        })}
      </div>
    )
  }
  if (untested.length > 0) {
    return (
      <Banner
        tone="neutral"
        lead={
          untested.length === 1
            ? `${untested[0]?.displayName} has not been tested.`
            : `${untested.length} providers have not been tested.`
        }
        action={
          <Button variant="ghost" disabled={testing} onClick={onTestAll}>
            {testing ? 'Testing…' : untested.length === 1 ? 'Test it' : 'Test them'}
          </Button>
        }
      >
        A test sends one short message to the cheapest model of each.
      </Banner>
    )
  }
  const working = on.filter((provider) => provider.state === 'working')
  if (working.length === 0) return null
  return (
    <Banner
      tone="success"
      lead={working.length === 1 ? 'Your provider answers.' : 'Every provider answers.'}
      action={
        <Button variant="ghost" disabled={testing} onClick={onTestAll}>
          {testing ? 'Testing…' : 'Test again'}
        </Button>
      }
    >
      {chat.length === 1 ? '1 chat model' : `${chat.length} chat models`} for your Agents.
    </Banner>
  )
}

/** Chat: the models Agents think with, each with what it can do, its price and who uses it. */
export function ChatModelsCard({
  chat,
  hasProviders,
  onPick,
  onChanged,
}: {
  chat: ChatModelEntry[]
  hasProviders: boolean
  onPick: () => void
  onChanged: () => Promise<void>
}) {
  const [removing, setRemoving] = useState<ChatModelEntry | null>(null)
  const [sizing, setSizing] = useState<ChatModelEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function remove(model: ChatModelEntry) {
    const models = chat
      .filter((entry) => entry.provider === model.provider && entry.id !== model.id)
      .map((entry) => entry.id)
    await api<SetProviderModelsResponse>(
      `/api/config/providers/${encodeURIComponent(model.provider)}/models`,
      { method: 'PUT', body: { models } },
    )
    await onChanged()
  }
  function askToRemove(model: ChatModelEntry) {
    setError(null)
    // A model nobody runs on leaves at once; one in use is asked about first.
    if (model.usedBy.agents > 0 || model.usedBy.templates.length > 0) setRemoving(model)
    else remove(model).catch((cause) => setError(errorMessage(cause)))
  }

  return (
    <SetupCard
      labelledBy="setup-chat"
      icon={<MessageSquare className="size-5" />}
      title="Chat"
      description="The models Agents think with. Each Agent and each template uses one of them."
      action={
        <Button variant="primary" disabled={!hasProviders} onClick={onPick}>
          <Plus className="size-4" aria-hidden="true" />
          Add models
        </Button>
      }
    >
      {chat.length > 0 && (
        <div
          aria-hidden="true"
          className={`${ROW} hidden bg-muted/50 py-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground lg:flex`}
        >
          <span className="min-w-0 flex-[2.2] basis-52">Model</span>
          <span className="w-28 shrink-0">Provider</span>
          <span className="min-w-0 flex-[2] basis-48">Can do</span>
          <span className="w-40 shrink-0">Price per 1M tokens</span>
          <span className="min-w-0 flex-[1.4] basis-36">Used by</span>
          <span className="w-8 shrink-0" />
        </div>
      )}
      {chat.map((model) => {
        const down = model.providerState === 'failing' || model.providerState === 'incomplete'
        const window = windowLine(model.window)
        return (
          <div key={model.value} className={`${ROW} min-h-16 py-2.5`}>
            <div className="min-w-0 flex-[2.2] basis-52">
              <div className="text-base font-semibold text-foreground">{modelName(model)}</div>
              {model.name && (
                <div className="break-all font-mono text-xs text-muted-foreground">{model.id}</div>
              )}
            </div>
            <div className="w-28 shrink-0 text-sm">{model.providerName}</div>
            <div
              className={`flex min-w-0 flex-[2] basis-48 flex-wrap items-center gap-x-2 gap-y-1 text-sm ${down || window?.missing ? 'font-semibold text-warning' : 'text-muted-foreground'}`}
            >
              <span>
                {down
                  ? `${model.providerName} is not working`
                  : (window?.text ?? factsLine(model, model.providerConnect))}
              </span>
              {model.window.settable && (
                <Button
                  variant="ghost"
                  className="min-h-8 px-3 py-1 text-xs"
                  aria-label={`${model.window.set ? 'Change' : 'Set'} the context window of ${modelName(model)}`}
                  onClick={() => setSizing(model)}
                >
                  {model.window.set ? 'Change' : 'Set'}
                </Button>
              )}
            </div>
            <div className="w-40 shrink-0 text-sm">{priceLine(model, model.providerConnect)}</div>
            <div className="min-w-0 flex-[1.4] basis-36 text-sm text-muted-foreground">
              {usedByLine(model.usedBy)}
            </div>
            <button
              type="button"
              aria-label={`Remove ${modelName(model)} from Chat`}
              onClick={() => askToRemove(model)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-danger"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )
      })}
      {chat.length === 0 && (
        <div className={`${ROW} py-5 text-sm text-muted-foreground`}>
          {hasProviders
            ? 'No chat model yet. Agents cannot answer until one is added.'
            : 'No chat model yet. Add a provider below, and its models appear here.'}
        </div>
      )}
      {error && (
        <div role="alert" className={`${ROW} py-3 text-sm text-danger`}>
          {error}
        </div>
      )}
      <ModelWindowDialog model={sizing} onClose={() => setSizing(null)} onSaved={onChanged} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove ${removing ? modelName(removing) : ''} from Chat?`}
        description={
          removing && (
            <p className="m-0">
              It is used by {usedByLine(removing.usedBy)}.{' '}
              {removing.usedBy.agents > 0 &&
                'Those Agents are refused until you give them another model in their Agent tab. '}
              {removing.usedBy.templates.length > 0 &&
                'An Agent template on it moves to another model by itself.'}
            </p>
          )
        }
        confirmLabel="Remove from Chat"
        onConfirm={async () => {
          if (removing) await remove(removing)
        }}
      />
    </SetupCard>
  )
}

/** Images: one model draws for every Agent, through one provider's account, or nothing does. */
export function ImagesCard({
  images,
  onConnect,
  onChanged,
}: {
  images: ModelsResponse['images']
  /** Connect the provider a route needs. */
  onConnect: (providerId: string) => void
  onChanged: () => Promise<void>
}) {
  return (
    <RouteCard
      field="BAZILION_IMAGE_MODEL"
      labelledBy="setup-images"
      icon={<Images className="size-5" />}
      title="Images"
      description="What Agents draw with. One model for every Agent, up to four images a turn."
      offText="Agents have no image tool"
      unknown="an image route"
      choice={images}
      onConnect={onConnect}
      onChanged={onChanged}
    />
  )
}

/**
 * Transcription: one speech-to-text model turns voice notes and audio you send into words before
 * the turn, or the Agent gets the file alone.
 */
export function TranscriptionCard({
  transcription,
  onConnect,
  onChanged,
}: {
  transcription: ModelsResponse['transcription']
  onConnect: (providerId: string) => void
  onChanged: () => Promise<void>
}) {
  return (
    <RouteCard
      field="BAZILION_TRANSCRIPTION_MODEL"
      labelledBy="setup-transcription"
      icon={<AudioLines className="size-5" />}
      title="Transcription"
      description="What turns speech into words: voice notes and audio you send (before the turn), dictation in the chat, and recordings an Agent transcribes."
      offText="Voice notes are not transcribed and there is no dictation: Agents get the file"
      unknown="a transcription route"
      choice={transcription}
      onConnect={onConnect}
      onChanged={onChanged}
    />
  )
}

/** Videos: one model makes short clips with sound for every Agent, or none does (BAZ-095). */
export function VideoCard({
  video,
  onConnect,
  onChanged,
}: {
  video: ModelsResponse['video']
  onConnect: (providerId: string) => void
  onChanged: () => Promise<void>
}) {
  return (
    <RouteCard
      field="BAZILION_VIDEO_MODEL"
      labelledBy="setup-video"
      icon={<Clapperboard className="size-5" />}
      title="Video"
      description="What Agents make short videos with, from a prompt or a picture. They run in the background."
      offText="Agents have no video tool"
      unknown="a video route"
      choice={video}
      onConnect={onConnect}
      onChanged={onChanged}
    />
  )
}

/** Music and sound: one model makes songs, background music and sound effects (BAZ-095). */
export function AudioCard({
  audio,
  onConnect,
  onChanged,
}: {
  audio: ModelsResponse['audio']
  onConnect: (providerId: string) => void
  onChanged: () => Promise<void>
}) {
  return (
    <RouteCard
      field="BAZILION_AUDIO_MODEL"
      labelledBy="setup-audio"
      icon={<Music className="size-5" />}
      title="Music and sound"
      description="What Agents make songs, jingles, background music and sound effects with."
      offText="Agents have no music or sound tool"
      unknown="a music and sound route"
      choice={audio}
      onConnect={onConnect}
      onChanged={onChanged}
    />
  )
}

/**
 * Speech: one model reads text out for every Agent (`speak`, Read aloud in the chat, voice replies
 * on Telegram), in the voice chosen here (BAZ-096).
 */
export function SpeechCard({
  speech,
  onConnect,
  onChanged,
}: {
  speech: ModelsResponse['speech']
  onConnect: (providerId: string) => void
  onChanged: () => Promise<void>
}) {
  const ready = speech.routes.some((route) => route.id === speech.selected && route.ready)
  return (
    <RouteCard
      field="BAZILION_SPEECH_MODEL"
      labelledBy="setup-speech"
      icon={<Speech className="size-5" />}
      title="Speech"
      description="What Agents speak with: the speak tool, Read aloud in the chat, and voice replies when you send a voice note on Telegram."
      offText="Agents do not speak; Read aloud is not offered"
      unknown="a speech route"
      choice={speech}
      onConnect={onConnect}
      onChanged={onChanged}
    >
      {ready && <VoiceRow key={speech.selected} chosen={speech.voice} onChanged={onChanged} />}
    </RouteCard>
  )
}

/** The voice the speech model reads in, from its provider's list, with a sample to hear. */
function VoiceRow({
  chosen,
  onChanged,
}: {
  chosen: string | null
  onChanged: () => Promise<void>
}) {
  const voices = useResource(
    (signal) => api<SpeechVoicesResponse>('/api/speech/voices', { signal }),
    [],
  )
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const player = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => player.current?.pause(), [])
  const list = voices.data?.voices ?? []
  const current = chosen && list.some((voice) => voice.id === chosen) ? chosen : (list[0]?.id ?? '')

  async function choose(id: string) {
    setError(null)
    try {
      await api('/api/config/fields/BAZILION_SPEECH_VOICE', { method: 'PUT', body: { value: id } })
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function sample() {
    const voice = list.find((entry) => entry.id === current)
    setError(null)
    setPlaying(true)
    try {
      const body: SpeakRequest = {
        text: `Hello, this is ${voice?.name ?? 'the voice you chose'}. This is how your Agents will sound.`,
        ...(current ? { voice: current } : {}),
      }
      const response = await apiFetch('/api/speech', { body })
      const url = URL.createObjectURL(await response.blob())
      player.current?.pause()
      const audio = new Audio(url)
      player.current = audio
      audio.onended = () => {
        URL.revokeObjectURL(url)
        setPlaying(false)
      }
      await audio.play()
    } catch (cause) {
      setError(errorMessage(cause))
      setPlaying(false)
    }
  }

  return (
    <div className={`${ROW} flex-wrap items-end gap-3 py-3`}>
      {voices.error ? (
        <p role="alert" className="m-0 text-sm text-danger">
          The voices could not be listed: {voices.error}
        </p>
      ) : (
        <>
          <SelectField
            label="Voice"
            value={current}
            disabled={!voices.data || list.length === 0}
            placeholder={voices.data ? 'No voices listed' : 'Loading the voices…'}
            options={list.map((voice) => ({
              value: voice.id,
              label: voice.name,
              ...(voice.detail ? { hint: voice.detail } : {}),
            }))}
            onChange={(id) => void choose(id)}
            className="min-w-56 flex-1"
          />
          <Button variant="ghost" disabled={!current || playing} onClick={() => void sample()}>
            {playing ? 'Playing…' : 'Play a sample'}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="m-0 basis-full text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** One model for every Agent, through one provider's account, chosen from a list, or none. */
function RouteCard({
  field,
  labelledBy,
  icon,
  title,
  description,
  offText,
  unknown,
  choice,
  onConnect,
  onChanged,
  children,
}: {
  field: string
  labelledBy: string
  icon: React.ReactNode
  title: string
  description: string
  /** What Off means. */
  offText: string
  /** What the setting should name, for a value that names none. */
  unknown: string
  choice: { selected: string; routes: (ImageRouteEntry | MediaRouteEntry)[] }
  onConnect: (providerId: string) => void
  onChanged: () => Promise<void>
  /** Rows of the chosen route's own settings, under the choices. */
  children?: ReactNode
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = choice.routes.find((route) => route.id === choice.selected)
  const on = selected?.ready === true
  const shown = saving ?? choice.selected

  async function choose(id: string) {
    setSaving(id)
    setError(null)
    try {
      await api(`/api/config/fields/${field}`, { method: 'PUT', body: { value: id } })
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(null)
    }
  }

  const row = (id: string, body: React.ReactNode, ready: boolean, tail: React.ReactNode) => (
    <label
      key={id}
      className={`${ROW} m-0 min-h-[3.25rem] py-2 ${ready ? 'cursor-pointer' : ''} ${shown === id ? 'bg-accent/40' : ''}`}
    >
      <input
        type="radio"
        name={labelledBy}
        checked={shown === id}
        disabled={!ready || saving !== null}
        onChange={() => void choose(id)}
        className="m-0 size-[18px] shrink-0 accent-[var(--color-sapphire)]"
      />
      {body}
      <span className="ml-auto flex shrink-0 justify-end sm:w-44">{tail}</span>
    </label>
  )

  return (
    <SetupCard
      labelledBy={labelledBy}
      icon={icon}
      title={title}
      description={description}
      action={
        <Chip tone={on ? 'success' : selected ? 'warning' : 'neutral'}>
          {on ? `On: ${selected.model}` : selected ? `Needs ${selected.needs}` : 'Off'}
        </Chip>
      }
    >
      {choice.routes.map((route) =>
        row(
          route.id,
          <>
            <span className="min-w-0 flex-[1.6] basis-60 text-base">
              <span
                className={`font-semibold ${route.ready ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {route.model}
              </span>{' '}
              <span className="text-muted-foreground">through {route.providerName}</span>
            </span>
            <span className="min-w-0 flex-1 basis-44 text-sm text-muted-foreground">
              {route.billing}
            </span>
          </>,
          route.ready,
          route.ready ? (
            <span className="text-sm font-semibold text-success">Ready</span>
          ) : (
            <Button variant="ghost" onClick={() => onConnect(route.provider)}>
              {route.provider === 'openai-codex' ? 'Sign in' : `Connect ${route.providerName}`}
            </Button>
          ),
        ),
      )}
      {row(
        'off',
        <>
          <span className="min-w-0 flex-[1.6] basis-60 text-base font-semibold text-foreground">
            Off
          </span>
          <span className="min-w-0 flex-1 basis-44 text-sm text-muted-foreground">{offText}</span>
        </>,
        true,
        null,
      )}
      {children}
      {choice.selected !== 'off' && !selected && (
        <div role="alert" className={`${ROW} py-3 text-sm text-warning`}>
          {field} is set to “{choice.selected}”, which is not {unknown}. Choose one above.
        </div>
      )}
      {error && (
        <div role="alert" className={`${ROW} py-3 text-sm text-danger`}>
          {error}
        </div>
      )}
    </SetupCard>
  )
}

/**
 * Command review: the model that answers first for a dangerous command, when Commands (Setup →
 * Tools) asks a review model. One of Chat's models, or none.
 */
export function CommandReviewCard({
  chat,
  review,
  onChanged,
}: {
  chat: ChatModelEntry[]
  review: ModelsResponse['commandReview']
  onChanged: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = review.selected ?? ''
  const known = chat.find((model) => model.value === selected)

  async function choose(value: string) {
    setSaving(true)
    setError(null)
    try {
      await api('/api/config/fields/BAZILION_COMMAND_REVIEW_MODEL', {
        method: value ? 'PUT' : 'DELETE',
        ...(value ? { body: { value } } : {}),
      })
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const used = review.approvalMode === 'review'
  return (
    <SetupCard
      labelledBy="setup-command-review"
      icon={<ShieldCheck className="size-5" />}
      title="Command review"
      description="The model that looks at a dangerous command first: it allows it, refuses it or passes it to you."
      action={
        <Chip tone={selected && used ? 'success' : 'neutral'}>
          {selected ? (used ? `On: ${known?.name ?? selected}` : 'Chosen, not asked') : 'None'}
        </Chip>
      }
    >
      <CardBody>
        <SelectField
          label="Review model"
          value={selected}
          disabled={saving}
          onChange={(value) => void choose(value)}
          options={[
            { value: '', label: 'None: you answer' },
            ...chat.map((model) => ({
              value: model.value,
              label: model.name ?? model.id,
              hint: model.providerName,
            })),
            ...(selected && !known
              ? [{ value: selected, label: `${selected} (not in Chat)` }]
              : []),
          ]}
          hint={
            used
              ? 'Commands asks it first. A cheap, fast model is enough: it reads one command at a time.'
              : 'Commands (Setup → Tools) does not ask a review model now: choose “A review model first” there.'
          }
        />
        {error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        )}
      </CardBody>
    </SetupCard>
  )
}

/** Providers: the accounts and local servers in use, each with what it serves and its state. */
export function ProvidersCard({
  providers,
  total,
  images,
  now,
  onOpen,
  onAdd,
}: {
  /** The providers on the page. */
  providers: ProviderConfigEntry[]
  /** How many providers Bazilion knows. */
  total: number
  images: ModelsResponse['images']
  now: number
  onOpen: (id: string) => void
  onAdd: () => void
}) {
  const drawing = images.routes.find((route) => route.id === images.selected && route.ready)
  return (
    <SetupCard
      labelledBy="setup-providers"
      icon={<Plug className="size-5" />}
      title="Providers"
      description="The accounts and local servers your models run on."
      action={
        <Button variant="primary" onClick={onAdd}>
          <Plus className="size-4" aria-hidden="true" />
          Add a provider
        </Button>
      }
    >
      {providers.map((provider) => {
        const count = provider.enabled ? provider.models.length : 0
        const uses = [
          count > 0 ? `Chat: ${count === 1 ? '1 model' : `${count} models`}` : null,
          drawing?.provider === provider.id ? 'Images' : null,
        ].filter(Boolean)
        const status = providerStatus(provider, now)
        return (
          <button
            key={provider.id}
            type="button"
            onClick={() => onOpen(provider.id)}
            className={`${ROW} min-h-[4.25rem] w-full py-3 text-left transition-colors hover:bg-accent/30`}
          >
            <ProviderAvatar name={provider.displayName} tone={status.tone} />
            <span className="min-w-0 flex-[1.6] basis-56">
              <span className="block text-base font-semibold text-foreground">
                {provider.displayName}
              </span>
              <span className="block truncate text-sm text-muted-foreground">
                {credentialLine(provider)}
              </span>
            </span>
            <span className="min-w-0 flex-1 basis-40 text-sm text-muted-foreground">
              {uses.length > 0 ? uses.join(' · ') : 'Not used yet'}
            </span>
            <StateChip provider={provider} now={now} />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        )
      })}
      {providers.length === 0 && (
        <div className={`${ROW} py-5 text-sm text-muted-foreground`}>
          No provider yet. Add one to give your Agents a model.
        </div>
      )}
      <div className={`${ROW} bg-muted/50 py-3 text-sm text-muted-foreground`}>
        {total - providers.length} more can be added: a ChatGPT plan, API keys from OpenAI,
        Anthropic, Google and many others, or a model server on this computer.
      </div>
    </SetupCard>
  )
}
