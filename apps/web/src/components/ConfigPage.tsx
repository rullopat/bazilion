import type { ReactNode } from 'react'
import { PageHeader, PageShell, type PageSize } from './Page'
import { CONFIG_TABS, SectionTabs } from './SectionTabs'

export function ConfigPage({
  title,
  description,
  children,
  actions,
  size = 'default',
}: {
  title: ReactNode
  description: ReactNode
  children: ReactNode
  actions?: ReactNode
  size?: PageSize
}) {
  return (
    <PageShell size={size}>
      <PageHeader
        eyebrow="Configuration"
        title={title}
        description={description}
        actions={actions}
      />
      <SectionTabs label="Configuration sections" base="/config" tabs={CONFIG_TABS} />
      <div className="space-y-6">{children}</div>
    </PageShell>
  )
}
