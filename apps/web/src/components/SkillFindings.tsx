import type { SkillScanFinding } from '@bazilion/api-types'
import { StatusBadge } from './Page'

/** A skill's static-scan result: a "Clean" badge, or a finding count that expands to the list. */
export function FindingSummary({ findings }: { findings: SkillScanFinding[] }) {
  if (findings.length === 0) return <StatusBadge variant="success">Clean</StatusBadge>
  const danger = findings.some((finding) => finding.severity === 'danger')
  return (
    <details className="text-xs">
      <summary className="cursor-pointer list-none">
        <StatusBadge variant={danger ? 'danger' : 'warning'}>
          {findings.length} finding{findings.length === 1 ? '' : 's'}
        </StatusBadge>
      </summary>
      <div className="mt-2 min-w-64">
        <FindingList findings={findings} />
      </div>
    </details>
  )
}

export function FindingList({ findings }: { findings: SkillScanFinding[] }) {
  return (
    <ul className="m-0 space-y-1.5 pl-0">
      {findings.map((finding, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a scan's findings never reorder.
        <li key={index} className="flex items-start gap-2">
          <StatusBadge variant={finding.severity === 'danger' ? 'danger' : 'warning'}>
            {finding.severity === 'danger' ? 'Danger' : 'Warning'}
          </StatusBadge>
          <span>
            <code>{finding.code}</code>
            {finding.line ? `, line ${finding.line}` : ''} — {finding.message}
          </span>
        </li>
      ))}
    </ul>
  )
}
