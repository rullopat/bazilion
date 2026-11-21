import type { CatalogModel, ProviderConfigEntry, ProviderFailure } from '@bazilion/api-types'
import { AlertTriangle, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { factsLine, modelName, priceLine, providerStatus, type Tone } from '../../lib/model-facts'
import { cn } from '../../lib/utils'

/** A provider's initial on a tile: no logos, they are other companies' marks. */
export function ProviderAvatar({
  name,
  tone = 'neutral',
  className,
}: {
  name: string
  tone?: Tone | 'accent'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-xl text-[0.95rem] font-bold',
        tone === 'success' && 'bg-success/10 text-success',
        tone === 'warning' && 'bg-warning/10 text-warning',
        tone === 'accent' && 'bg-accent text-accent-foreground',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1) || '?'}
    </span>
  )
}

const CHIP: Record<Tone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  neutral: 'bg-muted text-muted-foreground',
}

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold',
        CHIP[tone],
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  )
}

/** What a provider is doing for Agents, as a chip. */
export function StateChip({ provider, now }: { provider: ProviderConfigEntry; now: number }) {
  const status = providerStatus(provider, now)
  return <Chip tone={status.tone}>{status.label}</Chip>
}

/** A failed test: what happened, what to do, and the provider's own words one click away. */
export function FailureBox({
  failure,
  children,
}: {
  failure: ProviderFailure
  children?: ReactNode
}) {
  return (
    <div role="alert" className="rounded-2xl border border-warning/35 bg-warning/10 p-4 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground">{failure.title}</div>
          <div className="mt-0.5 text-muted-foreground">{failure.hint}</div>
          {failure.detail && (
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold">Details</summary>
              <div className="mt-1 break-words font-mono">{failure.detail}</div>
            </details>
          )}
        </div>
      </div>
      {children && <div className="mt-3 flex flex-wrap justify-end gap-2">{children}</div>}
    </div>
  )
}

/** A search box: the magnifier and the input are one field, with one focus ring. */
export function SearchField({
  label,
  placeholder,
  value,
  onChange,
  className,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label
      className={cn(
        'm-0 flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 transition-shadow focus-within:border-primary focus-within:bg-card focus-within:shadow-[0_0_0_3px_var(--color-sapphire-glow)]',
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 border-0 bg-transparent px-0 shadow-none focus:bg-transparent focus:shadow-none"
        // The label carries the focus ring; the app's own input outline is not layered CSS.
        style={{ outline: 'none' }}
      />
    </label>
  )
}

/**
 * One model in a list to tick: its name and id, what it can do, what it costs. On a narrow screen
 * the facts sit under the name instead of beside it.
 */
export function ModelRow({
  model,
  connect,
  checked,
  disabled,
  onToggle,
  className,
}: {
  model: CatalogModel
  connect: ProviderConfigEntry['connect']
  checked: boolean
  disabled: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <label
      className={cn(
        'm-0 grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-b border-border py-2.5 sm:grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1.2fr)_9.5rem]',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="m-0 size-[18px]"
      />
      <span className="min-w-0">
        <span className="text-sm font-semibold text-foreground">{modelName(model)}</span>
        {model.suggested && (
          <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[0.7rem] font-semibold text-accent-foreground">
            Suggested
          </span>
        )}
        {model.name && (
          <span className="block break-all font-mono text-[0.72rem] text-muted-foreground">
            {model.id}
          </span>
        )}
      </span>
      <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto">
        {factsLine(model, connect)}
      </span>
      <span className="col-start-2 text-xs text-foreground sm:col-start-auto sm:text-right">
        {priceLine(model, connect)}
      </span>
    </label>
  )
}

/** A yes/no setting. */
export function Switch({
  checked,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-[46px] shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-fawn',
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] size-[22px] rounded-full bg-white shadow transition-[left]',
          checked ? 'left-[21px]' : 'left-[3px]',
        )}
      />
    </button>
  )
}

/** Something is being waited for. */
export function Waiting({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-3 text-sm font-semibold text-foreground">
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
        <span className="size-2.5 animate-pulse rounded-full bg-primary" />
      </span>
      <span>{children}</span>
    </div>
  )
}

/** A card of the Models page: an icon, what it holds, an action, then its rows. */
export function SetupCard({
  icon,
  title,
  description,
  action,
  labelledBy,
  children,
}: {
  icon: ReactNode
  title: string
  description: ReactNode
  action?: ReactNode
  labelledBy: string
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h2
              id={labelledBy}
              className="m-0 font-body text-[1.05rem] font-semibold text-foreground"
            >
              {title}
            </h2>
            <div className="text-sm text-muted-foreground">{description}</div>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
