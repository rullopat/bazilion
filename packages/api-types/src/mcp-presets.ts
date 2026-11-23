// Common connections for Setup → MCP and `bazilion mcp add --preset`: third-party MCP servers for
// the services a business Team works in, with what each needs. They run on this computer as stdio
// servers; their tools that send or change something ask the operator first.

export interface McpPresetField {
  /** The environment variable it fills. */
  name: string
  label: string
  hint: string
  /** A token or a secret: typed hidden, stored encrypted, never shown again. */
  secret: boolean
}

export interface McpPresetOption {
  id: string
  label: string
  hint: string
  /** Arguments it adds to the command. */
  args?: string[]
  /** Variables it sets. */
  env?: Record<string, string>
}

export interface McpPreset {
  /** Its id, also the server's name unless another is given. */
  id: string
  title: string
  /** What Agents can do with it. */
  does: string
  command: string
  args: string[]
  /** What it needs filled in; all of them. */
  fields: McpPresetField[]
  options: McpPresetOption[]
  /** What has to be on this computer besides Node.js, which Bazilion already uses. */
  needs?: string
  /** How it signs in to the service. */
  signIn: string
  /** Something worth knowing before relying on it. */
  caveat?: string
  /** Its own setup guide. */
  guide: string
}

export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: 'microsoft365',
    title: 'Microsoft 365',
    does: 'Outlook mail and calendar, OneDrive and Excel; with a work or school account also Teams and SharePoint.',
    command: 'npx',
    args: ['-y', '@softeria/ms-365-mcp-server'],
    fields: [],
    options: [
      {
        id: 'org',
        label: 'A work or school account',
        hint: 'Adds Teams, SharePoint and shared mailboxes.',
        args: ['--org-mode'],
      },
    ],
    signIn:
      'No key to paste: once it is added, ask any Agent to sign in to Microsoft 365. Its login tool gives a link and a code to enter there, and the Agent then checks the sign-in.',
    guide: 'https://github.com/Softeria/ms-365-mcp-server',
  },
  {
    id: 'google_workspace',
    title: 'Google Workspace',
    does: 'Gmail, Calendar, Drive, Docs and Sheets.',
    command: 'uvx',
    args: ['workspace-mcp', '--tool-tier', 'core'],
    fields: [
      {
        name: 'GOOGLE_OAUTH_CLIENT_ID',
        label: 'OAuth client ID',
        hint: 'From a Google Cloud OAuth client of your own, with the Gmail, Calendar and Drive APIs turned on.',
        secret: false,
      },
      {
        name: 'GOOGLE_OAUTH_CLIENT_SECRET',
        label: 'OAuth client secret',
        hint: 'The same client’s secret.',
        secret: true,
      },
    ],
    options: [],
    needs: 'uv, which provides the uvx command.',
    signIn: 'You sign in to Google in the browser; its guide shows how to make the OAuth client.',
    guide: 'https://github.com/taylorwilsdon/google_workspace_mcp',
  },
  {
    id: 'slack',
    title: 'Slack',
    does: 'Read channels, threads and messages, and search them; post messages when you allow it.',
    command: 'npx',
    args: ['-y', 'slack-mcp-server@latest', '--transport', 'stdio'],
    fields: [
      {
        name: 'SLACK_MCP_XOXP_TOKEN',
        label: 'User token',
        hint: 'Starts with xoxp-: a Slack app’s user token, with the scopes its guide lists.',
        secret: true,
      },
    ],
    options: [
      {
        id: 'post',
        label: 'Let Agents post messages',
        hint: 'Off in this server unless turned on. Each post still asks you first.',
        env: { SLACK_MCP_ADD_MESSAGE_TOOL: 'true' },
      },
    ],
    signIn: 'The token is the sign-in: Agents act as the user who made it.',
    guide: 'https://github.com/korotovsky/slack-mcp-server',
  },
  {
    id: 'notion',
    title: 'Notion',
    does: 'Search, read and write pages and databases you share with it.',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    fields: [
      {
        name: 'NOTION_TOKEN',
        label: 'Integration secret',
        hint: 'Starts with ntn_: an internal integration’s secret. Share the pages it may use with that integration.',
        secret: true,
      },
    ],
    options: [],
    signIn: 'The integration secret is the sign-in; it sees only what you share with it.',
    caveat:
      'Notion no longer maintains this server and recommends its remote one, which needs a browser sign-in Bazilion cannot do yet. It still works with an integration secret.',
    guide: 'https://github.com/makenotion/notion-mcp-server',
  },
]

/** The server a preset makes, with the options chosen and the fields filled in. */
export function presetServer(
  preset: McpPreset,
  options: { name?: string; chosen?: readonly string[]; values?: Record<string, string> },
): { name: string; command: string; args: string[]; env: Record<string, string> } {
  const chosen = preset.options.filter((option) => options.chosen?.includes(option.id))
  return {
    name: options.name?.trim() || preset.id,
    command: preset.command,
    args: [...preset.args, ...chosen.flatMap((option) => option.args ?? [])],
    env: {
      ...Object.fromEntries(
        preset.fields
          .map((field) => [field.name, options.values?.[field.name]?.trim() ?? ''] as const)
          .filter(([, value]) => value !== ''),
      ),
      ...Object.assign({}, ...chosen.map((option) => option.env ?? {})),
    },
  }
}
