import { Box, Text, useApp, useInput } from 'ink'
import { type ClientConfig, createClient } from './client.ts'
import { AgentsList } from './screens/agents-list.tsx'

interface AppProps {
  config: ClientConfig
}

export function App({ config }: AppProps) {
  const client = createClient(config)
  const { exit } = useApp()

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) exit()
  })

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          bazi
        </Text>
        <Text dimColor> · {config.serverUrl}</Text>
      </Box>
      <AgentsList client={client} />
      <Box marginTop={1}>
        <Text dimColor>q · quit</Text>
      </Box>
    </Box>
  )
}
