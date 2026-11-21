import type { HealthReport, ToolsResponse } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConfigPage } from '../../components/ConfigPage'
import { BackupCard, HealthCard, RuntimeCard } from '../../components/setup/SystemCards'
import { daemonClient } from '../../lib/daemon-client'

const fetchSystem = createServerFn({ method: 'GET' }).handler(async () => {
  const daemon = daemonClient()
  const [health, { tools }] = await Promise.all([
    daemon.get<HealthReport>('/api/health/details'),
    daemon.get<ToolsResponse>('/api/config/tools'),
  ])
  return {
    ok: health.ok,
    runtime: health.shellSecurity,
    // The same words as on the Commands card, where these are set.
    commands: tools.find((tool) => tool.id === 'commands')?.state ?? null,
  }
})

export const Route = createFileRoute('/config/system')({
  loader: () => fetchSystem(),
  component: SystemPage,
})

function SystemPage() {
  const { ok, runtime, commands } = Route.useLoaderData()
  return (
    <ConfigPage
      title="System"
      description="The installation itself: its health, how Agents run commands, and a backup of everything."
    >
      <HealthCard ok={ok} />
      <RuntimeCard shell={runtime} state={commands} />
      <BackupCard />
    </ConfigPage>
  )
}
