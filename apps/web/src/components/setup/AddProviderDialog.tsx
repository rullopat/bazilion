import type {
  ImageRouteEntry,
  LocalProvidersResponse,
  ProviderConfigEntry,
} from '@bazilion/api-types'
import { ArrowLeft, Check, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { providerStatus } from '../../lib/model-facts'
import { useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { Dialog, DialogActions } from '../Dialog'
import { SearchField } from '../ui/parts'
import { type Connected, ProviderConnect } from './ProviderConnect'
import { ProviderAvatar } from './provider-parts'

type LocalServers = LocalProvidersResponse['servers']

/** A local server's address without the scheme and path: what a person recognises. */
export function hostOf(address: string): string {
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

export function localLine(server: LocalServers[number] | undefined, looking: boolean): string {
  if (!server) return looking ? 'Looking…' : 'A model server on this computer'
  if (!server.found) return `Nothing at ${hostOf(server.address)}`
  const count = server.models.length
  return `Running at ${hostOf(server.address)}, ${count === 1 ? '1 model' : `${count} models`}`
}

function matches(provider: ProviderConfigEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [provider.displayName, provider.id, provider.hint ?? ''].some((text) =>
    text.toLowerCase().includes(needle),
  )
}

/** Every provider, the most used and the local ones first; `onPick` opens the next step. */
export function ProviderChooser({
  providers,
  expanded = false,
  onPick,
}: {
  providers: ProviderConfigEntry[]
  /** Show every provider at once instead of folding the long tail. */
  expanded?: boolean
  onPick: (provider: ProviderConfigEntry) => void
}) {
  const [query, setQuery] = useState('')
  const [showMore, setShowMore] = useState(expanded)
  const local = useResource(
    (signal) => api<LocalProvidersResponse>('/api/config/providers/local', { signal }),
    [],
  )
  const now = useMemo(() => Date.now(), [])
  const visible = providers.filter((provider) => matches(provider, query))
  const group = (name: ProviderConfigEntry['group']) =>
    visible.filter((provider) => provider.group === name)
  const more = group('more')
  const searching = query.trim().length > 0

  const tile = (provider: ProviderConfigEntry) => {
    const server = local.data?.servers.find((entry) => entry.id === provider.id)
    const found = provider.group === 'local' && server?.found
    const sub = provider.listed
      ? providerStatus(provider, now).label
      : provider.group === 'local'
        ? localLine(server, local.loading)
        : (provider.hint ?? provider.id)
    return (
      <button
        key={provider.id}
        type="button"
        onClick={() => onPick(provider)}
        className="flex min-h-16 min-w-0 items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
      >
        <ProviderAvatar
          name={provider.displayName}
          tone={provider.listed || found ? 'success' : 'neutral'}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {provider.displayName}
          </span>
          <span
            className={`line-clamp-2 text-xs leading-snug ${provider.listed || found ? 'text-success' : 'text-muted-foreground'}`}
          >
            {sub}
          </span>
        </span>
        {provider.listed ? (
          <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
    )
  }
  const section = (title: string, entries: ProviderConfigEntry[]) =>
    entries.length > 0 && (
      <div>
        <h3 className="m-0 mb-2 font-body text-[0.72rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">{entries.map(tile)}</div>
      </div>
    )

  return (
    <div className="grid gap-4">
      <SearchField
        label="Search providers"
        placeholder={`Search ${providers.length} providers`}
        value={query}
        onChange={setQuery}
      />
      {section('Most used', group('popular'))}
      {section('On this computer', group('local'))}
      {(searching || showMore) && section('More', more)}
      {visible.length === 0 && (
        <p className="m-0 text-sm text-muted-foreground">No provider matches “{query}”.</p>
      )}
      {!searching && !showMore && more.length > 0 && (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="justify-self-start text-sm font-semibold text-primary"
        >
          Show {more.length} more:{' '}
          {more
            .slice(0, 4)
            .map((provider) => provider.displayName)
            .join(', ')}
          …
        </button>
      )}
    </div>
  )
}

/** What a finished connect says: who answered, what was added, what was left out. */
export function ConnectedSummary({
  result,
  imageRoutes,
}: {
  result: Connected
  imageRoutes: ImageRouteEntry[]
}) {
  const { provider, check, dropped, movedTemplates } = result
  const count = provider.models.length
  const images = [...new Set(imageRoutes.map((route) => route.model))]
  return (
    <div role="status" className="flex items-start gap-4">
      <span
        aria-hidden="true"
        className={`flex size-11 shrink-0 items-center justify-center rounded-full ${check ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}
      >
        <Check className="size-6" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="text-base font-semibold text-foreground">
          {check
            ? `${provider.displayName} is connected`
            : `${provider.displayName} is saved, not tested`}
        </div>
        <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-muted-foreground">
          {check && (
            <li>
              {check.modelName ?? check.model} answered in {((check.ms ?? 0) / 1000).toFixed(1)} s.
            </li>
          )}
          <li>
            {count === 0
              ? 'No chat model is in use from it.'
              : count === 1
                ? '1 model is in Chat.'
                : `${count} models are in Chat.`}
            {!check && count > 0 && ' Test it from its row before you rely on it.'}
          </li>
          {dropped.map((entry) => (
            <li key={entry.model} className="text-warning">
              {entry.model} was left out: this account cannot use it.
            </li>
          ))}
          {images.length > 0 && <li>{images.join(' and ')} can now be chosen under Images.</li>}
          {movedTemplates.map((template) => (
            <li key={template.id}>
              The {template.name} template now uses {template.model}.
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** "Add a provider": choose one, connect it, see that it answered. */
export function AddProviderDialog({
  providers,
  imageRoutes,
  start,
  onClose,
  onConnected,
  onOpenProvider,
}: {
  providers: ProviderConfigEntry[]
  imageRoutes: ImageRouteEntry[]
  /** A provider to connect straight away, skipping the list. */
  start?: string
  onClose: () => void
  /** Reload the page's data; the dialog waits for it before saying "connected". */
  onConnected: () => Promise<void>
  onOpenProvider: (id: string) => void
}) {
  const [chosen, setChosen] = useState<string | null>(
    start && providers.some((provider) => provider.id === start) ? start : null,
  )
  const [done, setDone] = useState<Connected | null>(null)
  const provider = providers.find((entry) => entry.id === chosen) ?? null
  const routesOf = (id: string) => imageRoutes.filter((route) => route.provider === id)

  if (done) {
    return (
      <Dialog title={done.provider.displayName} onClose={onClose} className="max-w-xl">
        <ConnectedSummary result={done} imageRoutes={routesOf(done.provider.id)} />
        <DialogActions>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    )
  }
  if (provider) {
    return (
      <Dialog
        title={`Connect ${provider.displayName}`}
        onClose={onClose}
        className="top-[6dvh] max-h-[88dvh] max-w-2xl translate-y-0 content-start"
      >
        {!start && (
          <button
            type="button"
            onClick={() => setChosen(null)}
            className="-mt-1 flex items-center gap-1 justify-self-start text-sm font-semibold text-primary"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            All providers
          </button>
        )}
        <ProviderConnect
          key={provider.id}
          provider={provider}
          imageRoutes={routesOf(provider.id).filter((route) => !route.ready)}
          onConnected={async (result) => {
            await onConnected()
            setDone(result)
          }}
        />
      </Dialog>
    )
  }
  return (
    <Dialog
      title="Add a provider"
      onClose={onClose}
      className="top-[6dvh] max-h-[88dvh] max-w-2xl translate-y-0 content-start"
    >
      <ProviderChooser
        providers={providers}
        onPick={(picked) => (picked.listed ? onOpenProvider(picked.id) : setChosen(picked.id))}
      />
    </Dialog>
  )
}
