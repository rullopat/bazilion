// GET /api/events: a server-sent event stream that pushes what the web UI shows live, when it
// changes, instead of being asked every few seconds. Each event's `data` is one of these, as JSON;
// the SSE event name is its `type`. The first two events after connecting are the current state.

import type { AgentActivity } from './activity.ts'
import type { AttentionItem, AttentionSummary } from './attention.ts'

/** What every Agent is doing, as GET /api/activity answers. */
export interface LiveActivityEvent {
  type: 'activity'
  agents: AgentActivity[]
  /** As `ActivityResponse.roster`. */
  roster: string
}

/** What is open in Attention. */
export interface LiveAttentionEvent {
  type: 'attention'
  summary: AttentionSummary
  /** Changes whenever any item is added, updated, acknowledged or goes away. */
  revision: string
  /** The questions and commands Agents wait on now, the one that expires soonest first. */
  waiting: AttentionItem[]
}

/** The side panel's tabs, the full-width views and the Agent's sheets an Agent can open. */
export const WORKSPACE_PANEL_TABS = ['agent', 'team', 'connections', 'changes', 'files'] as const
export const WORKSPACE_VIEWS = ['connections', 'changes', 'files'] as const
export const WORKSPACE_SHEETS = [
  'schedules',
  'learning',
  'mailbox',
  'jobs',
  'helpers',
  'skills',
  'secrets',
  'telegram',
  'browser',
] as const
export const THEME_CHOICES = ['light', 'dark', 'system'] as const

/** What an Agent asks the tabs on its conversation to show (BAZ-097). */
export type WorkspaceAction =
  | { kind: 'panel'; tab: (typeof WORKSPACE_PANEL_TABS)[number] }
  | { kind: 'view'; view: (typeof WORKSPACE_VIEWS)[number] }
  | { kind: 'sheet'; sheet: (typeof WORKSPACE_SHEETS)[number] }
  /** Back to the conversation alone: no view, no sheet. */
  | { kind: 'conversation' }
  | { kind: 'theme'; theme: (typeof THEME_CHOICES)[number] }

/**
 * An Agent's `screen` or `theme` call. Only tabs that show this Agent's conversation act on it; it
 * is sent once, when it happens, and never again to a tab that connects later.
 */
export interface LiveWorkspaceEvent {
  type: 'workspace'
  agentId: string
  conversationId: string
  action: WorkspaceAction
}

export type LiveEvent = LiveActivityEvent | LiveAttentionEvent | LiveWorkspaceEvent
