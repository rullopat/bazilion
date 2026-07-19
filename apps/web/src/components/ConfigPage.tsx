import type { ComponentProps, ReactNode } from 'react'
import { ConfigTabs } from './ConfigTabs'
import { PageHeader, PageShell, type PageSize } from './Page'

interface ConfigPageProps {
  active: ComponentProps<typeof ConfigTabs>['active']
  title: ReactNode
  description: ReactNode
  children: ReactNode
  actions?: ReactNode
  size?: PageSize
}

export function ConfigPage({
  active,
  title,
  description,
  children,
  actions,
  size = 'default',
}: ConfigPageProps) {
  return (
    <PageShell size={size}>
      <PageHeader
        eyebrow="Configuration"
        title={title}
        description={description}
        actions={actions}
      />
      <ConfigTabs active={active} className="mb-0" />
      <div className="space-y-6">{children}</div>
    </PageShell>
  )
}
