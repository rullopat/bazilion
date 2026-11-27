// The Agent in the workspace (BAZ-097): it opens a place in the web workspace (`screen`), switches
// the theme (`theme`), follows a long task with a card that updates (`progress`), and puts a small
// HTML or SVG page in the chat (`canvas`). `screen` and `theme` reach only the tabs showing this
// conversation; a progress card and a canvas stay in the conversation.

import {
  THEME_CHOICES,
  WORKSPACE_PANEL_TABS,
  WORKSPACE_SHEETS,
  WORKSPACE_VIEWS,
  type WorkspaceAction,
} from '@bazilion/api-types'
import type { WorkspaceHost } from '../worker/ipc-protocol.ts'
import type { FileSink } from './deliver-file.ts'
import type { ToolHandler } from './types.ts'

/** Where `screen` can go, as the Agent names it. */
const PLACES = [
  'conversation',
  ...WORKSPACE_PANEL_TABS.map((tab) => `panel:${tab}`),
  ...WORKSPACE_VIEWS.map((view) => `view:${view}`),
  ...WORKSPACE_SHEETS.map((sheet) => `sheet:${sheet}`),
] as const

const NOBODY_SAW =
  'No browser is connected, so no one saw it. The user may be on Telegram or away; say what you wanted to show in words.'

function placeAction(place: string): WorkspaceAction | null {
  if (place === 'conversation') return { kind: 'conversation' }
  const [kind, name] = place.split(':')
  if (kind === 'panel' && (WORKSPACE_PANEL_TABS as readonly string[]).includes(name ?? ''))
    return { kind: 'panel', tab: name as (typeof WORKSPACE_PANEL_TABS)[number] }
  if (kind === 'view' && (WORKSPACE_VIEWS as readonly string[]).includes(name ?? ''))
    return { kind: 'view', view: name as (typeof WORKSPACE_VIEWS)[number] }
  if (kind === 'sheet' && (WORKSPACE_SHEETS as readonly string[]).includes(name ?? ''))
    return { kind: 'sheet', sheet: name as (typeof WORKSPACE_SHEETS)[number] }
  return null
}

export function screenTool(host: WorkspaceHost): ToolHandler {
  return {
    def: {
      name: 'screen',
      description:
        "Open a place in the user's web workspace, in the browser tabs that show this conversation: a side-panel tab (panel:changes after you changed files, panel:files after you made some), a full-width view (view:changes, view:files, view:connections), one of your own pages (sheet:schedules after setting a schedule, sheet:jobs, sheet:helpers, …), or `conversation` to close views and pages. Use it when seeing the place helps the user; it changes nothing else. Tabs showing something else, Telegram and the terminal are not affected.",
      parameters: {
        type: 'object',
        properties: { place: { type: 'string', enum: [...PLACES] } },
        required: ['place'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const place = String(args.place ?? '')
      const action = placeAction(place)
      if (!action) throw new Error(`screen: unknown place "${place}"; one of ${PLACES.join(', ')}`)
      const { browsers } = await host.show(action)
      return browsers === 0
        ? NOBODY_SAW
        : `Asked the tabs showing this conversation to open ${place}. Tabs showing something else are left alone, so the user may not have seen it.`
    },
  }
}

export function themeTool(host: WorkspaceHost): ToolHandler {
  return {
    def: {
      name: 'theme',
      description:
        "Switch the web workspace to the light or the dark theme, or back to following the computer's setting (`system`), in the browser tabs that show this conversation. Only when the user asks for it.",
      parameters: {
        type: 'object',
        properties: { theme: { type: 'string', enum: [...THEME_CHOICES] } },
        required: ['theme'],
        additionalProperties: false,
      },
    },
    async invoke(args) {
      const theme = String(args.theme ?? '')
      if (!(THEME_CHOICES as readonly string[]).includes(theme))
        throw new Error(`theme: one of ${THEME_CHOICES.join(', ')}`)
      const { browsers } = await host.show({
        kind: 'theme',
        theme: theme as (typeof THEME_CHOICES)[number],
      })
      return browsers === 0
        ? NOBODY_SAW
        : `Asked the tabs showing this conversation to use the ${theme} theme. It is kept by each browser, not by you.`
    },
  }
}

const STEP_STATES = ['todo', 'doing', 'done', 'failed'] as const
type StepState = (typeof STEP_STATES)[number]

export interface ProgressStep {
  step: string
  state: StepState
  note?: string
}

/** The card a `progress` call describes, checked; throws with what is wrong. */
export function progressCard(args: Record<string, unknown>): {
  task: string
  steps: ProgressStep[]
  id?: string
} {
  const task = typeof args.task === 'string' ? args.task.trim() : ''
  if (!task) throw new Error('progress: task (the card title) is required')
  if (!Array.isArray(args.steps) || args.steps.length === 0)
    throw new Error('progress: steps is a non-empty list')
  const steps = args.steps.map((raw, index): ProgressStep => {
    const entry = (raw ?? {}) as Record<string, unknown>
    const step = typeof entry.step === 'string' ? entry.step.trim() : ''
    if (!step) throw new Error(`progress: steps[${index}].step is required`)
    const state = String(entry.state ?? 'todo')
    if (!(STEP_STATES as readonly string[]).includes(state))
      throw new Error(`progress: steps[${index}].state is one of ${STEP_STATES.join(', ')}`)
    const note = typeof entry.note === 'string' && entry.note.trim() ? entry.note.trim() : undefined
    return { step, state: state as StepState, ...(note ? { note } : {}) }
  })
  const id = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : undefined
  return { task, steps, ...(id ? { id } : {}) }
}

export function progressTool(): ToolHandler {
  return {
    def: {
      name: 'progress',
      description:
        "Show the user how far a long task has got, as a card of steps in the conversation (and one message on Telegram) that later calls update in place. Call it when you start a task of several steps, then again as steps start, finish or fail, always with the whole list. The first call answers with the card's id: pass it as `id` to update that card rather than start another. Skip it for short tasks.",
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The card to update, as the first call gave it.' },
          task: { type: 'string', description: 'What the task is, as the card title.' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                step: { type: 'string' },
                state: { type: 'string', enum: [...STEP_STATES] },
                note: { type: 'string', description: 'A short line under the step.' },
              },
              required: ['step', 'state'],
              additionalProperties: false,
            },
          },
        },
        required: ['task', 'steps'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      const card = progressCard(args)
      const id = card.id ?? context?.toolCallId
      if (!id) throw new Error('progress: missing tool call id')
      const done = card.steps.filter((step) => step.state === 'done').length
      const failed = card.steps.filter((step) => step.state === 'failed').length
      return `Progress card "${card.task}" (id ${id}): ${done} of ${card.steps.length} done${
        failed ? `, ${failed} failed` : ''
      }.${card.id ? '' : ` Pass id "${id}" to update this card.`}`
    },
  }
}

/** A file name for the canvas: the name given, with the ending its kind needs. */
function canvasName(name: string, svg: boolean): string {
  const base =
    name
      .trim()
      .replace(/[/\\]/g, '-')
      .replace(/\.(html?|svg)$/i, '')
      .slice(0, 120) || 'canvas'
  return `${base}.${svg ? 'svg' : 'html'}`
}

export function canvasTool(sink: FileSink): ToolHandler {
  return {
    def: {
      name: 'canvas',
      description:
        'Show a small HTML page or SVG drawing in the conversation: a chart, a table, a diagram, a page to look at. It is shown in a sealed frame that runs its scripts but has no network and no access to Bazilion, so put the styles, scripts and data inside the document (no CDN). It is saved as a file under Files, and Telegram gets it as a file. Give `html` or `svg`, not both.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A short file name, e.g. "sales-chart".' },
          html: { type: 'string', description: 'A whole HTML document or a fragment.' },
          svg: { type: 'string', description: 'An SVG document.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    async invoke(args, context) {
      const html = typeof args.html === 'string' ? args.html : ''
      const svg = typeof args.svg === 'string' ? args.svg : ''
      if (Boolean(html.trim()) === Boolean(svg.trim()))
        throw new Error('canvas: give exactly one of html and svg')
      if (svg && !/<svg[\s>]/i.test(svg)) throw new Error('canvas: svg must hold an <svg> element')
      if (!context?.toolCallId) throw new Error('canvas: missing tool call id')
      const name = canvasName(String(args.name ?? ''), Boolean(svg))
      const mimeType = svg ? 'image/svg+xml' : 'text/html'
      const data = Buffer.from(svg || html, 'utf8').toString('base64')
      const result = await sink({ name, mimeType, data }, context.toolCallId)
      return {
        content: [
          {
            type: 'text',
            text: `Showed "${name}" in the conversation (result ${result.resultId}).`,
          },
        ],
        details: { results: [result] },
      }
    },
  }
}

/** The workspace tools a turn gets: `progress` always, the others when their host is there. */
export function workspaceTools(opts: { host?: WorkspaceHost; fileSink?: FileSink }): ToolHandler[] {
  return [
    progressTool(),
    ...(opts.host ? [screenTool(opts.host), themeTool(opts.host)] : []),
    ...(opts.fileSink ? [canvasTool(opts.fileSink)] : []),
  ]
}
