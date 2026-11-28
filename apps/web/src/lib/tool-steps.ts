// Tool calls in words: what a running turn is doing (the rail) and what a finished step did (the
// transcript). Pure functions over a tool's name and arguments, so both read the same way.

import type { ScriptCall } from '@bazilion/api-types'

export type StepIcon =
  | 'terminal'
  | 'read'
  | 'write'
  | 'search'
  | 'web'
  | 'message'
  | 'file'
  | 'image'
  | 'note'
  | 'question'
  | 'tool'

export type StepKind = 'command' | 'read' | 'write' | 'web' | 'message' | 'deliver' | 'other'

export interface StepDescription {
  /** While it runs, after "Working:" — "writing theme.js". */
  doing: string
  /** Once done — "Wrote", followed by `target` when there is one. */
  verb: string
  /** The path, command, URL or query the step is about. */
  target: string | null
  icon: StepIcon
  kind: StepKind
}

const TARGET_CHARS = 96

function clip(value: string, limit = TARGET_CHARS): string {
  const line = value.trim().split('\n')[0] ?? ''
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

/** The last segment of a path: what a person would call the file. */
export function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || clip(url, 40)
  } catch {
    return clip(url, 40)
  }
}

/** A tool call's arguments as an object; null when they are not one. */
export function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null

/** Describe one tool call. `args` may be partial: a running turn only reports its main target. */
export function describeStep(tool: string, args: Record<string, unknown> | null): StepDescription {
  const path = str(args?.path)
  const file = path ? baseName(path) : 'a file'
  switch (tool) {
    case 'bash':
      return {
        doing: 'running a command',
        verb: 'Ran',
        target: str(args?.command) ? clip(String(args?.command)) : null,
        icon: 'terminal',
        kind: 'command',
      }
    case 'read':
      return { doing: `reading ${file}`, verb: 'Read', target: path, icon: 'read', kind: 'read' }
    case 'write':
      return { doing: `writing ${file}`, verb: 'Wrote', target: path, icon: 'write', kind: 'write' }
    case 'edit':
      return {
        doing: `editing ${file}`,
        verb: 'Edited',
        target: path,
        icon: 'write',
        kind: 'write',
      }
    case 'grep':
    case 'find':
      return {
        doing: 'searching the files',
        verb: 'Searched for',
        target: str(args?.pattern) ? clip(String(args?.pattern)) : null,
        icon: 'search',
        kind: 'read',
      }
    case 'ls':
      return {
        doing: 'listing files',
        verb: 'Listed',
        target: path ?? '.',
        icon: 'search',
        kind: 'read',
      }
    case 'web_search':
      return {
        doing: 'searching the web',
        verb: 'Searched the web for',
        target: str(args?.query) ? clip(String(args?.query)) : null,
        icon: 'web',
        kind: 'web',
      }
    case 'x_search':
      return {
        doing: 'searching posts on X',
        verb: 'Searched X for',
        target: str(args?.query) ? clip(String(args?.query)) : null,
        icon: 'web',
        kind: 'web',
      }
    case 'web_fetch':
    case 'browser_navigate': {
      const url = str(args?.url)
      return {
        doing: url ? `reading ${hostOf(url)}` : 'reading a web page',
        verb: 'Opened',
        target: url ? clip(url) : null,
        icon: 'web',
        kind: 'web',
      }
    }
    case 'browser_take_screenshot':
      return {
        doing: 'taking a screenshot',
        verb: 'Took a screenshot',
        target: null,
        icon: 'image',
        kind: 'web',
      }
    case 'send_message':
      return {
        doing: 'messaging a teammate',
        verb: 'Messaged',
        target: str(args?.to),
        icon: 'message',
        kind: 'message',
      }
    case 'read_inbox':
      return {
        doing: 'reading its inbox',
        verb: 'Read its inbox',
        target: null,
        icon: 'message',
        kind: 'other',
      }
    case 'wait_for_reply':
      return {
        doing: 'waiting for a reply',
        verb: 'Waited for a reply',
        target: null,
        icon: 'message',
        kind: 'other',
      }
    case 'deliver_file':
      return {
        doing: `delivering ${file}`,
        verb: 'Delivered',
        target: path,
        icon: 'file',
        kind: 'deliver',
      }
    case 'image_generate':
      return {
        doing: 'drawing an image',
        verb: 'Generated an image',
        target: null,
        icon: 'image',
        kind: 'deliver',
      }
    case 'memory_write':
      return {
        doing: 'saving a note',
        verb: 'Saved the note',
        target: str(args?.key),
        icon: 'note',
        kind: 'other',
      }
    case 'memory_read':
      return {
        doing: 'reading a note',
        verb: 'Read the note',
        target: str(args?.key),
        icon: 'note',
        kind: 'other',
      }
    case 'memory_search':
      return {
        doing: 'searching the notes',
        verb: 'Searched the notes for',
        target: str(args?.query) ? clip(String(args?.query)) : null,
        icon: 'note',
        kind: 'other',
      }
    case 'memory_list':
      return {
        doing: 'listing the notes',
        verb: 'Listed the notes',
        target: null,
        icon: 'note',
        kind: 'other',
      }
    case 'recall':
      // The summarized messages, a lookup like grep: a search names its words; a read's numbers
      // mean nothing to a person.
      return str(args?.query)
        ? {
            doing: 'searching older messages',
            verb: 'Searched older messages for',
            target: clip(String(args?.query)),
            icon: 'search',
            kind: 'read',
          }
        : {
            doing: 'rereading older messages',
            verb: 'Reread older messages',
            target: null,
            icon: 'read',
            kind: 'read',
          }
    case 'user_md_get':
      return {
        doing: 'reading USER.md',
        verb: 'Read USER.md',
        target: null,
        icon: 'read',
        kind: 'other',
      }
    case 'user_md_write':
      return {
        doing: 'updating USER.md',
        verb: 'Updated USER.md',
        target: null,
        icon: 'write',
        kind: 'other',
      }
    case 'ask_user':
      return {
        doing: 'asking you a question',
        verb: 'Asked you a question',
        target: null,
        icon: 'question',
        kind: 'other',
      }
    case 'view_image':
      return {
        doing: 'looking at pictures',
        verb: 'Looked at',
        target: (() => {
          const count = ['paths', 'urls', 'results']
            .map((key) => (Array.isArray(args?.[key]) ? (args?.[key] as unknown[]).length : 0))
            .reduce((a, b) => a + b, 0)
          return count === 1 ? 'a picture' : `${count} pictures`
        })(),
        icon: 'image',
        kind: 'read',
      }
    case 'pdf_read':
      return {
        doing: `reading ${baseName(String(args?.path ?? 'a PDF'))}`,
        verb: 'Read',
        target: str(args?.path) ? String(args?.path) : null,
        icon: 'read',
        kind: 'read',
      }
    case 'helper_start':
      return {
        doing: 'starting a helper',
        verb: 'Started a helper for',
        target: str(args?.task) ? clip(String(args?.task).split('\n')[0] ?? '') : null,
        icon: 'tool',
        kind: 'other',
      }
    case 'helper_wait':
      return {
        doing: 'waiting for its helpers',
        verb: 'Waited for its helpers',
        target: null,
        icon: 'tool',
        kind: 'other',
      }
    case 'helper_stop':
      return {
        doing: 'stopping a helper',
        verb: 'Stopped a helper',
        target: null,
        icon: 'tool',
        kind: 'other',
      }
    case 'secret_request':
      return {
        doing: 'asking you for a secret',
        verb: 'Asked you for',
        target: str(args?.name) ? String(args?.name) : null,
        icon: 'question',
        kind: 'other',
      }
    case 'secret_list':
      return {
        doing: 'listing its secrets',
        verb: 'Listed its secrets',
        target: null,
        icon: 'note',
        kind: 'other',
      }
    case 'schedule_add':
      return {
        doing: 'setting a schedule',
        verb: 'Set a schedule',
        target: null,
        icon: 'note',
        kind: 'other',
      }
    case 'schedule_list':
      return {
        doing: 'listing its schedules',
        verb: 'Listed its schedules',
        target: null,
        icon: 'note',
        kind: 'other',
      }
    case 'schedule_remove':
      return {
        doing: 'removing a schedule',
        verb: 'Removed a schedule',
        target: null,
        icon: 'note',
        kind: 'other',
      }
    case 'browser_use': {
      // Which browser the conversation works in from here on (BAZ-102).
      const yours = args?.browser === 'yours'
      return {
        doing: yours ? 'moving to your Chrome' : 'moving to its own browser',
        verb: yours ? 'Moved to your Chrome' : 'Moved to its own browser',
        target: null,
        icon: 'web',
        kind: 'web',
      }
    }
    case 'codemode':
      // A script that calls the Agent's tools (BAZ-100); the calls it made show under it.
      return {
        doing: 'running a script',
        verb: 'Ran a script',
        target: null,
        icon: 'terminal',
        kind: 'command',
      }
    case 'tool_search':
      return {
        doing: 'searching its tools',
        verb: 'Searched tools for',
        target: str(args?.query) ? clip(String(args?.query)) : null,
        icon: 'search',
        kind: 'read',
      }
    default:
      break
  }
  if (tool.startsWith('home_')) {
    const own = str(args?.file)
    return tool === 'home_write' || tool === 'home_edit'
      ? {
          doing: 'updating its own files',
          verb: 'Updated its file',
          target: own,
          icon: 'write',
          kind: 'other',
        }
      : {
          doing: 'reading its own files',
          verb: 'Read its file',
          target: own,
          icon: 'read',
          kind: 'other',
        }
  }
  if (tool.startsWith('browser_')) {
    return {
      doing: 'using the browser',
      verb: 'In the browser:',
      target: tool.slice('browser_'.length).replaceAll('_', ' '),
      icon: 'web',
      kind: 'web',
    }
  }
  return { doing: `using ${tool}`, verb: 'Used', target: tool, icon: 'tool', kind: 'other' }
}

const CALL_MARK: Record<ScriptCall['status'], string> = {
  ok: '✓',
  error: '✗',
  cancelled: '–',
  running: '…',
  unfinished: '…',
}

/** "✓ memory_search" per line: the calls a script made, as its step lists them. */
export function scriptCallsText(calls: readonly ScriptCall[]): string {
  return calls.map((call) => `${CALL_MARK[call.status]} ${call.name}`).join('\n')
}

const KIND_LABEL: Record<StepKind, [one: string, many: string]> = {
  command: ['command', 'commands'],
  read: ['lookup', 'lookups'],
  write: ['file written', 'files written'],
  web: ['web step', 'web steps'],
  message: ['message', 'messages'],
  deliver: ['file delivered', 'files delivered'],
  other: ['more', 'more'],
}

/** "2 commands, 1 lookup, 3 files written" for a group of steps. */
export function summarizeSteps(kinds: readonly StepKind[]): string {
  const order: StepKind[] = ['command', 'read', 'write', 'web', 'message', 'deliver', 'other']
  return order
    .map((kind) => {
      const count = kinds.filter((entry) => entry === kind).length
      if (count === 0) return null
      const [one, many] = KIND_LABEL[kind]
      return `${count} ${count === 1 ? one : many}`
    })
    .filter(Boolean)
    .join(', ')
}

/** Lines a write or an edit added and removed, from its arguments; null for other tools. */
export function lineChange(
  tool: string,
  args: Record<string, unknown> | null,
): { added: number; removed: number } | null {
  const lines = (value: unknown) =>
    typeof value === 'string' && value.length > 0 ? value.replace(/\n$/, '').split('\n').length : 0
  if (tool === 'write') return { added: lines(args?.content), removed: 0 }
  if (tool !== 'edit' || !Array.isArray(args?.edits)) return null
  let added = 0
  let removed = 0
  for (const edit of args.edits as Array<Record<string, unknown>>) {
    added += lines(edit?.newText)
    removed += lines(edit?.oldText)
  }
  return { added, removed }
}
