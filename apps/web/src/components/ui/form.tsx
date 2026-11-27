// What a card's form is made of on the Setup pages: a labelled field, a key that is shown as
// saved, a switch with its explanation, and the Save button with the line that says where things
// stand. The cards themselves are in parts.tsx.

import { Check, ChevronDown } from 'lucide-react'
import { Select } from 'radix-ui'
import { type ReactNode, useId, useState } from 'react'
import type { Tone } from '../../lib/model-facts'
import { cn } from '../../lib/utils'
import { Button } from '../Button'
import { Switch } from './parts'

const LABEL = 'm-0 text-sm font-semibold text-foreground'
const HINT = 'mt-1 block text-xs text-muted-foreground'

/** What is wrong with a value, said under its field. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <span role="alert" className="mt-1 block text-xs font-semibold text-warning">
      {children}
    </span>
  )
}

/** A line of text to type: an address, an id, a name. Or a time of day. */
export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  problem,
  notes,
  invalid,
  disabled,
  required,
  mono = false,
  inputMode,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'time' | 'datetime-local'
  placeholder?: string
  /** What to know about it, under the field. */
  hint?: ReactNode
  /** Why the value cannot be used. */
  problem?: string
  /** Anything else to say under the field. */
  notes?: ReactNode
  /** Marks the field as wrong when `notes` carries the reason. */
  invalid?: boolean
  disabled?: boolean
  required?: boolean
  /** For ids, addresses and paths, which are read character by character. */
  mono?: boolean
  inputMode?: 'text' | 'numeric' | 'url'
  /** The field's width; a line's worth by default. */
  className?: string
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        required={required}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder ?? ''}
        aria-invalid={problem || invalid ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn('mt-1.5 max-w-xl', mono && 'font-mono', className)}
      />
      {hint && <span className={HINT}>{hint}</span>}
      {notes}
      {problem && <Problem>{problem}</Problem>}
    </div>
  )
}

/** Several lines of text: a message, a note. */
export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  problem,
  rows = 4,
  mono = false,
  disabled,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: ReactNode
  problem?: string
  rows?: number
  /** For Markdown and code, which are read as written. */
  mono?: boolean
  disabled?: boolean
  required?: boolean
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={rows}
        disabled={disabled}
        required={required}
        spellCheck={!mono}
        placeholder={placeholder ?? ''}
        aria-invalid={problem ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn('mt-1.5 w-full', mono && 'font-mono text-[0.9em]')}
      />
      {hint && <span className={HINT}>{hint}</span>}
      {problem && <Problem>{problem}</Problem>}
    </div>
  )
}

export interface Choice<Value extends string> {
  value: Value
  label: string
  /** What choosing it means. */
  hint?: ReactNode
  /** What it would meet now, said under the chosen one. */
  note?: { text: string; tone: 'ok' | 'warning' }
}

/** A choice between a few options that each need a sentence: radio cards, two abreast. */
export function ChoiceCards<Value extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled = false,
  notes,
  columns = 2,
}: {
  legend: string
  /** The radio group's name. */
  name: string
  value: Value
  options: readonly Choice<Value>[]
  onChange: (value: Value) => void
  disabled?: boolean
  notes?: ReactNode
  /** Three for short options. */
  columns?: 2 | 3
}) {
  const id = useId()
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={disabled}>
      <legend className="mb-2 p-0 text-sm font-semibold text-foreground">{legend}</legend>
      <div className={cn('grid gap-2', columns === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
        {options.map((option, index) => {
          const selected = option.value === value
          const titleId = `${id}-${index}`
          return (
            <label
              key={option.value}
              className={cn(
                'm-0 flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                disabled ? 'cursor-default opacity-70' : 'cursor-pointer',
                selected
                  ? 'border-primary/50 bg-accent/40'
                  : 'border-border bg-card hover:bg-muted/40',
              )}
            >
              <input
                type="radio"
                name={name}
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
      {notes}
    </fieldset>
  )
}

export interface SelectOption<Value extends string> {
  value: Value
  label: string
  /** A word or two beside the label in the open list. */
  hint?: string
}

// Radix keeps the empty string for "nothing chosen": an option whose value is '' gets this one.
const EMPTY = ':none'

const FIELD_TRIGGER =
  'flex min-h-[2.65rem] w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-frost bg-[color-mix(in_srgb,var(--color-snow)_82%,var(--color-ivory))] px-[0.8rem] py-[0.5rem] text-left text-[0.95em] text-chocolate transition-all focus-visible:border-sapphire focus-visible:bg-snow focus-visible:shadow-[0_0_0_3px_var(--color-sapphire-glow)] disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:border-sapphire'
const FILTER_TRIGGER =
  'inline-flex min-h-9 w-auto max-w-full items-center gap-2 rounded-[12px] border border-border bg-card py-1 pl-2.5 pr-2 text-left text-xs font-semibold text-foreground transition-all hover:border-sapphire-light focus-visible:border-sapphire focus-visible:shadow-[0_0_0_3px_var(--color-sapphire-glow)] disabled:opacity-60 data-[state=open]:border-sapphire'
const ITEM =
  'relative flex cursor-pointer select-none items-baseline gap-x-3 rounded-lg py-2 pl-8 pr-3 text-sm outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground'

/**
 * The app's one dropdown, drawn like the model menu: the choice in a field, the options in a list
 * with a tick by the chosen one. The keyboard works as in any list (arrows, letters, Enter).
 */
export function SelectMenu<Value extends string>({
  value,
  options,
  onChange,
  disabled,
  id,
  labelledBy,
  ariaLabel,
  placeholder,
  compact = false,
  className,
}: {
  value: Value
  options: readonly SelectOption<Value>[]
  onChange: (value: Value) => void
  disabled?: boolean
  /** The trigger's id, for a `<label for>`. */
  id?: string
  /** The id of what names it; its chosen value is read after the name. */
  labelledBy?: string
  /** Its name, when nothing on screen says it (a toolbar filter). */
  ariaLabel?: string
  /** What the field says while nothing is chosen. */
  placeholder?: string
  /** A toolbar filter: small, as wide as its choice. */
  compact?: boolean
  className?: string
}) {
  const valueId = useId()
  const chosen = options.find((option) => option.value === value)
  return (
    <Select.Root
      value={value === '' ? (chosen ? EMPTY : '') : value}
      onValueChange={(next) => onChange((next === EMPTY ? '' : next) as Value)}
      disabled={disabled}
    >
      <Select.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy ? `${labelledBy} ${valueId}` : undefined}
        className={cn(compact ? FILTER_TRIGGER : FIELD_TRIGGER, className)}
        // The border and glow are the focus ring, as on the other fields.
        style={{ outline: 'none' }}
      >
        <span id={valueId} className="min-w-0 flex-1 truncate">
          {chosen ? (
            chosen.label
          ) : (
            <span className="text-mocha-light">{placeholder ?? 'Choose…'}</span>
          )}
        </span>
        <Select.Icon asChild>
          <ChevronDown
            className={cn('shrink-0 text-mocha-light', compact ? 'size-3.5' : 'size-4')}
            aria-hidden="true"
          />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[max(var(--radix-select-trigger-width),12rem)] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-baziu-lg"
        >
          <Select.Viewport className="p-1.5">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value === '' ? EMPTY : option.value}
                className={ITEM}
                // The highlight is the focus mark of a list row; the app's outline would double it.
                style={{ outline: 'none' }}
              >
                <Select.ItemIndicator className="absolute left-2.5 top-1/2 -translate-y-1/2">
                  <Check className="size-4 text-primary" aria-hidden="true" />
                </Select.ItemIndicator>
                <Select.ItemText asChild>
                  <span className="min-w-0 flex-1 break-words font-semibold">{option.label}</span>
                </Select.ItemText>
                {option.hint && (
                  <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                )}
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

/** One of a few fixed choices, where a line of radio cards would be too much. */
export function SelectField<Value extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  disabled,
  placeholder,
  className,
}: {
  label: string
  value: Value
  options: readonly SelectOption<Value>[]
  onChange: (value: Value) => void
  hint?: ReactNode
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  const id = useId()
  return (
    <div>
      <label id={`${id}-label`} htmlFor={id} className={LABEL}>
        {label}
      </label>
      <SelectMenu
        id={id}
        labelledBy={`${id}-label`}
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className={cn('mt-1.5 max-w-xl', className)}
      />
      {hint && <span className={HINT}>{hint}</span>}
    </div>
  )
}

/** A filter in a card's toolbar: a small dropdown named by its label, which is read, not shown. */
export function FilterSelect<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: Value
  options: readonly SelectOption<Value>[]
  onChange: (value: Value) => void
}) {
  return (
    <SelectMenu compact ariaLabel={label} value={value} options={options} onChange={onChange} />
  )
}

/**
 * A key or token. A saved one is never shown or put back into a field: the row says that it is
 * saved, and it is replaced or removed from there. Both wait for the form's Save.
 */
export function SecretField({
  label,
  saved,
  preview,
  value,
  onChange,
  removed = false,
  onRemove,
  open = false,
  placeholder,
  hint,
  notes,
  disabled,
}: {
  label: string
  /** A value is stored. */
  saved: boolean
  /** The first characters of the stored value. */
  preview?: string
  /** What has been typed to take its place; empty keeps the stored one. */
  value: string
  onChange: (value: string) => void
  /** The stored value is to be removed with the next save. */
  removed?: boolean
  /** Left out when the value cannot be removed on its own. */
  onRemove?: (removed: boolean) => void
  /** Ask for a new value though one is stored: something else in the form needs it again. */
  open?: boolean
  placeholder?: string
  hint?: ReactNode
  notes?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  const [replacing, setReplacing] = useState(false)
  // The field was given up for the saved value: the keyboard goes back to where it came from.
  const [kept, setKept] = useState(false)
  // Remove and Keep it replace each other: focus follows to the one that appears.
  const [moved, setMoved] = useState<'keep' | 'remove' | null>(null)
  const typing = !saved || replacing || open
  return (
    <div>
      <label id={`${id}-label`} htmlFor={typing ? id : undefined} className={LABEL}>
        {label}
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
            placeholder={placeholder ?? ''}
            // Replace was pressed to type here.
            // biome-ignore lint/a11y/noAutofocus: the field appears where the pressed button was.
            autoFocus={replacing}
            onChange={(event) => onChange(event.target.value)}
            className="min-w-0 flex-1 basis-56 font-mono"
          />
          {saved && !open && (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                onChange('')
                setReplacing(false)
                setKept(true)
              }}
            >
              Keep the saved one
            </Button>
          )}
        </div>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own box and legend.
        <div
          role="group"
          aria-labelledby={`${id}-label`}
          className="mt-1.5 flex min-h-[2.65rem] max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-muted/40 px-3.5 py-1.5 text-sm"
        >
          <span className="min-w-0 flex-1 basis-40 text-foreground">
            {removed ? (
              'Will be removed when you save.'
            ) : (
              <>
                Saved: <span className="font-mono">{preview || '•••'}</span>, stored encrypted
              </>
            )}
          </span>
          {removed ? (
            <Button
              variant="ghost"
              disabled={disabled}
              autoFocus={moved === 'keep'}
              onClick={() => {
                setMoved('remove')
                onRemove?.(false)
              }}
            >
              Keep it
            </Button>
          ) : (
            <span className="flex gap-2">
              <Button
                variant="ghost"
                disabled={disabled}
                // Back to the button that opened the field.
                autoFocus={kept}
                onClick={() => setReplacing(true)}
              >
                Replace
              </Button>
              {onRemove && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  autoFocus={moved === 'remove'}
                  onClick={() => {
                    setMoved('keep')
                    onRemove(true)
                  }}
                >
                  Remove
                </Button>
              )}
            </span>
          )}
        </div>
      )}
      {hint && <span className={HINT}>{hint}</span>}
      {notes}
    </div>
  )
}

/** A yes/no setting: what it is on the left, the switch on the right. */
export function SwitchRow({
  label,
  description,
  notes,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description?: ReactNode
  notes?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{label}</div>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
        {notes}
      </div>
      <Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  )
}

/** One of several things to tick. */
export function CheckboxRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="m-0 flex items-center gap-2.5 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="m-0 size-[18px] shrink-0"
      />
      {label}
    </label>
  )
}

export interface SaveStatus {
  text: string
  tone: Tone
}

/**
 * Where a form stands, in the words every Setup form uses: what was refused, what is not saved
 * yet, what was just saved, or else what to know about saving it.
 */
export function saveStatus({
  refused = false,
  error,
  dirty,
  saved,
  savedText = 'Saved.',
  footnote = '',
}: {
  /** The daemon refused a value, and the field says why. */
  refused?: boolean
  /** Saving failed for a reason that belongs to no field. */
  error?: string | null
  /** Something differs from what is stored. */
  dirty: boolean
  /** It was saved a moment ago and nothing was touched since. */
  saved: boolean
  savedText?: string
  footnote?: string
}): SaveStatus {
  if (refused) return { text: 'Nothing was saved: see above.', tone: 'warning' }
  if (error) return { text: `Nothing was saved: ${error}`, tone: 'warning' }
  if (dirty) return { text: 'Not saved yet.', tone: 'warning' }
  if (saved) return { text: savedText, tone: 'success' }
  return { text: footnote, tone: 'neutral' }
}

const STATUS: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  neutral: 'text-muted-foreground',
}

/** A form's last line: Save, and where things stand. */
export function SaveBar({
  busy,
  disabled,
  status,
  label = 'Save',
  busyLabel = 'Saving…',
  extra,
}: {
  busy: boolean
  /** Nothing to save, or something that cannot be saved as it is. */
  disabled: boolean
  status: SaveStatus
  label?: string
  busyLabel?: string
  /** A button beside Save, such as Discard. */
  extra?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button variant="primary" type="submit" disabled={disabled || busy}>
        {busy ? busyLabel : label}
      </Button>
      {extra}
      <p
        role="status"
        className={cn('m-0 min-w-0 flex-1 basis-56 text-sm font-medium', STATUS[status.tone])}
      >
        {status.text}
      </p>
    </div>
  )
}
