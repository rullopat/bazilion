// One card of the Tools page: a tool's settings, each as the thing it is (a choice, a switch, a
// number with its unit, a key), what the tool is doing now, and one Save for the card.

import type { ServiceCard, ServiceFieldState, SetFieldsResponse } from '@bazilion/api-types'
import {
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
import {
  ChoiceCards,
  Problem,
  SaveBar,
  SecretField,
  SwitchRow,
  saveStatus,
  TextField,
} from '../ui/form'
import { CardForm, Chip, Notice, SetupCard } from '../ui/parts'

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

  const status = saveStatus({
    refused: Object.keys(refused).length > 0,
    error,
    dirty,
    saved: justSaved && !touched,
    savedText: 'Saved. It applies from the next turn.',
    footnote: card.footnote,
  })

  return (
    <SetupCard
      icon={<Icon className="size-5" />}
      title={card.displayName}
      description={card.hint ?? ''}
      labelledBy={titleId}
      action={card.state && <Chip tone={TONE[card.state.tone]}>{card.state.label}</Chip>}
    >
      <CardForm onSubmit={save}>
        {card.note && <Notice tone="warning">{card.note}</Notice>}

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

        <SaveBar
          busy={busy}
          disabled={!dirty || Object.keys(problems).length > 0}
          status={status}
        />
      </CardForm>
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
      {problem && <Problem>{problem}</Problem>}
    </>
  )
  const input = field.input

  if (field.kind === 'secret') {
    return (
      <SecretField
        label={field.label}
        saved={field.set}
        preview={field.preview}
        value={value}
        removed={removed}
        disabled={disabled}
        placeholder={field.placeholder}
        hint={field.description}
        notes={under}
        onChange={onChange}
        onRemove={onRemove}
      />
    )
  }

  if (input.type === 'choice') {
    return (
      <ChoiceCards
        legend={field.label}
        name={field.envVar}
        value={value}
        options={input.options}
        disabled={locked}
        notes={under}
        onChange={onChange}
      />
    )
  }

  if (input.type === 'switch') {
    return (
      <SwitchRow
        label={field.label}
        description={field.description}
        notes={under}
        checked={value === input.on}
        disabled={locked}
        onChange={(checked) => onChange(checked ? input.on : input.off)}
      />
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
    <TextField
      label={field.label}
      value={value}
      disabled={locked}
      placeholder={field.placeholder}
      hint={field.description}
      notes={under}
      invalid={Boolean(problem)}
      mono
      onChange={onChange}
    />
  )
}
