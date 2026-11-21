import type { McpServer } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConfigPage } from '../../components/ConfigPage'
import { AddServerCard, ServersCard } from '../../components/setup/McpCards'
import { daemonClient } from '../../lib/daemon-client'

const fetchServers = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<{ servers: McpServer[] }>('/api/mcp-servers'),
)

export const Route = createFileRoute('/config/mcp')({
  loader: () => fetchServers(),
  component: McpPage,
})

function McpPage() {
  const { servers } = Route.useLoaderData()
  const router = useRouter()
  const reload = () => router.invalidate({ sync: true })
  return (
    <ConfigPage
      title="MCP servers"
      description={
        <>
          Tools from these Model Context Protocol servers are offered to every Agent turn as{' '}
          <code>mcp__&lt;server&gt;__&lt;tool&gt;</code>. A stdio server runs as a daemon child
          process with the configured provider keys and secrets, never Bazilion's own credentials; a
          Streamable HTTP server can use a bearer token.
        </>
      }
    >
      <AddServerCard onAdded={reload} />
      <ServersCard servers={servers} onChanged={reload} />
    </ConfigPage>
  )
}
