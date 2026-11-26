import type { HealthReport, ToolsResponse } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConfigPage } from '../../components/ConfigPage'
import {
  BackupCard,
  HealthCard,
  RuntimeCard,
  VersionCard,
} from '../../components/setup/SystemCards'
import { daemonClient } from '../../lib/daemon-client'

const fetchSystem = createServerFn({ method: 'GET' }).handler(async () => {
  const daemon = daemonClient()
  const [health, { tools }] = await Promise.all([
    daemon.get<HealthReport>('/api/health/details'),
    daemon.get<ToolsResponse>('/api/config/tools'),
  ])
  return {
    version: health.version,
    ok: health.ok,
    problems: health.problems ?? [],
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
  const { version, ok, problems, runtime, commands } = Route.useLoaderData()
  return (
    <ConfigPage
      title="System"
      description="The installation itself: its version, its health, how Agents run commands, and a backup of everything."
    >
      <VersionCard version={version} />
      <HealthCard ok={ok} problems={problems} />
      <RuntimeCard shell={runtime} state={commands} />
      <BackupCard />
    </ConfigPage>
  )
}
