// The menu a chat model is chosen from, for an Agent and for a template: the names people know,
// grouped by provider, with how much each reads and whether it sees images.

import type { ChatModelEntry } from '@bazilion/api-types'
import { Check, ChevronDown } from 'lucide-react'
import { Select } from 'radix-ui'
import { useId } from 'react'
import { menuFacts, menuGroups, modelName } from '../lib/model-facts'
import { cn } from '../lib/utils'

/** The Models overview, whose `chat` list the menu shows. */
export const MODELS_PATH = '/api/config/models'

// Radix keeps the empty string for "nothing chosen": the inherited choice needs a value of its own.
const INHERITED = ':inherited'

const ITEM =
  'relative flex cursor-pointer select-none items-baseline gap-x-3 rounded-lg py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground'

export function ModelMenu({
  label,
  value,
  onChange,
  models,
  inherited,
  required,
}: {
  label: string
  /** A `provider:model`, or the empty string for the inherited choice (or for none yet). */
  value: string
  onChange: (value: string) => void
  models: readonly ChatModelEntry[]
  /** Offers "take it from there" as the first choice, naming the model that is now. */
  inherited?: { label: string; model?: string }
  required?: boolean
}) {
  const id = useId()
  const find = (candidate: string | undefined) => models.find((model) => model.value === candidate)
  const named = (candidate: string) => {
    const model = find(candidate)
    return model ? modelName(model) : candidate
  }
  const chosen = find(value)
  const unlisted = value !== '' && !chosen
  const groups = menuGroups(models)
  const empty = models.length === 0 && !inherited

  return (
    <div className="my-[0.6rem]">
      <span id={`${id}-label`} className="block text-[0.9em] text-mocha">
        {label}
      </span>
      <Select.Root
        value={value === '' ? (inherited ? INHERITED : '') : value}
        onValueChange={(next) => onChange(next === INHERITED ? '' : next)}
        required={required}
        disabled={empty}
      >
        <Select.Trigger
          aria-labelledby={`${id}-label ${id}-value`}
          className="flex min-h-[2.65rem] w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-frost bg-[color-mix(in_srgb,var(--color-snow)_82%,var(--color-ivory))] px-[0.8rem] py-[0.5rem] text-left text-[0.95em] text-chocolate transition-all focus-visible:border-sapphire focus-visible:bg-snow focus-visible:shadow-[0_0_0_3px_var(--color-sapphire-glow)] disabled:opacity-60 data-[state=open]:border-sapphire"
          // The border and glow are the focus ring, as on the other fields.
          style={{ outline: 'none' }}
        >
          <span id={`${id}-value`} className="min-w-0 flex-1 truncate">
            {value === '' ? (
              inherited ? (
                <>
                  {inherited.model ? named(inherited.model) : inherited.label}{' '}
                  {inherited.model && (
                    <span className="ml-1 text-[0.9em] text-mocha-light">
                      {inherited.label.toLowerCase()}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-mocha-light">
                  {empty ? 'No chat model yet' : 'Pick a model'}
                </span>
              )
            ) : (
              <>
                {named(value)}{' '}
                <span className="ml-1 text-[0.9em] text-mocha-light">
                  {chosen ? chosen.providerName : 'not in Chat'}
                </span>
              </>
            )}
          </span>
          <Select.Icon asChild>
            <ChevronDown className="size-4 shrink-0 text-mocha-light" aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={6}
            className="z-50 max-h-[min(26rem,var(--radix-select-content-available-height))] w-[max(var(--radix-select-trigger-width),18rem)] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-baziu-lg"
          >
            <Select.Viewport className="p-1.5">
              {inherited && (
                <Option value={INHERITED} name={inherited.label}>
                  {inherited.model ? named(inherited.model) : ''}
                </Option>
              )}
              {unlisted && (
                <Option value={value} name={value} mono>
                  not in Chat
                </Option>
              )}
              {groups.map((group) => (
                <Select.Group key={group.provider}>
                  <Select.Label className="flex items-baseline gap-2 px-3 pb-1 pt-2.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {group.name}
                    {group.trouble && (
                      <span className="font-semibold normal-case tracking-normal text-warning">
                        {group.trouble}
                      </span>
                    )}
                  </Select.Label>
                  {group.models.map((model) => (
                    <Option
                      key={model.value}
                      value={model.value}
                      name={modelName(model)}
                      mono={!model.name}
                    >
                      {menuFacts(model)}
                    </Option>
                  ))}
                </Select.Group>
              ))}
              {models.length === 0 && (
                <p className="m-0 px-3 py-2 text-sm text-muted-foreground">
                  No chat model is in use yet.
                </p>
              )}
            </Select.Viewport>
            <a
              href="/config?pick=true"
              className="block border-t border-border px-4 py-2.5 text-sm font-semibold text-primary hover:bg-muted/50"
            >
              Add models in Setup
            </a>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  )
}

function Option({
  value,
  name,
  mono = false,
  children,
}: {
  value: string
  name: string
  mono?: boolean
  /** What is worth knowing beside the name. */
  children: React.ReactNode
}) {
  return (
    // The highlight is the focus mark of a menu row; the app's own outline would double it.
    <Select.Item value={value} className={ITEM} style={{ outline: 'none' }}>
      <Select.ItemIndicator className="absolute left-2.5 top-1/2 -translate-y-1/2">
        <Check className="size-4 text-primary" aria-hidden="true" />
      </Select.ItemIndicator>
      <Select.ItemText asChild>
        <span
          className={cn(
            'min-w-0 flex-1 break-words',
            mono ? 'font-mono text-[0.85em] font-medium' : 'font-semibold',
          )}
        >
          {name}
        </span>
      </Select.ItemText>
      {children && <span className="shrink-0 text-xs text-muted-foreground">{children}</span>}
    </Select.Item>
  )
}
