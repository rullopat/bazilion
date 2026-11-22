// The parts every page outside the workspace is built from: a card with its heading, rows and
// lists, notices and banners, facts, check lists, chips. The form parts are in form.tsx.

import {
  AlertTriangle,
  Check,
  Info,
  type LucideIcon,
  MoreHorizontal,
  Search,
  X,
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import type { Tone } from '../../lib/model-facts'
import { cn } from '../../lib/utils'

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

/**
 * A card of a Setup page: an icon, what the card holds, its state or its main action, then its
 * rows (`CardRow`), its text and controls (`CardBody`, `CardForm`) or its facts (`Facts`).
 */
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
  /** A `Chip` with the card's state, or the button that adds to it. */
  action?: ReactNode
  /** The id the title gets: it names the card for assistive technology and for links. */
  labelledBy: string
  children?: ReactNode
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

/** A row that spans a card under its heading: the unit of every list. */
export const CARD_ROW =
  'flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 sm:px-5'

export function CardRow({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(CARD_ROW, className)} {...props} />
}

/** A card's list of things, each a `ListRow`. */
export function CardList({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cn('m-0 list-none p-0', className)} {...props} />
}

/**
 * One thing in a card's list: its name with its state, a line of what there is to know about it,
 * what can be done with it, and under all that whatever it last reported.
 */
export function ListRow({
  leading,
  title,
  chip,
  meta,
  actions,
  children,
  inline = false,
}: {
  /** The actions are small (a menu, one short button): they stay beside the name on a phone. */
  inline?: boolean
  /** An avatar or an icon before the name. */
  leading?: ReactNode
  title: ReactNode
  /** The thing's state, beside its name. */
  chip?: ReactNode
  /** Secondary facts, on one wrapping line. */
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <li className={cn(CARD_ROW, 'min-h-14 py-2.5', inline && 'flex-nowrap')}>
      {leading && <span className="flex shrink-0 self-start pt-0.5">{leading}</span>}
      <div className={cn('min-w-0 flex-1', inline ? 'basis-0' : 'basis-64')}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="min-w-0 break-words text-[0.95rem] font-semibold text-foreground">
            {title}
          </span>
          {chip}
        </div>
        {meta && (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.82rem] text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      {children && <div className="min-w-0 basis-full pb-1">{children}</div>}
    </li>
  )
}

const CARD_BODY = 'grid gap-4 border-t border-border px-4 py-4 sm:px-5'

/** The part of a card that holds text and controls, with the card's own margins. */
export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(CARD_BODY, className)} {...props} />
}

/** A card's form: the same space as `CardBody`. */
export function CardForm({ className, ...props }: ComponentProps<'form'>) {
  return <form className={cn(CARD_BODY, className)} {...props} />
}

export type NoticeTone = Tone | 'danger'

const NOTICE: Record<NoticeTone, { box: string; mark: string; icon: LucideIcon }> = {
  success: { box: 'border-success/30 bg-success/10', mark: 'text-success', icon: Check },
  warning: { box: 'border-warning/35 bg-warning/10', mark: 'text-warning', icon: AlertTriangle },
  danger: { box: 'border-danger/30 bg-danger/10', mark: 'text-danger', icon: AlertTriangle },
  neutral: { box: 'border-border bg-muted/40', mark: 'text-muted-foreground', icon: Info },
}

/** Something to know inside a card: a warning, a result, a thing to do next. */
export function Notice({
  tone = 'warning',
  title,
  children,
  actions,
  role = 'status',
  className,
}: {
  tone?: NoticeTone
  title?: ReactNode
  children?: ReactNode
  /** Buttons under the text. */
  actions?: ReactNode
  /** `alert` for what went wrong just now; `status` for what is simply so. */
  role?: 'status' | 'alert'
  className?: string
}) {
  const { box, mark, icon: Icon } = NOTICE[tone]
  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm text-foreground',
        box,
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', mark)} aria-hidden="true" />
      <div className="min-w-0 flex-1 break-words">
        {title && <div className="font-semibold">{title}</div>}
        {children}
        {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}

const BANNER: Record<NoticeTone, string> = {
  success: 'border-success/30 bg-success/10',
  warning: 'border-warning/35 bg-warning/10',
  danger: 'border-danger/30 bg-danger/10',
  neutral: 'border-border bg-card shadow-baziu-sm',
}

/** The line above a page's cards: how things stand as a whole, with the one thing to do. */
export function Banner({
  tone,
  lead,
  children,
  action,
  role = 'status',
}: {
  tone: NoticeTone
  /** The sentence that says it. */
  lead: ReactNode
  /** What follows from it, in a quieter voice. */
  children?: ReactNode
  action?: ReactNode
  role?: 'status' | 'alert'
}) {
  const Icon = tone === 'neutral' ? null : NOTICE[tone].icon
  return (
    <div
      role={role}
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm',
        BANNER[tone],
      )}
    >
      <div className={cn('flex min-w-0 flex-1 items-start gap-3', Icon ? 'basis-64' : 'basis-72')}>
        {Icon && (
          <Icon className={cn('mt-0.5 size-5 shrink-0', NOTICE[tone].mark)} aria-hidden="true" />
        )}
        <div className="min-w-0">
          <span className="font-semibold text-foreground">{lead}</span>
          {children && (
            <>
              {' '}
              <span className="text-muted-foreground">{children}</span>
            </>
          )}
        </div>
      </div>
      {action}
    </div>
  )
}

/** Facts about something: a name and what it is now, one to a row. */
export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl
      className={cn(
        'm-0 divide-y divide-border border-t border-border px-4 text-sm sm:px-5',
        className,
      )}
    >
      {children}
    </dl>
  )
}

export function Fact({
  label,
  tone,
  children,
}: {
  label: string
  /** Colours a value that is good or needs attention; left out, it is plain. */
  tone?: Tone
  children: ReactNode
}) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'm-0 min-w-0 break-words font-medium',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          (tone === undefined || tone === 'neutral') && 'text-foreground',
        )}
      >
        {children}
      </dd>
    </div>
  )
}

/** The outcome of some checks, one to a line. */
export function CheckList({ children, ...props }: ComponentProps<'ul'>) {
  return (
    <ul className="m-0 grid list-none gap-2.5 p-0" {...props}>
      {children}
    </ul>
  )
}

export function CheckItem({
  ok,
  label,
  children,
}: {
  ok: boolean
  /** What was checked. */
  label: string
  /** What was found, or what to do about it. */
  children?: ReactNode
}) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        aria-hidden="true"
        className={cn(
          'mt-px flex size-5 shrink-0 items-center justify-center rounded-full',
          ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
        )}
      >
        {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      </span>
      <span className="min-w-0 break-words">
        <span className="sr-only">{ok ? 'Passed: ' : 'Failed: '}</span>
        <span className="font-semibold text-foreground">{label}</span>
        {children && (
          <span className={cn('ml-2', ok ? 'text-muted-foreground' : 'font-medium text-warning')}>
            {children}
          </span>
        )}
      </span>
    </li>
  )
}

/** A card's line of controls above its list: a search box, a filter, an action. */
export function CardToolbar({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(CARD_ROW, 'gap-y-2 py-3', className)} {...props} />
}

/** The heading of a group of rows inside a card's list. */
export function GroupHeader({
  title,
  meta,
  action,
}: {
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={cn(CARD_ROW, 'min-h-10 bg-muted/50 py-2')}>
      <h3 className="m-0 min-w-0 font-body text-[0.72rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h3>
      {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      {action && <span className="ml-auto text-xs font-semibold">{action}</span>}
    </div>
  )
}

/** What a card shows when it has nothing to list: what would be here, and how to get it. */
export function CardEmpty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 border-t border-border px-4 py-9 text-center sm:px-5">
      {icon && (
        <span
          aria-hidden="true"
          className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          {icon}
        </span>
      )}
      <p className="m-0 text-[0.95rem] font-semibold text-foreground">{title}</p>
      {children && <p className="m-0 max-w-md text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export interface RowMenuItem {
  label: string
  onSelect: () => void
  /** A destructive action: said in the danger colour. */
  danger?: boolean
  /** Why it cannot be done now; the item is shown, disabled, with this under it. */
  disabledReason?: string | null
}

const MENU_ITEM =
  'flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[disabled]:cursor-not-allowed'

/**
 * The rarer and the destructive actions on one row, behind a "More" button: the row itself keeps
 * only what is done most.
 */
export function RowMenu({
  label,
  items,
  disabled = false,
}: {
  /** What the menu is for, e.g. "More for Mira". */
  label: string
  items: readonly (RowMenuItem | null | false)[]
  disabled?: boolean
}) {
  const shown = items.filter((item): item is RowMenuItem => Boolean(item))
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        disabled={disabled}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground disabled:opacity-50 data-[state=open]:border-border data-[state=open]:bg-card data-[state=open]:text-foreground"
      >
        <MoreHorizontal className="size-[18px]" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[13rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg"
        >
          {shown.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              disabled={Boolean(item.disabledReason)}
              onSelect={item.onSelect}
              className={MENU_ITEM}
              // The highlight is the focus mark of a menu row; the app's own outline would double it.
              style={{ outline: 'none' }}
            >
              <span
                className={cn(
                  'font-semibold',
                  item.disabledReason
                    ? 'text-muted-foreground'
                    : item.danger
                      ? 'text-danger'
                      : 'text-foreground',
                )}
              >
                {item.label}
              </span>
              {item.disabledReason && (
                <span className="text-xs text-muted-foreground">{item.disabledReason}</span>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
