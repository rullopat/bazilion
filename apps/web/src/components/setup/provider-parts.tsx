// The parts of the Models page and its dialogs that are about providers and their models.

import type { CatalogModel, ProviderConfigEntry, ProviderFailure } from '@bazilion/api-types'
import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { factsLine, modelName, priceLine, providerStatus, type Tone } from '../../lib/model-facts'
import { cn } from '../../lib/utils'
import { Chip } from '../ui/parts'

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
        'flex size-9 shrink-0 items-center justify-center rounded-xl text-base font-bold',
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
          <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
            Suggested
          </span>
        )}
        {model.name && (
          <span className="block break-all font-mono text-xs text-muted-foreground">
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
