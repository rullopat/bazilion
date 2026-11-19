// The workspace's address: everything the page shows is in the query string of `/`, so a link
// (from Attention, a saved file, the palette) lands on the same screen the rail would open.

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)

export const PANEL_TABS = ['agent', 'team', 'connections', 'changes', 'files'] as const
export type PanelTab = (typeof PANEL_TABS)[number]

/** The three screens that take the whole width, with the Agent list folded to avatars. */
export const FOCUS_VIEWS = ['connections', 'changes', 'files'] as const
export type FocusView = (typeof FOCUS_VIEWS)[number]

export const PANEL_LABELS: Record<PanelTab, string> = {
  agent: 'Agent',
  team: 'Team',
  connections: 'Connections',
  changes: 'Changes',
  files: 'Files',
}

export interface WorkspaceSearch {
  /** The Agent whose conversation is open. */
  agent?: string
  /** The Team in view when no Agent is selected; an Agent's own Team otherwise. */
  team?: string
  /** The side panel's tab; `none` hides the panel. */
  panel?: PanelTab | 'none'
  /** A full-width view of the Team. */
  view?: FocusView
  /** The changed path selected in Changes. */
  file?: string
  /** The saved file selected in Files. */
  result?: string
  /** An earlier conversation being read. */
  conversation?: string
  /** A sheet opened over the workspace: one of the Agent's or the Team's deeper pages. */
  section?: Section
  /** The Team memory note the memory sheet opens on. */
  note?: string
}

/** Sheets of the Agent tab. */
export const AGENT_SECTIONS = [
  'schedules',
  'learning',
  'mailbox',
  'skills',
  'telegram',
  'browser',
] as const
export type AgentSection = (typeof AGENT_SECTIONS)[number]

/** Sheets of the Team tab. */
export const TEAM_SECTIONS = ['user-md', 'memory', 'settings'] as const
export type TeamSection = (typeof TEAM_SECTIONS)[number]

export type Section = AgentSection | TeamSection
const SECTIONS: readonly Section[] = [...AGENT_SECTIONS, ...TEAM_SECTIONS]

export const isAgentSection = (value: unknown): value is AgentSection =>
  isOneOf(AGENT_SECTIONS, value)
export const isTeamSection = (value: unknown): value is TeamSection => isOneOf(TEAM_SECTIONS, value)

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/** The search params the workspace understands; anything else is dropped. */
export function parseWorkspaceSearch(search: Record<string, unknown>): WorkspaceSearch {
  const panel = search.panel
  return {
    agent: text(search.agent),
    team: text(search.team),
    panel: panel === 'none' || isOneOf(PANEL_TABS, panel) ? panel : undefined,
    view: isOneOf(FOCUS_VIEWS, search.view) ? search.view : undefined,
    file: text(search.file),
    result: text(search.result),
    conversation: text(search.conversation),
    section: isOneOf(SECTIONS, search.section) ? search.section : undefined,
    note: text(search.note),
  }
}

/**
 * Cookie that remembers the side panel between visits, so the first paint has it: the last tab,
 * prefixed with `none:` while the panel is hidden.
 */
export const PANEL_COOKIE = 'bz_panel'

export interface PanelMemory {
  open: boolean
  /** The tab the panel shows, or reopens on. */
  tab: PanelTab
}

export function parsePanelCookie(raw: string | undefined): PanelMemory {
  const hidden = raw?.startsWith('none:') ?? false
  const tab = hidden ? raw?.slice(5) : raw
  return { open: !hidden, tab: isOneOf(PANEL_TABS, tab) ? tab : 'team' }
}

export function writePanelCookie(memory: PanelMemory): void {
  const value = memory.open ? memory.tab : `none:${memory.tab}`
  // biome-ignore lint/suspicious/noDocumentCookie: a plain UI preference shared with SSR.
  document.cookie = `${PANEL_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`
}
