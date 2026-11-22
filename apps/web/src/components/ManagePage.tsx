import type { ReactNode } from 'react'
import { PageHeader, PageShell, type PageSize } from './Page'
import { MANAGE_TABS, SectionTabs } from './SectionTabs'

/** A page of Manage: Agents, Teams, their templates and the skills, under one tab bar. */
export function ManagePage({
  title,
  description,
  children,
  actions,
  size = 'default',
}: {
  title: ReactNode
  description: ReactNode
  children: ReactNode
  /** The page's main action, and its rarer ones. */
  actions?: ReactNode
  size?: PageSize
}) {
  return (
    <PageShell size={size}>
      <PageHeader eyebrow="Manage" title={title} description={description} actions={actions} />
      <SectionTabs label="Manage sections" base="" tabs={MANAGE_TABS} />
      <div className="space-y-6">{children}</div>
    </PageShell>
  )
}
