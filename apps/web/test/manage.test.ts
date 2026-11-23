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
import { expect, test } from 'vitest'
import { teamRequest } from '../src/components/TeamForm.tsx'
import {
  agentCounts,
  agentModel,
  allSkillsLine,
  attentionSource,
  attentionSummary,
  count,
  groupAgents,
  listed,
  matchesAgent,
  rosterCounts,
  rosterLine,
  severityLabel,
  skillChosenBy,
  skillSourceLabel,
  skillState,
  skillsLine,
  skillsNeedingALook,
  skillUseSentence,
  slugify,
  slugProblem,
  teamRemoveBlocker,
  templateDeleteBlocker,
  templateName,
  templateUseLine,
} from '../src/lib/manage.ts'

const team = (id: string, name: string, more: Partial<Team> = {}): Team => ({
  id,
  name,
  path: `/home/teams/${id}`,
  userMd: '',
  telegramTopicNameFormat: null,
  policyMode: 'open',
  createdAt: 0,
  ...more,
})

const agent = (name: string, teamId: string, more: Partial<Agent> = {}): Agent =>
  ({
    id: `${name.toLowerCase()}-id`,
    profileId: 'default',
    name,
    modelOverride: null,
    status: 'idle',
    teamId,
    identity: null,
    ...more,
  }) as Agent

const template = (id: string, more: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  dir: `/home/profiles/${id}`,
  defaultModel: 'lmstudio:qwen3',
  skillsMode: 'all',
  createdAt: 0,
  updatedAt: 0,
  agentCount: 0,
  defaultSkills: [],
  ...more,
})

const roster = (id: string, name: string, profiles: string[], edges = 0): TeamTemplate => ({
  id,
  name,
  userMd: null,
  policyMode: 'open',
  slots: profiles.map((profileId, index) => ({
    profileId,
    agentName: `Agent ${index + 1}`,
    modelOverride: null,
    reasoningLevel: null,
    layoutPosition: null,
  })),
  edges: Array.from({ length: edges }, () => ({ from: 0, to: 1 })),
  createdAt: 0,
  updatedAt: 0,
})

test('words for counts and lists', () => {
  expect(count(1, 'Agent')).toBe('1 Agent')
  expect(count(3, 'Agent')).toBe('3 Agents')
  expect(count(2, 'error or warning', 'errors or warnings')).toBe('2 errors or warnings')
  expect(listed([])).toBe('')
  expect(listed(['A'])).toBe('A')
  expect(listed(['A', 'B'])).toBe('A and B')
  expect(listed(['A', 'B', 'C'])).toBe('A, B and C')
})

test('an id is made from a name the way the daemon accepts it', () => {
  expect(slugify('Design studio')).toBe('design-studio')
  expect(slugify('  Café Crème: v2!  ')).toBe('cafe-creme-v2')
  expect(slugify('Ünïcode — dashes')).toBe('unicode-dashes')
  expect(slugify('***')).toBe('')
  expect(slugify('a'.repeat(60))).toHaveLength(48)
  expect(slugProblem('')).toBeUndefined()
  expect(slugProblem('design-studio')).toBeUndefined()
  expect(slugProblem('2026-launch')).toBeUndefined()
  for (const bad of ['Design', 'design studio', '-design', 'design_studio']) {
    expect(slugProblem(bad)).toBe(
      'Lowercase letters, digits and hyphens, starting with a letter or digit.',
    )
  }
})

test('Agents are grouped by Team in the Teams’ order, by name, and found by what they are', () => {
  const teams = [team('default', 'Default'), team('launch', 'Launch'), team('empty', 'Empty')]
  const agents = [
    agent('Quill', 'launch'),
    agent('Mira', 'launch', { identity: { creature: 'Owl', vibe: 'calm, decisive' } }),
    agent('Baziu', 'default'),
    agent('Atlas', 'launch', { status: 'archived' }),
    agent('Stray', 'gone'),
  ]
  const shape = (groups: ReturnType<typeof groupAgents>) =>
    groups.map((group) => [group.team.name, group.agents.map((entry) => entry.name)])

  expect(shape(groupAgents(agents, teams, 'current', ''))).toEqual([
    ['Default', ['Baziu']],
    ['Launch', ['Mira', 'Quill']],
    // A Team the list does not know is not lost: it is shown under its id.
    ['gone', ['Stray']],
  ])
  expect(shape(groupAgents(agents, teams, 'archived', ''))).toEqual([['Launch', ['Atlas']]])
  expect(shape(groupAgents(agents, teams, 'all', ''))).toEqual([
    ['Default', ['Baziu']],
    ['Launch', ['Atlas', 'Mira', 'Quill']],
    ['gone', ['Stray']],
  ])
  expect(shape(groupAgents(agents, teams, 'current', 'OWL calm'))).toEqual([['Launch', ['Mira']]])
  expect(groupAgents(agents, teams, 'current', 'zebra')).toEqual([])
  expect(matchesAgent(agents[0] as Agent, '   ')).toBe(true)
  expect(agentCounts(agents)).toEqual({ current: 4, archived: 1 })
})

test('an Agent answers with its own model or its template’s, said by name', () => {
  const chat = [
    { value: 'anthropic:claude-fable-5-2', name: 'Claude Fable 5.2', id: 'claude-fable-5-2' },
    { value: 'lmstudio:qwen3', id: 'qwen3' },
  ] as ChatModelEntry[]
  const templates = [template('default', { defaultModel: 'anthropic:claude-fable-5-2' })]
  expect(agentModel(agent('Mira', 'launch'), templates, chat)).toEqual({
    name: 'Claude Fable 5.2',
    inherited: true,
    missing: false,
  })
  expect(
    agentModel(agent('Dev', 'launch', { modelOverride: 'lmstudio:qwen3' }), templates, chat),
  ).toEqual({ name: 'qwen3', inherited: false, missing: false })
  // Not in Chat: turns on it are refused, and the page says so.
  expect(
    agentModel(agent('Old', 'launch', { modelOverride: 'openai:gpt-4' }), templates, chat),
  ).toEqual({ name: 'openai:gpt-4', inherited: false, missing: true })
  expect(agentModel(agent('Lost', 'launch', { profileId: 'gone' }), templates, chat)).toBeNull()
})

test('a template says who uses it, and why it cannot be deleted when the daemon would refuse', () => {
  const rosters = [
    roster('launch-crew', 'Launch crew', ['default', 'writer']),
    roster('pair', 'Review pair', ['writer']),
  ]
  expect(templateName(template('scratch', { name: '  ' }))).toBe('scratch')
  expect(templateName(template('writer'))).toBe('Writer')

  expect(templateUseLine(template('default', { agentCount: 8 }), rosters)).toBe(
    'Used by 8 Agents and Team template Launch crew',
  )
  expect(templateUseLine(template('writer'), rosters)).toBe(
    'Used by Team templates Launch crew and Review pair',
  )
  expect(templateUseLine(template('lonely'), rosters)).toBe('Not used yet')

  expect(templateDeleteBlocker(template('default', { agentCount: 1 }), rosters)).toBe(
    '1 Agent was spawned from it.',
  )
  expect(templateDeleteBlocker(template('default', { agentCount: 8 }), rosters)).toBe(
    '8 Agents were spawned from it.',
  )
  expect(templateDeleteBlocker(template('writer'), rosters)).toBe(
    'The Team templates Launch crew and Review pair use it.',
  )
  expect(templateDeleteBlocker(template('lonely'), rosters)).toBeNull()

  expect(skillsLine(template('a'))).toBe('All skills')
  expect(skillsLine(template('a', { skillsMode: 'selected' }))).toBe('No skills')
  expect(
    skillsLine(template('a', { skillsMode: 'selected', defaultSkills: ['brand-voice', 'git'] })),
  ).toBe('brand-voice, git')
})

test('a Team template is described by its roster', () => {
  expect(rosterLine(roster('blank', 'Blank', []))).toBe('No Agents yet')
  expect(rosterLine(roster('pair', 'Pair', ['default', 'writer']))).toBe('Agent 1, Agent 2')
  expect(rosterCounts(roster('pair', 'Pair', ['default', 'writer'], 1))).toBe(
    '2 Agents · 1 connection',
  )
  expect(teamRemoveBlocker(0)).toBeNull()
  expect(teamRemoveBlocker(4)).toBe('Move or delete its 4 Agents first.')
})

test('a skill says where it came from, what the scan found, and who chose it', () => {
  expect(skillSourceLabel(null)).toBe('Source unknown')
  expect(skillSourceLabel('openclaw')).toBe('From OpenClaw')
  expect(skillSourceLabel('uploaded:paperboat-skills.zip')).toBe('From paperboat-skills.zip')
  expect(skillSourceLabel('/home/pat/skills/')).toBe('From the folder skills')

  const skill = (name: string, more: Partial<SkillInfo> = {}): SkillInfo => ({
    name,
    description: '',
    source: null,
    importedAt: null,
    ...more,
  })
  const clean = skill('brand-voice')
  const warned = skill('minutes', {
    scanFindings: [{ code: 'unicode-stealth', severity: 'warning', message: 'hidden' }],
  })
  const risky = skill('deploy', {
    scanFindings: [
      { code: 'sensitive-reference', severity: 'danger', message: 'secrets' },
      { code: 'unicode-stealth', severity: 'warning', message: 'hidden' },
    ],
  })
  const broken = skill('pdf', { parseError: 'not valid YAML' })
  // A clean skill gets no chip: the noise of "Clean" on every row is gone.
  expect(skillState(clean)).toBeNull()
  expect(skillState(warned)).toEqual({ label: 'Check: 1 finding', tone: 'warning' })
  expect(skillState(risky)).toEqual({ label: 'Risky: 2 findings', tone: 'warning' })
  expect(skillState(broken)).toEqual({ label: 'Cannot be read', tone: 'warning' })
  expect(skillsNeedingALook([clean, warned, risky, broken]).map((entry) => entry.name)).toEqual([
    'deploy',
    'pdf',
  ])

  const templates = [
    template('default'),
    template('researcher'),
    template('writer', { skillsMode: 'selected', defaultSkills: ['brand-voice'] }),
    template('editor', { skillsMode: 'selected', defaultSkills: ['brand-voice'] }),
  ]
  expect(skillChosenBy('brand-voice', templates)).toBe('Chosen by Writer and Editor')
  expect(skillChosenBy('deploy', templates)).toBeNull()
  expect(allSkillsLine(templates)).toBe(
    'Default and Researcher attach every skill to the Agents they spawn.',
  )
  expect(allSkillsLine([template('default')])).toBe(
    'Default attaches every skill to the Agents it spawns.',
  )
  expect(allSkillsLine([template('writer', { skillsMode: 'selected' })])).toBeNull()
  expect(skillUseSentence('brand-voice', templates)).toBe(
    'Chosen by Writer and Editor; templates that take all skills attach it.',
  )
  expect(skillUseSentence('deploy', [template('writer', { skillsMode: 'selected' })])).toBe(
    'No template attaches it.',
  )
})

test('Attention says how much is open and of what kind', () => {
  const summary = (action: number, error: number, warning: number): AttentionSummary =>
    ({
      openTotal: action + error + warning,
      bySeverity: { action_required: action, error, warning },
      byKind: {},
      degraded: [],
    }) as unknown as AttentionSummary
  expect(attentionSummary(summary(0, 0, 0))).toEqual({
    tone: 'success',
    lead: 'Nothing needs you.',
    rest: 'New items appear here as they happen.',
  })
  expect(attentionSummary(summary(2, 2, 1))).toEqual({
    tone: 'warning',
    lead: '5 open items.',
    rest: '2 decisions waiting for you and 3 errors or warnings to look at.',
  })
  expect(attentionSummary(summary(0, 1, 0))).toEqual({
    tone: 'neutral',
    lead: '1 open item.',
    rest: '1 error or warning to look at.',
  })
  // What an Agent waits on is named for what it is.
  const waiting = {
    ...summary(3, 0, 0),
    byKind: { agent_question: 1, command_approval: 1 },
  } as unknown as AttentionSummary
  expect(attentionSummary(waiting).rest).toBe(
    '1 question waiting for your answer, 1 command waiting for your approval, and 1 decision waiting for you.',
  )
  expect(severityLabel('action_required')).toEqual({ label: 'Waiting for you', tone: 'warning' })
  expect(severityLabel('error').label).toBe('Error')
  expect(severityLabel('warning').label).toBe('Warning')
  const item = { agentName: 'Dev', teamName: 'Launch' } as AttentionItem
  expect(attentionSource(item)).toBe('Dev · Launch')
  expect(attentionSource({} as AttentionItem)).toBe('System')
})

test('creating a Team sends its id, its name and, for a project folder, the folder', () => {
  const base = { name: 'Design studio', id: 'design-studio', place: 'new' as const, folder: '' }
  expect(teamRequest(base)).toEqual({
    body: { id: 'design-studio', name: 'Design studio' },
    problems: {},
  })
  expect(teamRequest({ ...base, name: '  ' }).body).toEqual({ id: 'design-studio' })
  expect(teamRequest({ ...base, id: 'Design Studio' })).toEqual({
    body: null,
    problems: { id: 'Lowercase letters, digits and hyphens, starting with a letter or digit.' },
  })
  // A project folder: needed, and a full path.
  expect(teamRequest({ ...base, place: 'link' }).body).toBeNull()
  expect(teamRequest({ ...base, place: 'link', folder: 'projects/design' })).toEqual({
    body: null,
    problems: { folder: 'The full path of the folder, starting with /.' },
  })
  expect(teamRequest({ ...base, place: 'link', folder: ' /home/pat/design ' }).body).toEqual({
    id: 'design-studio',
    name: 'Design studio',
    link: '/home/pat/design',
  })
  // What was typed for a folder is not sent for a new one.
  expect(teamRequest({ ...base, folder: '/home/pat/design' }).body).not.toHaveProperty('link')
  expect(teamRequest({ ...base, id: '' }).body).toBeNull()
  // An id another Team has, or a name with nothing to make one from, says so before sending.
  expect(teamRequest(base, ['design-studio']).problems.id).toBe(
    'A Team already has this ID: choose another.',
  )
  expect(teamRequest({ ...base, name: '!!!', id: '' }).problems.id).toMatch(/type one/)
})
