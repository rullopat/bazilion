// One card of the Tools page: a tool's settings, each as the thing it is (a choice, a switch, a
// number with its unit, a key), what the tool is doing now, and one Save for the card.

import type { ServiceCard, ServiceFieldState, SetFieldsResponse } from '@bazilion/api-types'
import {
  AlertTriangle,
  AppWindow,
  ChevronRight,
  FileText,
  type LucideIcon,
  MessagesSquare,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react'
import { useId, useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import type { Tone } from '../../lib/model-facts'
import {
  applies,
  changedValues,
  type Draft,
  initialDraft,
  numberProblems,
} from '../../lib/tool-form'
import { cn } from '../../lib/utils'
import { Button } from '../Button'
import { Chip, SetupCard, Switch } from './parts'

const ICONS: Record<string, LucideIcon> = {
  'web-search': Search,
  'web-pages': FileText,
  browser: AppWindow,
  commands: SquareTerminal,
  'agent-messages': MessagesSquare,
}

/** The daemon names the setting it refuses; under the setting itself, "It" reads better. */
function plain(envVar: string, message: string | undefined): string | undefined {
  return message?.startsWith(`${envVar} `) ? `It ${message.slice(envVar.length + 1)}.` : message
}

const TONE: Record<NonNullable<ServiceCard['state']>['tone'], Tone> = {
  on: 'success',
  warning: 'warning',
  off: 'neutral',
}

export function ToolCard({
  card,
  justSaved,
  onSaved,
}: {
  card: ServiceCard
  /** This card was saved a moment ago. */
  justSaved: boolean
  /** Called after a save; resolves once the page has the new state. */
  onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(card))
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const Icon = ICONS[card.id] ?? Wrench
  const titleId = `tool-${card.id}`

  const problems = numberProblems(card, draft)
  const changes = changedValues(card, draft)
  const dirty = Object.keys(changes).length > 0
  const shown = card.fields.filter((field) => applies(field, draft))
  const main = shown.filter((field) => !field.advanced)
  const advanced = shown.filter((field) => field.advanced)
  // "More settings" opens by itself when it holds what has to be corrected.
  const advancedNeedsYou = advanced.some(
    (field) => refused[field.envVar] || problems[field.envVar] || field.unusable,
  )

  const edited = () => {
    setTouched(true)
    setRefused({})
    setError(null)
  }
  const set = (envVar: string, value: string) => {
    edited()
    setDraft((current) => ({
      values: { ...current.values, [envVar]: value },
      removed: current.removed.filter((name) => name !== envVar),
    }))
  }
  const remove = (envVar: string, removed: boolean) => {
    edited()
    setDraft((current) => ({
      values: { ...current.values, [envVar]: '' },
      removed: removed
        ? [...current.removed, envVar]
        : current.removed.filter((name) => name !== envVar),
    }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!dirty || busy || Object.keys(problems).length > 0) return
    setBusy(true)
    setError(null)
    setRefused({})
    try {
      await api<SetFieldsResponse>('/api/config/fields', {
        method: 'PUT',
        body: { values: changes },
      })
      await onSaved()
    } catch (cause) {
      const errors =
        cause instanceof ApiError &&
        cause.body &&
        typeof cause.body === 'object' &&
        'errors' in cause.body
          ? (cause.body.errors as Record<string, string>)
          : null
      if (errors) setRefused(errors)
      else setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const field = (entry: ServiceFieldState) => (
    <Setting
      key={entry.envVar}
      field={entry}
      value={draft.values[entry.envVar] ?? ''}
      removed={draft.removed.includes(entry.envVar)}
      problem={plain(entry.envVar, refused[entry.envVar]) ?? problems[entry.envVar]}
      disabled={busy}
      onChange={(value) => set(entry.envVar, value)}
      onRemove={(removed) => remove(entry.envVar, removed)}
    />
  )

  const status =
    Object.keys(refused).length > 0
      ? { text: 'Nothing was saved: see above.', className: 'text-warning' }
      : error
        ? { text: `Nothing was saved: ${error}`, className: 'text-warning' }
        : dirty
          ? { text: 'Not saved yet.', className: 'text-warning' }
          : justSaved && !touched
            ? { text: 'Saved. It applies from the next turn.', className: 'text-success' }
            : { text: card.footnote ?? '', className: 'text-muted-foreground' }

  return (
    <SetupCard
      icon={<Icon className="size-5" />}
      title={card.displayName}
      description={card.hint ?? ''}
      labelledBy={titleId}
      action={card.state && <Chip tone={TONE[card.state.tone]}>{card.state.label}</Chip>}
    >
      <form onSubmit={save} className="grid gap-4 border-t border-border px-4 py-4 sm:px-5">
        {card.note && (
          <p
            role="status"
            className="m-0 flex items-start gap-2.5 rounded-xl border border-warning/35 bg-warning/10 px-3.5 py-3 text-sm text-foreground"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="min-w-0 break-words">{card.note}</span>
          </p>
        )}

        {main.map(field)}

        {advanced.length > 0 && (
          <div>
            <button
              type="button"
              aria-expanded={more || advancedNeedsYou}
              onClick={() => setMore((open) => !open)}
              className="flex min-h-9 items-center gap-1.5 text-sm font-semibold text-foreground"
            >
              <ChevronRight
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  (more || advancedNeedsYou) && 'rotate-90',
                )}
                aria-hidden="true"
              />
              More settings
            </button>
            {(more || advancedNeedsYou) && (
              <div className="mt-2 grid gap-4 rounded-xl border border-border bg-muted/40 p-3.5">
                {advanced.map(field)}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            variant="primary"
            type="submit"
            disabled={!dirty || busy || Object.keys(problems).length > 0}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <p
            role="status"
            className={cn('m-0 min-w-0 flex-1 basis-56 text-sm font-medium', status.className)}
          >
            {status.text}
          </p>
        </div>
      </form>
    </SetupCard>
  )
}

function Setting({
  field,
  value,
  removed,
  problem,
  disabled,
  onChange,
  onRemove,
}: {
  field: ServiceFieldState
  value: string
  removed: boolean
  problem: string | undefined
  disabled: boolean
  onChange: (value: string) => void
  onRemove: (removed: boolean) => void
}) {
  const id = useId()
  const locked = disabled || (field.environment === true && field.kind !== 'secret')
  const under = (
    <>
      {field.unusable && !field.environment && (
        <span className="mt-1 block text-xs font-semibold text-warning">
          The stored value “{field.value}” cannot be used, so this is what applies. Save to replace
          it.
        </span>
      )}
      {field.environment && (
        <span className="mt-1 block text-xs font-medium text-muted-foreground">
          Set in the daemon’s environment as <code>{field.envVar}</code>, which wins over this page.
        </span>
      )}
      {problem && (
        <span role="alert" className="mt-1 block text-xs font-semibold text-warning">
          {problem}
        </span>
      )}
    </>
  )
  const input = field.input

  if (field.kind === 'secret') {
    return (
      <SecretSetting
        id={id}
        field={field}
        value={value}
        removed={removed}
        disabled={disabled}
        onChange={onChange}
        onRemove={onRemove}
      >
        {under}
      </SecretSetting>
    )
  }

  if (input.type === 'choice') {
    return (
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={locked}>
        <legend className="mb-2 p-0 text-sm font-semibold text-foreground">{field.label}</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {input.options.map((option, index) => {
            const selected = option.value === value
            const titleId = `${id}-${index}`
            return (
              <label
                key={option.value}
                className={cn(
                  'm-0 flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                  locked ? 'cursor-default opacity-70' : 'cursor-pointer',
                  selected
                    ? 'border-primary/50 bg-accent/40'
                    : 'border-border bg-card hover:bg-muted/40',
                )}
              >
                <input
                  type="radio"
                  name={field.envVar}
                  value={option.value}
                  checked={selected}
                  onChange={() => onChange(option.value)}
                  aria-labelledby={titleId}
                  aria-describedby={`${titleId}-about`}
                  className="mt-[3px] size-[18px] shrink-0 accent-[var(--color-sapphire)]"
                />
                <span className="min-w-0">
                  <span id={titleId} className="block text-sm font-semibold text-foreground">
                    {option.label}
                  </span>
                  <span id={`${titleId}-about`} className="block">
                    {option.hint && (
                      <span className="block break-words text-sm text-muted-foreground">
                        {option.hint}
                      </span>
                    )}
                    {selected && option.note && (
                      <span
                        className={cn(
                          'mt-1 block break-words text-sm font-medium',
                          option.note.tone === 'ok' ? 'text-success' : 'text-warning',
                        )}
                      >
                        {option.note.text}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
        {under}
      </fieldset>
    )
  }

  if (input.type === 'switch') {
    return (
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{field.label}</div>
          {field.description && (
            <div className="text-sm text-muted-foreground">{field.description}</div>
          )}
          {under}
        </div>
        <Switch
          label={field.label}
          checked={value === input.on}
          disabled={locked}
          onChange={(checked) => onChange(checked ? input.on : input.off)}
        />
      </div>
    )
  }

  if (input.type === 'number') {
    const scale = input.scale ?? 1
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-52">
          <label htmlFor={id} className="m-0 text-sm font-semibold text-foreground">
            {field.label}
          </label>
          {field.description && (
            <div className="text-sm text-muted-foreground">{field.description}</div>
          )}
          {under}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={input.min / scale}
            max={input.max / scale}
            step={1}
            value={value}
            disabled={locked}
            aria-invalid={problem ? true : undefined}
            onChange={(event) => onChange(event.target.value)}
            className="w-24 text-right"
          />
          {input.unit && <span>{input.unit}</span>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <label htmlFor={id} className="m-0 text-sm font-semibold text-foreground">
        {field.label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        disabled={locked}
        autoComplete="off"
        spellCheck={false}
        placeholder={field.placeholder ?? ''}
        aria-invalid={problem ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 max-w-xl font-mono"
      />
      {field.description && (
        <span className="mt-1 block text-xs text-muted-foreground">{field.description}</span>
      )}
      {under}
    </div>
  )
}

/** A key: shown as saved until it is replaced or removed, both of which wait for Save. */
function SecretSetting({
  id,
  field,
  value,
  removed,
  disabled,
  onChange,
  onRemove,
  children,
}: {
  id: string
  field: ServiceFieldState
  value: string
  removed: boolean
  disabled: boolean
  onChange: (value: string) => void
  onRemove: (removed: boolean) => void
  children: React.ReactNode
}) {
  const [replacing, setReplacing] = useState(false)
  const typing = !field.set || replacing
  return (
    <div>
      <label htmlFor={id} className="m-0 text-sm font-semibold text-foreground">
        {field.label}
      </label>
      {typing ? (
        <div className="mt-1.5 flex max-w-xl flex-wrap items-center gap-2">
          <input
            id={id}
            type="password"
            value={value}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            placeholder={field.placeholder ?? ''}
            onChange={(event) => onChange(event.target.value)}
            className="min-w-0 flex-1 basis-56 font-mono"
          />
          {field.set && (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                onChange('')
                setReplacing(false)
              }}
            >
              Keep the saved one
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex min-h-[2.65rem] max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-muted/40 px-3.5 py-1.5 text-sm">
          <span className="min-w-0 flex-1 basis-40 text-foreground">
            {removed ? (
              'Will be removed when you save.'
            ) : (
              <>
                Saved: <span className="font-mono">{field.preview ?? '•••'}</span>, stored encrypted
              </>
            )}
          </span>
          {removed ? (
            <Button variant="ghost" disabled={disabled} onClick={() => onRemove(false)}>
              Keep it
            </Button>
          ) : (
            <span className="flex gap-2">
              <Button
                id={id}
                variant="ghost"
                disabled={disabled}
                onClick={() => setReplacing(true)}
              >
                Replace
              </Button>
              <Button variant="ghost" disabled={disabled} onClick={() => onRemove(true)}>
                Remove
              </Button>
            </span>
          )}
        </div>
      )}
      {field.description && (
        <span className="mt-1 block text-xs text-muted-foreground">{field.description}</span>
      )}
      {children}
    </div>
  )
}
