import type { HealthReport } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { BackupCard } from '../../components/BackupCard'
import { ConfigPage } from '../../components/ConfigPage'
import { InstallationReadinessCard } from '../../components/InstallationReadinessCard'
import { RuntimeCard } from '../../components/RuntimeCard'
import { daemonClient } from '../../lib/daemon-client'

const fetchSystem = createServerFn({ method: 'GET' }).handler(async () => {
  const health = await daemonClient().get<HealthReport>('/api/health/details')
  return { ok: health.ok, runtime: health.shellSecurity }
})

export const Route = createFileRoute('/config/system')({
  loader: () => fetchSystem(),
  component: SystemPage,
})

function SystemPage() {
  const { ok, runtime } = Route.useLoaderData()
  return (
    <ConfigPage
      title="System"
      description="The installation itself: its health, how Agents run commands, and a backup of everything."
    >
      <InstallationReadinessCard report={{ ok }} />
      <RuntimeCard shell={runtime} />
      <BackupCard />
    </ConfigPage>
  )
}
