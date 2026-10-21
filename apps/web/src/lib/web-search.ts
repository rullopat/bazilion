import type { OrdinarySearchStatus } from '@bazilion/api-types'
import { createServerFn } from '@tanstack/react-start'
import { daemonClient } from './daemon-client'

// Forward browser session/CSRF as usual; never convert into a provider/device bearer.
export const fetchAgentSearchStatus = createServerFn({ method: 'POST' })
  .validator((input: { agentId: string }) => input)
  .handler(async ({ data }): Promise<OrdinarySearchStatus> =>
    daemonClient().get(`/api/agents/${encodeURIComponent(data.agentId)}/search-status`),
  )
