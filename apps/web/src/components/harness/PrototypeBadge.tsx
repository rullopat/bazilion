import { FlaskConical } from 'lucide-react'

interface PrototypeBadgeProps {
  compact?: boolean
  label?: string
}

export function PrototypeBadge({ compact = false, label = 'Prototype' }: PrototypeBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border border-rose-baziu/40 bg-rose-baziu/10 px-1.5 py-0.5 text-[0.68rem] font-semibold uppercase text-[#8a5558] dark:text-[#e5b0b3]"
      title="Local browser prototype; not enforced by the daemon"
    >
      <FlaskConical className="h-3 w-3" aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  )
}
