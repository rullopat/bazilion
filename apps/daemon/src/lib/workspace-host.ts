// `screen` and `theme` (BAZ-097): what an Agent asks the web workspace to show, pushed once to the
// connected browsers. Only the tabs showing this Agent's conversation act on it.

import type { WorkspaceAction } from '@bazilion/api-types'
import type { WorkspaceHost } from '../runtime/worker/ipc-protocol.ts'
import { liveFeed } from './live.ts'

export function createWorkspaceHost(agentId: string, conversationId: string): WorkspaceHost {
  return {
    show: async (action: WorkspaceAction) => ({
      browsers: liveFeed().broadcast({ type: 'workspace', agentId, conversationId, action }),
    }),
  }
}
