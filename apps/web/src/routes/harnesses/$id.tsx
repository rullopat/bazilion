import type { Agent, Group, Profile } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { HarnessBuilder } from '../../components/harness/HarnessBuilder'
import { LocalHarnessMigration } from '../../components/harness/LocalHarnessMigration'
import { useHarnessPrototype } from '../../hooks/use-harness-prototype'
import { getHarnessById } from '../../lib/harness-prototype'
import { daemonClient } from '../../lib/daemon-client'

interface HarnessBuilderLoaderData {
  profiles: Profile[]
  agents: Agent[]
  groups: Group[]
}

const fetchHarnessBuilderInputs = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HarnessBuilderLoaderData> => {
    const client = daemonClient()
    const [profiles, agents, groups] = await Promise.all([
      client.get<Profile[]>('/api/profiles'),
      client.get<Agent[]>('/api/agents?includeArchived=true'),
      client.get<Group[]>('/api/groups'),
    ])
    return { profiles, agents, groups }
  },
)

export const Route = createFileRoute('/harnesses/$id')({
  loader: () => fetchHarnessBuilderInputs(),
  component: HarnessBuilderPage,
})

function HarnessBuilderPage() {
  const { id } = Route.useParams()
  const { profiles, agents, groups } = Route.useLoaderData()
  const { state, hydrated } = useHarnessPrototype()
  const harness = getHarnessById(state, id)
  const destination = id.startsWith('template-') ? 'Team template import' : 'Group policy comparison'
  return (
    <div>
      <aside className="mb-4 rounded-md border border-frost bg-ivory p-4 text-sm text-mocha">
        <strong>Local-only compatibility state.</strong> Expected BAZ-017 path: {destination}.
        Nothing on this page uploads, deletes, or replaces canonical daemon policy or Team data.
      </aside>
      <HarnessBuilder harnessId={id} profiles={profiles} agents={agents} />
      {hydrated && harness && <div className="mx-auto mt-5 max-w-5xl px-4 pb-8"><LocalHarnessMigration harness={harness} groups={groups} agents={agents} /></div>}
    </div>
  )
}
