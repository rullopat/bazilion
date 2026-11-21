import type {
  CatalogModel,
  ConnectProviderRequest,
  ConnectProviderResponse,
  ImageRouteEntry,
  ProviderCatalogResponse,
  ProviderConfigEntry,
  ProviderFailure,
  ServiceFieldState,
} from '@bazilion/api-types'
import { ChevronRight, Images, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { cheapest, initialPicks, matchesModel, modelName } from '../../lib/model-facts'
import { useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { FailureBox, ModelRow, SearchField, Waiting } from './parts'

export type Connected = Extract<ConnectProviderResponse, { connected: true }>

/** Rows of a long catalog shown at once; typing narrows it down. */
const MAX_ROWS = 60

function initialValues(provider: ProviderConfigEntry): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of provider.fields) {
    values[field.envVar] = field.kind === 'config' ? (field.value ?? '') : ''
  }
  // A local server answers at its usual address until another one is typed.
  const address = provider.fields.find((field) => field.kind === 'config' && !field.advanced)
  if (provider.connect === 'local' && address && !address.set) {
    values[address.envVar] = provider.address ?? ''
  }
  return values
}

/** The fields whose value is not what is stored: only those are sent. */
function changedFields(
  provider: ProviderConfigEntry,
  values: Record<string, string>,
): Record<string, string> {
  const changed: Record<string, string> = {}
  for (const field of provider.fields) {
    const value = (values[field.envVar] ?? '').trim()
    if (field.kind === 'secret') {
      if (value) changed[field.envVar] = value
    } else if (value !== (field.value ?? '')) {
      // The usual address of a local server is the default: nothing to store.
      if (!field.set && provider.connect === 'local' && value === provider.address) continue
      changed[field.envVar] = value
    }
  }
  return changed
}

/**
 * Connect a provider in one step: its key, sign-in or address, the models Agents may use, and one
 * button that tests before anything is saved. Used by "Add a provider" and by the first run.
 */
export function ProviderConnect({
  provider,
  imageRoutes = [],
  onConnected,
}: {
  provider: ProviderConfigEntry
  /** The image routes this provider's account would serve. */
  imageRoutes?: ImageRouteEntry[]
  onConnected: (result: Connected) => void | Promise<void>
}) {
  const [values, setValues] = useState(() => initialValues(provider))
  // What the provider's own list is asked with: the address, once it has been typed.
  const [lookup, setLookup] = useState(() => changedLookup(provider, initialValues(provider)))
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [extra, setExtra] = useState<string[]>([])
  const [typedModel, setTypedModel] = useState('')
  // Whether the whole list is shown; decided once the list is known, then only by the reader.
  const [showAll, setShowAll] = useState<boolean | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [query, setQuery] = useState('')
  const [phase, setPhase] = useState<'idle' | 'signin' | 'connecting'>('idle')
  const [signedIn, setSignedIn] = useState(provider.configured)
  const [failure, setFailure] = useState<ProviderFailure | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  // The form can be taller than its dialog: what went wrong is brought into view.
  const outcome = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (failure || error) outcome.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [failure, error])

  const catalog = useResource(
    (signal) =>
      api<ProviderCatalogResponse>(
        `/api/config/providers/${encodeURIComponent(provider.id)}/catalog`,
        { body: { fields: lookup }, signal },
      ),
    [provider.id, JSON.stringify(lookup)],
  )
  const models = useMemo<CatalogModel[]>(() => {
    // Suggested models lead, in the provider's own order: the first model saved becomes the
    // Default template's on a first run.
    const rank = (model: CatalogModel) => {
      const at = provider.suggested.indexOf(model.id)
      return at === -1 ? provider.suggested.length : at
    }
    const listed = [...(catalog.data?.models ?? [])].sort((a, b) => rank(a) - rank(b))
    const known = new Set(listed.map((model) => model.id))
    return [
      ...listed,
      ...extra
        .filter((id) => !known.has(id))
        .map((id) => ({ id, selected: false, suggested: false })),
    ]
  }, [catalog.data, extra, provider.suggested])

  // Tick the suggested models once the list is known, and again when another server answers.
  useEffect(() => {
    const listed = catalog.data?.models
    if (!listed) return
    setPicked((current) => {
      if (current && [...current].some((id) => listed.some((model) => model.id === id))) {
        return current
      }
      return new Set(initialPicks(listed))
    })
    // A short list, or one with nothing to suggest, is shown whole. Ticking never changes this:
    // the rows stay where they are while they are being chosen.
    setShowAll((current) => current ?? (listed.length <= 6 || initialPicks(listed).length === 0))
  }, [catalog.data])

  const picks = picked ?? new Set<string>()
  const chosen = models.filter((model) => picks.has(model.id))
  const asked = cheapest(chosen)
  const busy = phase !== 'idle'
  const local = provider.connect === 'local'
  const signin = provider.connect === 'signin'
  const mainFields = provider.fields.filter((field) => !field.advanced)
  const advancedFields = provider.fields.filter((field) => field.advanced)
  const credentialsReady =
    signin ||
    provider.configured ||
    mainFields.every((field) => field.set || (values[field.envVar] ?? '').trim().length > 0)
  const shortlist = models.filter(
    (model) => model.suggested || model.selected || picks.has(model.id),
  )
  const browsing = showAll === true
  const matching = browsing
    ? models.filter((model) =>
        // A dated copy stays out of the way unless it is searched for or already ticked.
        query ? matchesModel(model, query) : !model.dated || picks.has(model.id),
      )
    : shortlist
  const rows = matching.slice(0, MAX_ROWS)

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addTyped() {
    const id = typedModel.trim()
    if (!id) return
    setExtra((current) => (current.includes(id) ? current : [...current, id]))
    setPicked((current) => new Set(current).add(id))
    setTypedModel('')
  }

  async function submit(test: boolean) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setFailure(null)
    setError(null)
    try {
      if (signin && !signedIn) {
        setPhase('signin')
        await api('/api/auth/openai/login', { method: 'POST', signal: controller.signal })
        setSignedIn(true)
      }
      setPhase('connecting')
      const body: ConnectProviderRequest = {
        fields: changedFields(provider, values),
        models: chosen.map((model) => model.id),
        // A test needs a model to ask: with none ticked this only saves.
        ...(test && chosen.length > 0 ? {} : { test: false }),
      }
      const result = await api<ConnectProviderResponse>(
        `/api/config/providers/${encodeURIComponent(provider.id)}/connect`,
        { body, signal: controller.signal },
      )
      if (controller.signal.aborted) return
      if (result.connected) await onConnected(result)
      else setFailure(result.failure)
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause))
    } finally {
      if (request.current === controller) setPhase('idle')
    }
  }

  let testNote = 'No chat model is ticked, so nothing is tested.'
  if (chosen.length > 0) {
    const target = asked ? modelName(asked) : 'a model'
    const rank = asked?.price ? 'cheapest' : 'first'
    const which = chosen.length > 1 ? `${target}, the ${rank} one ticked` : target
    testNote =
      signin && !signedIn
        ? `After the sign-in, one short message goes to ${which}.`
        : `The test sends one short message to ${which}.`
    if (asked?.price && !signin) testNote += ' It costs a fraction of a cent.'
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit(true)
      }}
      className="grid gap-4"
    >
      {provider.hint && <p className="m-0 text-sm text-muted-foreground">{provider.hint}</p>}

      {signin && (
        <p className="m-0 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {signedIn
            ? 'You are signed in with ChatGPT. Bazilion renews the sign-in by itself.'
            : 'A browser tab opens on the machine Bazilion runs on, and you sign in with your ChatGPT account there. On another machine, run bazilion auth openai login --device-code on it instead.'}
        </p>
      )}

      {mainFields.map((field, index) => (
        <FieldInput
          key={field.envVar}
          field={field}
          value={values[field.envVar] ?? ''}
          disabled={busy}
          autoFocus={index === 0 && !local}
          onChange={(value) => setValues((current) => ({ ...current, [field.envVar]: value }))}
          onCommit={local ? () => setLookup(changedLookup(provider, values)) : undefined}
        />
      ))}

      {advancedFields.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setShowMore((open) => !open)}
            className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
          >
            <ChevronRight
              className={`size-4 text-muted-foreground transition-transform ${showMore ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            More settings
          </button>
          {showMore && (
            <div className="mt-2 grid gap-3 rounded-xl border border-border bg-muted/40 p-3">
              {advancedFields.map((field) => (
                <FieldInput
                  key={field.envVar}
                  field={field}
                  value={values[field.envVar] ?? ''}
                  disabled={busy}
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [field.envVar]: value }))
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 flex w-full flex-wrap items-baseline gap-x-2 p-0">
          <span className="text-sm font-semibold text-foreground">Models your Agents can use</span>
          <span className="text-xs text-muted-foreground">
            {local
              ? 'What the server reports. You can change this later.'
              : `${models.length} available. You can change this later.`}
          </span>
        </legend>

        {local && catalog.data?.listError && (
          <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-warning/35 bg-warning/10 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              Nothing answers at {values[mainFields[0]?.envVar ?? ''] || 'that address'}. Start{' '}
              {provider.displayName} and switch its server on.
            </span>
            <Button
              variant="ghost"
              disabled={catalog.loading}
              onClick={() => {
                setLookup(changedLookup(provider, values))
                void catalog.reload()
              }}
            >
              {catalog.loading ? 'Looking…' : 'Look again'}
            </Button>
          </div>
        )}

        {browsing && models.length > 8 && (
          <SearchField
            label={`Search ${provider.displayName} models`}
            placeholder="Search by name"
            value={query}
            onChange={setQuery}
            className="mb-2"
          />
        )}
        {browsing && models.length > 8 && chosen.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Ticked:</span>
            {chosen.map((model) => (
              <button
                key={model.id}
                type="button"
                disabled={busy}
                onClick={() => toggle(model.id)}
                aria-label={`Untick ${modelName(model)}`}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 font-semibold text-accent-foreground"
              >
                {modelName(model)}
                <X className="size-3" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}

        <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
          {catalog.loading && !catalog.data && (
            <div className="p-3 text-sm text-muted-foreground">Reading the model list…</div>
          )}
          {catalog.error && <div className="p-3 text-sm text-danger">{catalog.error}</div>}
          {catalog.data && rows.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">
              {query
                ? 'No model matches.'
                : local
                  ? 'The server lists no model yet.'
                  : 'No models are listed for this provider. Add one by its id below.'}
            </div>
          )}
          {rows.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              connect={provider.connect}
              checked={picks.has(model.id)}
              disabled={busy}
              onToggle={() => toggle(model.id)}
              className="px-3 last:border-b-0"
            />
          ))}
          {matching.length > rows.length && (
            <div className="p-3 text-xs text-muted-foreground">
              {matching.length - rows.length} more: search to narrow them down.
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          {!browsing && models.length > shortlist.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-sm font-semibold text-primary"
            >
              See all {models.length}
            </button>
          )}
          {browsing && !local && (
            <span className="flex min-w-0 flex-1 basis-64 items-center gap-2">
              <input
                type="text"
                aria-label="A model id that is not listed"
                placeholder="A model id that is not listed"
                value={typedModel}
                disabled={busy}
                onChange={(event) => setTypedModel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addTyped()
                  }
                }}
                className="min-h-10 font-mono text-sm"
              />
              <Button variant="ghost" disabled={busy || !typedModel.trim()} onClick={addTyped}>
                Add
              </Button>
            </span>
          )}
        </div>
      </fieldset>

      {imageRoutes.length > 0 && (
        <p className="m-0 flex items-start gap-2 text-sm text-muted-foreground">
          <Images className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
          <span>
            {signin ? 'The same sign-in' : 'The same key'} makes{' '}
            {[...new Set(imageRoutes.map((route) => route.model))].join(' and ')} available under
            Images.
          </span>
        </p>
      )}

      <div ref={outcome} className="grid gap-3 empty:hidden">
        {failure && <FailureBox failure={failure} />}
        {error && (
          <p role="alert" className="m-0 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {busy ? (
        <Waiting>
          {phase === 'signin'
            ? 'Waiting for the ChatGPT sign-in in the browser…'
            : asked
              ? `Asking ${modelName(asked)} for a short reply…`
              : 'Saving…'}
        </Waiting>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              variant="primary"
              type="submit"
              disabled={!credentialsReady || (local && chosen.length === 0)}
            >
              {signin && !signedIn
                ? 'Sign in with ChatGPT'
                : chosen.length === 0
                  ? 'Connect'
                  : 'Connect and test'}
            </Button>
            {chosen.length > 0 && !(signin && !signedIn) && (
              <button
                type="button"
                disabled={!credentialsReady}
                onClick={() => void submit(false)}
                className="text-sm font-semibold text-primary disabled:opacity-50"
              >
                Save without testing
              </button>
            )}
          </div>
          <p className="m-0 mt-2 text-xs text-muted-foreground">{testNote}</p>
        </div>
      )}
    </form>
  )
}

/** The config fields being typed, for asking a local server at an address that is not saved. */
function changedLookup(
  provider: ProviderConfigEntry,
  values: Record<string, string>,
): Record<string, string> {
  if (provider.connect !== 'local') return {}
  const changed = changedFields(provider, values)
  return Object.fromEntries(
    Object.entries(changed).filter(([name]) =>
      provider.fields.some((field) => field.envVar === name && field.kind === 'config'),
    ),
  )
}

function FieldInput({
  field,
  value,
  disabled,
  autoFocus = false,
  onChange,
  onCommit,
}: {
  field: ServiceFieldState
  value: string
  disabled: boolean
  autoFocus?: boolean
  onChange: (value: string) => void
  /** The value is complete: the field lost focus or Enter was pressed. */
  onCommit?: () => void
}) {
  const secret = field.kind === 'secret'
  return (
    <label className="m-0 text-sm font-semibold text-foreground">
      {field.label}
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        disabled={disabled}
        // biome-ignore lint/a11y/noAutofocus: the one field this form is opened to fill.
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        placeholder={
          secret && field.set ? 'Saved. Paste another to replace it.' : (field.placeholder ?? '')
        }
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onCommit) {
            event.preventDefault()
            onCommit()
          }
        }}
        className="mt-1.5 font-mono font-normal"
      />
      {(field.description || secret) && (
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {field.description ??
            'Stored encrypted on the machine Bazilion runs on. It is never shown again.'}
        </span>
      )}
    </label>
  )
}
