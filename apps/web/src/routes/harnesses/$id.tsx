import type { Agent, Profile } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { HarnessBuilder } from '../../components/harness/HarnessBuilder'
import { daemonClient } from '../../lib/daemon-client'

interface HarnessBuilderLoaderData {
  profiles: Profile[]
  agents: Agent[]
}

const fetchHarnessBuilderInputs = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HarnessBuilderLoaderData> => {
    const client = daemonClient()
    const [profiles, agents] = await Promise.all([
      client.get<Profile[]>('/api/profiles'),
      client.get<Agent[]>('/api/agents?includeArchived=true'),
    ])
    return { profiles, agents }
  },
)

export const Route = createFileRoute('/harnesses/$id')({
  loader: () => fetchHarnessBuilderInputs(),
  component: HarnessBuilderPage,
})

function HarnessBuilderPage() {
  const { id } = Route.useParams()
  const { profiles, agents } = Route.useLoaderData()
  const destination = id.startsWith('template-') ? 'Team template import' : 'Group policy comparison'
  return (
    <div>
      <aside className="mb-4 rounded-md border border-frost bg-ivory p-4 text-sm text-mocha">
        <strong>Local-only compatibility state.</strong> Expected BAZ-017 path: {destination}.
        Nothing on this page uploads, deletes, or replaces canonical daemon policy or Team data.
      </aside>
      <HarnessBuilder harnessId={id} profiles={profiles} agents={agents} />
    </div>
  )
}
