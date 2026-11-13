// Agent lifecycle calls shared by the sidebar, the Agents list and the Agent page.

import { api } from './api'

const agentPath = (id: string) => `/api/agents/${encodeURIComponent(id)}`

export function archiveAgent(id: string): Promise<void> {
  return api(`${agentPath(id)}/archive`, { method: 'POST' })
}

export function unarchiveAgent(id: string): Promise<void> {
  return api(`${agentPath(id)}/unarchive`, { method: 'POST' })
}

export function deleteAgent(id: string): Promise<void> {
  return api(agentPath(id), { method: 'DELETE' })
}

export function renameAgent(id: string, name: string): Promise<void> {
  return api(agentPath(id), { method: 'PATCH', body: { name } })
}
