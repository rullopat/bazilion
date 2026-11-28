// What the Manage pages say about Agents, Teams, templates, skills and Attention items, worked out
// from what the daemon reports. Nothing here asks the daemon anything.

import type {
  Agent,
  AttentionItem,
  AttentionSummary,
  ChatModelEntry,
  ProfileSummary,
  SkillInfo,
  Team,
  TeamTemplate,
} from '@bazilion/api-types'
import { modelName, type Tone } from './model-facts'
import { MODE_NAME } from './team-policy'

/** A chip: a few words and how loud they are. */
export interface Label {
  label: string
  tone: Tone
}

/** "A", "A and B", "A, B and C". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "1 Agent", "3 Agents": a count with its noun. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * An id the daemon accepts, made from a name: lowercase letters, digits and hyphens, starting
 * with a letter or digit. Empty when the name has none of them.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/

/** What is wrong with a typed id, or undefined when the daemon will accept it. */
export function slugProblem(id: string): string | undefined {
  if (id === '' || SLUG.test(id)) return undefined
  return 'Lowercase letters, digits and hyphens, starting with a letter or digit.'
}

// ---------------------------------------------------------------------------------------------
// Agents

export type AgentFilter = 'current' | 'archived' | 'all'

export interface AgentGroup {
  team: Team
  agents: Agent[]
}

/** Whether an Agent's name, or what its IDENTITY.md says about it, holds what was typed. */
export function matchesAgent(agent: Agent, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = [agent.name, agent.identity?.creature, agent.identity?.vibe]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return words.every((word) => text.includes(word))
}

/**
 * The Agents to show, one group per Team in the order the Teams come, each group's Agents by
 * name. A Team with none to show is left out; an Agent whose Team is unknown is not lost.
 */
export function groupAgents(
  agents: readonly Agent[],
  teams: readonly Team[],
  filter: AgentFilter,
  query: string,
): AgentGroup[] {
  const shown = agents.filter(
    (agent) =>
      (filter === 'all' ||
        (filter === 'archived' ? agent.status === 'archived' : agent.status !== 'archived')) &&
      matchesAgent(agent, query),
  )
  const known = new Set(teams.map((team) => team.id))
  const groups: AgentGroup[] = teams.map((team) => ({
    team,
    agents: shown.filter((agent) => agent.teamId === team.id),
  }))
  for (const agent of shown) {
    if (known.has(agent.teamId)) continue
    let group = groups.find((entry) => entry.team.id === agent.teamId)
    if (!group) {
      group = { team: unknownTeam(agent.teamId), agents: [] }
      groups.push(group)
    }
    group.agents.push(agent)
  }
  for (const group of groups) {
    group.agents.sort((a, b) => a.name.localeCompare(b.name))
  }
  return groups.filter((group) => group.agents.length > 0)
}

function unknownTeam(id: string): Team {
  return {
    id,
    name: id,
    path: '',
    userMd: '',
    telegramTopicNameFormat: null,
    policyMode: 'open',
    createdAt: 0,
  } as Team
}

export function agentCounts(agents: readonly Agent[]): { current: number; archived: number } {
  const archived = agents.filter((agent) => agent.status === 'archived').length
  return { current: agents.length - archived, archived }
}

export interface ModelLine {
  /** The model's name, or its id when Chat does not know it. */
  name: string
  /** It comes from the template rather than the Agent itself. */
  inherited: boolean
  /** It is not in Chat: turns on it are refused. */
  missing: boolean
}

/** The model an Agent answers with: its own, or its template's. */
export function agentModel(
  agent: Agent,
  templates: readonly ProfileSummary[],
  chat: readonly ChatModelEntry[],
): ModelLine | null {
  const value =
    agent.modelOverride ??
    templates.find((template) => template.id === agent.profileId)?.defaultModel
  if (!value) return null
  return { ...modelLine(value, chat), inherited: agent.modelOverride === null }
}

/** A model by its name when Chat knows it, and whether it is there at all. */
export function modelLine(value: string, chat: readonly ChatModelEntry[]): ModelLine {
  const entry = chat.find((model) => model.value === value)
  return { name: entry ? modelName(entry) : value, inherited: false, missing: !entry }
}

/** A template's name, or its id when it has none. */
export function templateName(template: Pick<ProfileSummary, 'id' | 'name'>): string {
  return template.name.trim() || template.id
}

// ---------------------------------------------------------------------------------------------
// Teams

export function memberCounts(agents: readonly Agent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const agent of agents) counts[agent.teamId] = (counts[agent.teamId] ?? 0) + 1
  return counts
}

export function policyLabel(mode: Team['policyMode']): Label {
  return { label: MODE_NAME[mode], tone: 'neutral' }
}

/** Why a Team cannot be removed, or null when it can. */
export function teamRemoveBlocker(members: number): string | null {
  if (members === 0) return null
  return `Move or delete its ${count(members, 'Agent')} first.`
}

// ---------------------------------------------------------------------------------------------
// Agent templates

/** The Team templates with a slot on this Agent template. */
export function teamTemplatesUsing(
  templateId: string,
  teamTemplates: readonly TeamTemplate[],
): TeamTemplate[] {
  return teamTemplates.filter((entry) => entry.slots.some((slot) => slot.profileId === templateId))
}

/** Who spawns from a template: its Agents and the Team templates that name it. */
export function templateUseLine(
  template: ProfileSummary,
  teamTemplates: readonly TeamTemplate[],
): string {
  const rosters = teamTemplatesUsing(template.id, teamTemplates)
  const parts = [
    template.agentCount > 0 ? count(template.agentCount, 'Agent') : null,
    rosters.length > 0
      ? `${rosters.length === 1 ? 'Team template' : 'Team templates'} ${listed(rosters.map((entry) => entry.name))}`
      : null,
  ].filter(Boolean)
  return parts.length > 0 ? `Used by ${parts.join(' and ')}` : 'Not used yet'
}

/** Why a template cannot be deleted, or null when it can: the daemon's own two rules. */
export function templateDeleteBlocker(
  template: ProfileSummary,
  teamTemplates: readonly TeamTemplate[],
): string | null {
  if (template.agentCount > 0) {
    return `${count(template.agentCount, 'Agent')} ${template.agentCount === 1 ? 'was' : 'were'} spawned from it.`
  }
  const rosters = teamTemplatesUsing(template.id, teamTemplates)
  if (rosters.length > 0) {
    return `${rosters.length === 1 ? 'The Team template' : 'The Team templates'} ${listed(rosters.map((entry) => entry.name))} ${rosters.length === 1 ? 'uses' : 'use'} it.`
  }
  return null
}

export function skillsLine(template: Pick<ProfileSummary, 'skillsMode' | 'defaultSkills'>): string {
  if (template.skillsMode === 'all') return 'All skills'
  if (template.defaultSkills.length === 0) return 'No skills'
  return template.defaultSkills.join(', ')
}

// ---------------------------------------------------------------------------------------------
// Team templates

export function rosterLine(template: TeamTemplate): string {
  if (template.slots.length === 0) return 'No Agents yet'
  return template.slots.map((slot) => slot.agentName).join(', ')
}

export function rosterCounts(template: TeamTemplate): string {
  return `${count(template.slots.length, 'Agent')} · ${count(template.edges.length, 'connection')}`
}

// ---------------------------------------------------------------------------------------------
// Skills

/** Where a skill was imported from, in short: a folder's last name, a ZIP file's name. */
export function skillSourceLabel(source: string | null): string {
  if (!source) return 'Source unknown'
  if (source === 'openclaw') return 'From OpenClaw'
  if (source.startsWith('uploaded:')) return `From ${source.slice('uploaded:'.length)}`
  const folder = source.replace(/\/+$/, '').split('/').pop()
  return folder ? `From the folder ${folder}` : `From ${source}`
}

/** The skill's scan, as a chip: nothing when it is clean. */
export function skillState(skill: SkillInfo): Label | null {
  if (skill.parseError) return { label: 'Cannot be read', tone: 'warning' }
  const findings = skill.scanFindings ?? []
  if (findings.length === 0) return null
  const danger = findings.some((finding) => finding.severity === 'danger')
  return {
    label: `${danger ? 'Risky' : 'Check'}: ${count(findings.length, 'finding')}`,
    tone: 'warning',
  }
}

/** The templates that chose a skill by name; those that take all skills are said once. */
export function skillChosenBy(name: string, templates: readonly ProfileSummary[]): string | null {
  const named = templates
    .filter(
      (template) => template.skillsMode === 'selected' && template.defaultSkills.includes(name),
    )
    .map(templateName)
  return named.length > 0 ? `Chosen by ${listed(named)}` : null
}

/** The templates that attach every installed skill, or null when there are none. */
export function allSkillsLine(templates: readonly ProfileSummary[]): string | null {
  const all = templates.filter((template) => template.skillsMode === 'all').map(templateName)
  if (all.length === 0) return null
  return all.length === 1
    ? `${all[0]} attaches every skill to the Agents it spawns.`
    : `${listed(all)} attach every skill to the Agents they spawn.`
}

/** Who gets a skill at spawn, as a sentence for the confirmation to remove it. */
export function skillUseSentence(name: string, templates: readonly ProfileSummary[]): string {
  const chosen = skillChosenBy(name, templates)
  const all = templates.some((template) => template.skillsMode === 'all')
  if (!chosen && !all) return 'No template attaches it.'
  const parts = [chosen, all ? 'templates that take all skills attach it' : null].filter(Boolean)
  const sentence = `${parts.join('; ')}.`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** Skills that need a look: risky findings, or a SKILL.md that cannot be read. */
export function skillsNeedingALook(skills: readonly SkillInfo[]): SkillInfo[] {
  return skills.filter(
    (skill) =>
      Boolean(skill.parseError) ||
      (skill.scanFindings ?? []).some((finding) => finding.severity === 'danger'),
  )
}

export function matchesSkill(skill: SkillInfo, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = `${skill.name} ${skill.description}`.toLowerCase()
  return words.every((word) => text.includes(word))
}

// ---------------------------------------------------------------------------------------------
// Attention

export const ATTENTION_KINDS: Record<AttentionItem['kind'], string> = {
  agent_question: 'Questions',
  command_approval: 'Commands to approve',
  trigger_failure: 'Schedule failures',
  agent_loop_break: 'Exchanges in circles',
  queue_interrupted: 'Paused queues',
  turn_failure: 'Failed turns',
}

export function severityLabel(severity: AttentionItem['severity']): Label {
  switch (severity) {
    case 'action_required':
      return { label: 'Waiting for you', tone: 'warning' }
    case 'error':
      return { label: 'Error', tone: 'warning' }
    case 'warning':
      return { label: 'Warning', tone: 'neutral' }
  }
}

/** The line above the items: how much is open and what kind it is. */
export function attentionSummary(summary: AttentionSummary): {
  tone: 'success' | 'warning' | 'neutral'
  lead: string
  rest: string
} {
  const { openTotal, bySeverity } = summary
  if (openTotal === 0) {
    return {
      tone: 'success',
      lead: 'Nothing needs you.',
      rest: 'New items appear here as they happen.',
    }
  }
  const decisions = bySeverity.action_required
  const questions = summary.byKind.agent_question ?? 0
  const commands = summary.byKind.command_approval ?? 0
  const others = decisions - questions - commands
  const problems = bySeverity.error + bySeverity.warning
  const parts = [
    questions > 0 ? `${count(questions, 'question')} waiting for your answer` : null,
    commands > 0 ? `${count(commands, 'command')} waiting for your approval` : null,
    others > 0 ? `${count(others, 'decision')} waiting for you` : null,
    problems > 0 ? `${count(problems, 'error or warning', 'errors or warnings')} to look at` : null,
  ].filter(Boolean)
  return {
    tone: decisions > 0 ? 'warning' : 'neutral',
    lead: `${count(openTotal, 'open item')}.`,
    rest: `${new Intl.ListFormat('en', { type: 'conjunction' }).format(parts as string[])}.`.replace(
      /^./,
      (first) => first.toUpperCase(),
    ),
  }
}

/** Where an item is from: its Agent and Team, or the system. */
export function attentionSource(item: AttentionItem): string {
  return [item.agentName, item.teamName].filter(Boolean).join(' · ') || 'System'
}
