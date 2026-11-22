import type {
  ChatModelEntry,
  ImageRouteEntry,
  ModelsResponse,
  ProviderConfigEntry,
  SetProviderModelsResponse,
} from '@bazilion/api-types'
import { ChevronRight, Images, MessageSquare, Plug, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import {
  credentialLine,
  factsLine,
  modelName,
  priceLine,
  providerStatus,
  usedByLine,
} from '../../lib/model-facts'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { Banner, Chip, CARD_ROW as ROW, SetupCard } from '../ui/parts'
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
              className={`min-w-0 flex-[2] basis-48 text-sm ${down ? 'font-semibold text-warning' : 'text-muted-foreground'}`}
            >
              {down
                ? `${model.providerName} is not working`
                : factsLine(model, model.providerConnect)}
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
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = images.routes.find((route) => route.id === images.selected)
  const on = selected?.ready === true
  const shown = saving ?? images.selected

  async function choose(id: string) {
    setSaving(id)
    setError(null)
    try {
      await api('/api/config/fields/BAZILION_IMAGE_MODEL', { method: 'PUT', body: { value: id } })
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
        name="image-model"
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
      labelledBy="setup-images"
      icon={<Images className="size-5" />}
      title="Images"
      description="What Agents draw with. One model for every Agent, up to four images a turn."
      action={
        <Chip tone={on ? 'success' : selected ? 'warning' : 'neutral'}>
          {on ? `On: ${selected.model}` : selected ? `Needs ${selected.needs}` : 'Off'}
        </Chip>
      }
    >
      {images.routes.map((route: ImageRouteEntry) =>
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
          <span className="min-w-0 flex-1 basis-44 text-sm text-muted-foreground">
            Agents have no image tool
          </span>
        </>,
        true,
        null,
      )}
      {images.selected !== 'off' && !selected && (
        <div role="alert" className={`${ROW} py-3 text-sm text-warning`}>
          BAZILION_IMAGE_MODEL is set to “{images.selected}”, which is not an image route. Choose
          one above.
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
