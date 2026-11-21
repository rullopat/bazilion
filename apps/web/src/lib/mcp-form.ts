// The "Add a server" form of the MCP page: what it sends, and what the daemon would refuse,
// said before it is sent.

import type { McpServerInput, McpTransport } from '@bazilion/api-types'

export interface McpDraft {
  name: string
  transport: McpTransport
  /** stdio: the executable. */
  command: string
  /** stdio: its arguments, separated by spaces. */
  args: string
  /** http: the endpoint. */
  url: string
  /** http: a bearer token, if the server wants one. */
  token: string
}

export const EMPTY_MCP_DRAFT: McpDraft = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  token: '',
}

export interface McpForm {
  /** What to say under a field that cannot be saved as typed. */
  problems: { name?: string; url?: string }
  /** What is still needed, once something was typed; null when nothing is missing. */
  missing: string | null
  /** What Add sends; null while something is missing or wrong. */
  body: McpServerInput | null
}

/** The daemon's own rule for an endpoint: http(s), no credentials in it, no fragment. */
function endpointProblem(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return 'An http:// or https:// address.'
    if (url.username || url.password) {
      return 'No user name or password in the address: a token goes in the field beside it.'
    }
    if (url.hash) return 'An address without a # part.'
    return undefined
  } catch {
    return 'An http:// or https:// address.'
  }
}

export function mcpServerForm(draft: McpDraft): McpForm {
  const name = draft.name.trim()
  const command = draft.command.trim()
  const url = draft.url.trim()
  const problems: McpForm['problems'] = {}
  // The name is the middle of every tool's name, mcp__<name>__<tool>.
  if (name && !/^[a-zA-Z0-9_]+$/.test(name)) {
    problems.name = 'Letters, digits and underscores only: its tools are named after it.'
  }
  const stdio = draft.transport === 'stdio'
  if (!stdio && url) {
    const problem = endpointProblem(url)
    if (problem) problems.url = problem
  }
  const complete = name !== '' && (stdio ? command !== '' : url !== '')
  const started = [name, command, draft.args.trim(), url, draft.token].some((value) => value !== '')
  const missing =
    started && !complete
      ? stdio
        ? 'A stdio server needs a name and a command.'
        : 'An http server needs a name and a URL.'
      : null
  if (!complete || problems.name || problems.url) return { problems, missing, body: null }
  return {
    problems,
    missing,
    body: {
      name,
      transport: draft.transport,
      command: stdio ? command : null,
      args: stdio ? draft.args.split(' ').filter(Boolean) : [],
      url: stdio ? null : url,
      authToken: !stdio && draft.token ? draft.token : undefined,
    },
  }
}

/** How many servers Agents are offered, as a card's state. */
export function serversState(
  servers: readonly { enabled: boolean }[],
): { label: string; tone: 'success' | 'neutral' } | null {
  if (servers.length === 0) return null
  const on = servers.filter((server) => server.enabled).length
  if (on === 0) return { label: 'None on', tone: 'neutral' }
  if (on === servers.length) {
    return { label: on === 1 ? '1 server on' : `${on} servers on`, tone: 'success' }
  }
  return { label: `${on} of ${servers.length} on`, tone: 'success' }
}
