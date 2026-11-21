import type { ToolsResponse } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ConfigPage } from '../../components/ConfigPage'
import { ToolCard } from '../../components/setup/ToolCard'
import { daemonClient } from '../../lib/daemon-client'

const fetchTools = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<ToolsResponse>('/api/config/tools'),
)

export const Route = createFileRoute('/config/tools')({
  loader: () => fetchTools(),
  component: ToolsPage,
})

function ToolsPage() {
  const { tools } = Route.useLoaderData()
  const router = useRouter()
  // A saved card starts again from what is stored now; the others keep what was typed in them.
  const [saves, setSaves] = useState<Record<string, number>>({})
  const [lastSaved, setLastSaved] = useState<string | null>(null)

  return (
    <ConfigPage
      title="Tools"
      description="What Agents can do besides thinking: search, read pages, browse and run commands. Every setting here applies to all Agents."
    >
      {tools.map((card) => (
        <ToolCard
          key={`${card.id}:${saves[card.id] ?? 0}`}
          card={card}
          justSaved={lastSaved === card.id}
          onSaved={async () => {
            await router.invalidate({ sync: true })
            setLastSaved(card.id)
            setSaves((current) => ({ ...current, [card.id]: (current[card.id] ?? 0) + 1 }))
          }}
        />
      ))}
    </ConfigPage>
  )
}
