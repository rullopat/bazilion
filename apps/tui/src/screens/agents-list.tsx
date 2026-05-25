import type { Agent } from '@bazilion/api-types'
import { Box, Text } from 'ink'
import { useEffect, useState } from 'react'
import type { BazilionClient } from '../client.ts'
import { ApiClientError } from '../client.ts'

interface AgentsListProps {
  client: BazilionClient
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ok'; agents: Agent[] }
  | { kind: 'setup-required' }
  | { kind: 'error'; message: string }

export function AgentsList({ client }: AgentsListProps) {
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    client
      .get<Agent[]>('/api/agents')
      .then((agents) => {
        if (!cancelled) setState({ kind: 'ok', agents })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // 409 from any data endpoint means the first-run setup gate hasn't
        // cleared yet — finish provider + model curation in the web UI or via
        // the CLI, then relaunch. Handled distinctly from generic errors so
        // the user gets actionable next steps.
        if (err instanceof ApiClientError && err.status === 409) {
          setState({ kind: 'setup-required' })
          return
        }
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [client])

  if (state.kind === 'loading') return <Text dimColor>Loading agents…</Text>

  if (state.kind === 'setup-required') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Setup not complete.</Text>
        <Text dimColor>
          Enable a provider and curate at least one model via the web UI (http://127.0.0.1:4322) or
          the CLI, then relaunch.
        </Text>
      </Box>
    )
  }

  if (state.kind === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Failed to load agents:</Text>
        <Text>{state.message}</Text>
      </Box>
    )
  }

  if (state.agents.length === 0) {
    return <Text dimColor>No agents yet. Spawn one with `bazilion agent spawn`.</Text>
  }

  return (
    <Box flexDirection="column">
      <Text bold>Agents ({state.agents.length})</Text>
      {state.agents.map((agent) => (
        <Box key={agent.id}>
          <Text color={statusColor(agent.status)}>● </Text>
          <Text>{agent.name}</Text>
          <Text dimColor>
            {'  '}
            {agent.modelOverride ?? 'profile-default'} · {agent.id.slice(0, 8)}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

function statusColor(status: Agent['status']): string {
  switch (status) {
    case 'running':
      return 'green'
    case 'archived':
      return 'gray'
    default:
      return 'cyan'
  }
}
