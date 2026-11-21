import type {
  CatalogModel,
  ChatModelEntry,
  ProviderCatalogResponse,
  ProviderConfigEntry,
  SetProviderModelsResponse,
} from '@bazilion/api-types'
import { useMemo, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { matchesModel, modelName } from '../../lib/model-facts'
import { useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { Dialog } from '../Dialog'
import { Segmented } from '../Segmented'
import { ModelRow, SearchField } from './parts'

type Filter = 'all' | 'images' | 'reasoning'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'images', label: 'Sees images' },
  { id: 'reasoning', label: 'Reasoning' },
]

/** Rows of one provider shown at once; a search narrows the rest down. */
const MAX_ROWS = 80

interface Loaded {
  provider: ProviderConfigEntry
  catalog: ProviderCatalogResponse
}

/**
 * Choose the chat models Agents may use, across every connected provider: names, sizes and prices
 * from the bundled catalog, plus what each provider reports itself. Saving replaces each changed
 * provider's list.
 */
export function ModelPicker({
  providers,
  chat,
  onClose,
  onSaved,
  onAddProvider,
}: {
  /** The providers Agents may use. */
  providers: ProviderConfigEntry[]
  /** The models in use now, for who runs on each. */
  chat: ChatModelEntry[]
  onClose: () => void
  onSaved: () => Promise<void>
  onAddProvider: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [dated, setDated] = useState(false)
  const [picked, setPicked] = useState<Record<string, string[]> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ids = providers.map((provider) => provider.id).join(',')
  const catalogs = useResource(
    async (signal) => {
      const loaded = await Promise.all(
        providers.map(async (provider): Promise<Loaded> => {
          const catalog = await api<ProviderCatalogResponse>(
            `/api/config/providers/${encodeURIComponent(provider.id)}/catalog`,
            { signal },
          )
          return { provider, catalog }
        }),
      )
      setPicked(
        Object.fromEntries(
          loaded.map(({ provider, catalog }) => [
            provider.id,
            catalog.models.filter((model) => model.selected).map((model) => model.id),
          ]),
        ),
      )
      return loaded
    },
    [ids],
  )

  const picks = picked ?? {}
  const isPicked = (provider: string, model: string) => picks[provider]?.includes(model) ?? false
  const toggle = (provider: string, model: string) =>
    setPicked((current) => {
      const list = current?.[provider] ?? []
      return {
        ...current,
        [provider]: list.includes(model) ? list.filter((id) => id !== model) : [...list, model],
      }
    })

  const shown = (model: CatalogModel, provider: ProviderConfigEntry) => {
    if (query) return matchesModel(model, query)
    if (model.dated && !dated && !isPicked(provider.id, model.id)) return false
    if (filter === 'images') return model.images === true
    if (filter === 'reasoning') return model.reasoning === true
    return true
  }

  const changed = useMemo(
    () =>
      (catalogs.data ?? []).filter(({ provider, catalog }) => {
        const before = catalog.models.filter((model) => model.selected).map((model) => model.id)
        const after = picks[provider.id] ?? []
        return before.length !== after.length || before.some((id) => !after.includes(id))
      }),
    [catalogs.data, picks],
  )
  // Removing a model somebody runs on is allowed, and said before it happens.
  const stranded = chat.filter(
    (model) =>
      model.usedBy.agents > 0 &&
      changed.some(({ provider }) => provider.id === model.provider) &&
      !isPicked(model.provider, model.id),
  )
  const total = Object.values(picks).reduce((sum, list) => sum + list.length, 0)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      for (const { provider } of changed) {
        await api<SetProviderModelsResponse>(
          `/api/config/providers/${encodeURIComponent(provider.id)}/models`,
          { method: 'PUT', body: { models: picks[provider.id] ?? [] } },
        )
      }
      await onSaved()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Chat models"
      description="Tick the models your Agents may use. Each Agent and each template picks one of them."
      onClose={onClose}
      busy={saving}
      className="top-[4dvh] max-h-[92dvh] max-w-3xl translate-y-0 content-start"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          label="Search models"
          placeholder="Search by name, for example haiku"
          value={query}
          onChange={setQuery}
          className="flex-1 basis-60"
        />
        <Segmented label="Show" value={filter} options={FILTERS} onChange={setFilter} />
      </div>

      <div className="max-h-[min(58dvh,36rem)] min-h-40 overflow-y-auto rounded-xl border border-border">
        {catalogs.loading && !catalogs.data && (
          <div className="p-4 text-sm text-muted-foreground">Reading the model lists…</div>
        )}
        {catalogs.error && (
          <div role="alert" className="p-4 text-sm text-danger">
            {catalogs.error}
          </div>
        )}
        {catalogs.data?.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No provider is connected yet. Add one to see its models here.
          </div>
        )}
        {(catalogs.data ?? []).map(({ provider, catalog }) => {
          const matching = catalog.models.filter((model) => shown(model, provider))
          const rows = matching.slice(0, MAX_ROWS)
          const hiddenDated = catalog.models.filter(
            (model) => model.dated && !isPicked(provider.id, model.id),
          ).length
          if (query && matching.length === 0) return null
          return (
            <section key={provider.id} aria-label={provider.displayName}>
              <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border bg-muted/50 px-4 py-2">
                <h3 className="m-0 font-body text-[0.72rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  {provider.displayName}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {(picks[provider.id] ?? []).length} of {catalog.models.length} in use
                </span>
                {catalog.listError && (
                  <span className="text-xs text-warning">
                    Its own list could not be read: {catalog.listError}
                  </span>
                )}
              </div>
              {rows.length === 0 && (
                <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
                  {catalog.models.length === 0 ? 'It lists no model.' : 'Nothing matches.'}
                </div>
              )}
              {rows.map((model) => (
                <ModelRow
                  key={model.id}
                  model={{ ...model, suggested: false }}
                  connect={provider.connect}
                  checked={isPicked(provider.id, model.id)}
                  disabled={saving}
                  onToggle={() => toggle(provider.id, model.id)}
                  className="px-4 hover:bg-accent/30"
                />
              ))}
              {matching.length > rows.length && (
                <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                  {matching.length - rows.length} more: search to narrow them down.
                </div>
              )}
              {!query && hiddenDated > 0 && (
                <div className="border-b border-border px-4 py-1.5">
                  <button
                    type="button"
                    onClick={() => setDated((open) => !open)}
                    className="text-xs font-semibold text-primary"
                  >
                    {dated
                      ? 'Hide dated versions'
                      : `Show ${hiddenDated} dated ${hiddenDated === 1 ? 'version' : 'versions'} of the same models`}
                  </button>
                </div>
              )}
            </section>
          )
        })}
      </div>

      {stranded.length > 0 && (
        <p role="status" className="m-0 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">
          {stranded.map((model) => modelName(model)).join(', ')}{' '}
          {stranded.length === 1 ? 'is' : 'are'} in use by Agents. They are refused until you give
          them another model in their Agent tab.
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-frost pt-4">
        <span className="min-w-0 flex-1 basis-40 text-sm text-muted-foreground">
          {total === 1 ? '1 model in Chat' : `${total} models in Chat`}
        </span>
        <button
          type="button"
          onClick={onAddProvider}
          className="text-sm font-semibold text-primary"
        >
          A model from another provider?
        </button>
        <Button variant="ghost" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={saving || changed.length === 0}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Dialog>
  )
}
