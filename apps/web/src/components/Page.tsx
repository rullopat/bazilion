import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils'

export type PageSize = 'narrow' | 'default' | 'wide'

const PAGE_SIZE_CLASS: Record<PageSize, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-5xl',
  wide: 'max-w-[1500px]',
}

interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  size?: PageSize
}

export function PageShell({ size = 'default', className, ...props }: PageShellProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full space-y-6',
        PAGE_SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  )
}

interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}
      {...props}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            {eyebrow}
          </div>
        )}
        {title && (
          <h1 className="m-0 font-display text-3xl leading-tight text-foreground sm:text-[2.1rem]">
            {title}
          </h1>
        )}
        {description && (
          <div className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

interface SectionCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: SectionCardProps) {
  const hasHeader = title || description || actions

  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-baziu-sm sm:p-6',
        className,
      )}
      {...props}
    >
      {hasHeader && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title && (
              <h2 className="m-0 font-body text-base font-semibold text-foreground">{title}</h2>
            )}
            {description && (
              <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children && <div className={cn(hasHeader && 'mt-5')}>{children}</div>}
    </section>
  )
}

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}

export function EmptyState({
  title,
  description,
  icon,
  actions,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center',
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {icon}
        </div>
      )}
      <h2 className="m-0 font-body text-base font-semibold text-foreground">{title}</h2>
      {description && (
        <div className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">{description}</div>
      )}
      {actions && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  )
}

export type StatusBadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const STATUS_BADGE_CLASS: Record<StatusBadgeVariant, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  info: 'border-primary/20 bg-accent text-accent-foreground',
  success:
    'border-success/25 bg-success/10 text-success',
  warning:
    'border-warning/25 bg-warning/10 text-warning',
  danger: 'border-danger/25 bg-danger/10 text-danger',
}

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: StatusBadgeVariant
}

export function StatusBadge({
  variant = 'neutral',
  className,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold leading-5',
        STATUS_BADGE_CLASS[variant],
        className,
      )}
      {...props}
    />
  )
}
