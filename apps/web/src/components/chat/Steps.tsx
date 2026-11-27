// What an Agent did between two pieces of text: its tool calls as short sentences, the messages
// it handed to teammates as cards, and a way to the diff when it wrote files.

import { type Agent, chosenName } from '@bazilion/api-types'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Code2,
  FileText,
  Globe,
  Image as ImageIcon,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  PencilLine,
  Search,
  StickyNote,
  Terminal,
  Wrench,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useActivityOptional } from '../../lib/activity'
import {
  describeStep,
  lineChange,
  parseArgs,
  type StepIcon,
  summarizeSteps,
} from '../../lib/tool-steps'
import { AgentAvatar } from '../AgentAvatar'
import { useWorkspaceOptional, type WorkspaceValue } from '../workspace/context'
import { pairSteps, type Step, type ToolItem } from './entries'
import { ProgressCards } from './Progress'

const ICONS: Record<StepIcon, LucideIcon> = {
  terminal: Terminal,
  read: BookOpen,
  write: PencilLine,
  search: Search,
  web: Globe,
  message: MessageSquare,
  file: FileText,
  image: ImageIcon,
  note: StickyNote,
  question: CircleHelp,
  tool: Wrench,
}

/** Groups longer than this start folded to their summary line. */
const OPEN_UP_TO = 6
const DETAIL_LINES = 40
const OUTPUT_CHARS = 6_000

const CODE =
  'rounded-md bg-frost px-1.5 py-px font-mono text-[0.86em] text-chocolate [overflow-wrap:anywhere]'

export function StepsBlock({ items, dimmed = false }: { items: ToolItem[]; dimmed?: boolean }) {
  const all = pairSteps(items)
  const handoffs = all.filter((step) => step.name === 'send_message')
  // Progress calls show as their card, once per task, not as steps (BAZ-097).
  const progress = all.filter((step) => step.name === 'progress')
  const steps = all.filter((step) => step.name !== 'send_message' && step.name !== 'progress')
  const written = [
    ...new Set(
      steps
        .filter((step) => step.status === 'done' && (step.name === 'write' || step.name === 'edit'))
        .map((step) => parseArgs(step.args)?.path)
        .filter((path): path is string => typeof path === 'string'),
    ),
  ]
  return (
    <div className={dimmed ? 'opacity-40' : undefined}>
      {steps.length > 0 && <StepList steps={steps} />}
      {progress.length > 0 && <ProgressCards steps={progress} />}
      {handoffs.length > 0 && <Handoffs steps={handoffs} />}
      {written.length > 0 && <WrittenFiles paths={written} />}
    </div>
  )
}

/**
 * Whether a running step is the Agent waiting on the operator: its question, or the command it
 * needs approved. Those read "waiting for you", in the colour of everything that waits on you.
 */
function useWaitsOnYou(): (step: Step) => boolean {
  const workspace = useWorkspaceOptional()
  const activity = useActivityOptional()
  const agentId = workspace?.agent?.agent.id
  const blocked = agentId !== undefined && activity?.stateOf(agentId).kind === 'needs'
  return (step) =>
    blocked && step.status === 'running' && (step.name === 'ask_user' || step.name === 'bash')
}

function StepList({ steps }: { steps: Step[] }) {
  const waitsOnYou = useWaitsOnYou()
  const waiting = steps.some(waitsOnYou)
  const live = steps.some((step) => step.status === 'running')
  const failed = steps.some((step) => step.status === 'failed')
  const [open, setOpen] = useState<boolean | null>(null)
  // Until the reader chooses: short groups, running ones and failures show their steps.
  const shown = open ?? (live || failed || steps.length <= OPEN_UP_TO)
  const described = steps.map((step) => describeStep(step.name, parseArgs(step.args)))
  return (
    <div className="my-3 overflow-hidden rounded-[10px] border border-border bg-muted text-sm">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen(!shown)}
        className="unstyled flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-mocha hover:bg-accent/50"
      >
        <ListChecks className="size-[15px] shrink-0" aria-hidden="true" />
        <span className="shrink-0 font-semibold text-foreground">
          {steps.length} step{steps.length === 1 ? '' : 's'}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {summarizeSteps(described.map((entry) => entry.kind))}
          {waiting ? ' · waiting for you' : live ? ' · running' : ''}
        </span>
        <span className="shrink-0 text-xs font-semibold text-accent-foreground">
          {shown ? 'Hide' : 'Show'}
        </span>
      </button>
      {shown && (
        <ul className="m-0 list-none p-0">
          {steps.map((step, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps only append within a turn.
            <StepRow key={index} step={step} waiting={waitsOnYou(step)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function StepRow({ step, waiting }: { step: Step; waiting: boolean }) {
  const [open, setOpen] = useState(false)
  const args = parseArgs(step.args)
  const described = describeStep(step.name, args)
  const Icon = ICONS[described.icon]
  const change = step.status === 'done' ? lineChange(step.name, args) : null
  const running = step.status === 'running'
  return (
    <li className="border-t border-frost/70">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="unstyled flex min-h-8 w-full items-center gap-2.5 px-3 py-1 text-left hover:bg-accent/40"
      >
        <Icon className="size-[15px] shrink-0 text-mocha" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {described.verb}
          {described.target && (
            <>
              {' '}
              <code className={CODE}>{described.target}</code>
            </>
          )}
        </span>
        {change && change.added > 0 && (
          <span className="shrink-0 font-mono text-xs font-medium text-success">
            +{change.added}
          </span>
        )}
        {change && change.removed > 0 && (
          <span className="shrink-0 font-mono text-xs font-medium text-danger">
            −{change.removed}
          </span>
        )}
        {running &&
          (waiting ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-warning">
              <span className="size-[7px] rounded-full bg-warning" aria-hidden="true" />
              waiting for you
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-success">
              <span
                className="size-[7px] animate-pulse rounded-full bg-success"
                aria-hidden="true"
              />
              running
            </span>
          ))}
        {step.status === 'failed' && (
          <span className="shrink-0 text-xs font-semibold text-danger">failed</span>
        )}
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      {running && step.output && !open && <LiveOutput output={step.output} />}
      {open && <StepDetail step={step} args={args} />}
    </li>
  )
}

function clipLines(text: string, limit = DETAIL_LINES): { lines: string[]; more: number } {
  const all = text.replace(/\n$/, '').split('\n')
  return { lines: all.slice(0, limit), more: Math.max(0, all.length - limit) }
}

function DiffLines({ text, sign }: { text: string; sign: '+' | '-' }) {
  const { lines, more } = clipLines(text)
  const tone = sign === '+' ? 'bg-success/15' : 'bg-danger/15'
  return (
    <>
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static lines of one tool call.
        <div key={index} className={`whitespace-pre px-3 ${tone}`}>
          {sign === '+' ? '+' : '−'}
          {line}
        </div>
      ))}
      {more > 0 && (
        <div className="px-3 text-mocha">
          {'  '}
          {more} more line{more === 1 ? '' : 's'}
        </div>
      )}
    </>
  )
}

function StepDetail({ step, args }: { step: Step; args: Record<string, unknown> | null }) {
  const output =
    step.output.length > OUTPUT_CHARS ? `${step.output.slice(0, OUTPUT_CHARS)}\n…` : step.output
  const mono = 'overflow-x-auto border-t border-frost/70 bg-card font-mono text-xs leading-[1.55]'
  if (step.status !== 'failed' && step.name === 'write' && typeof args?.content === 'string') {
    return (
      <div className={mono}>
        <DiffLines text={args.content} sign="+" />
      </div>
    )
  }
  if (step.status !== 'failed' && step.name === 'edit' && Array.isArray(args?.edits)) {
    return (
      <div className={mono}>
        {(args.edits as Array<Record<string, unknown>>).map((edit, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static edits of one tool call.
          <div key={index} className={index > 0 ? 'border-t border-frost/70' : undefined}>
            {typeof edit?.oldText === 'string' && <DiffLines text={edit.oldText} sign="-" />}
            {typeof edit?.newText === 'string' && <DiffLines text={edit.newText} sign="+" />}
          </div>
        ))}
      </div>
    )
  }
  const input =
    step.name === 'bash' && typeof args?.command === 'string'
      ? args.command
      : args
        ? JSON.stringify(args, null, 2)
        : step.args
  return (
    <div className={`${mono} max-h-72 overflow-y-auto`}>
      {input && (
        <pre className="m-0 whitespace-pre-wrap break-words px-3 py-1.5 text-mocha">{input}</pre>
      )}
      {output && (
        <pre
          className={`m-0 whitespace-pre-wrap break-words border-t border-frost/70 px-3 py-1.5 ${
            step.status === 'failed' ? 'text-danger' : 'text-chocolate'
          }`}
        >
          {output}
        </pre>
      )}
    </div>
  )
}

/** Latest output of a running tool, kept scrolled to its end. */
function LiveOutput({ output }: { output: string }) {
  const ref = useRef<HTMLPreElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow every new output tail.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [output])
  return (
    <pre
      ref={ref}
      className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-frost/70 bg-card px-3 py-1.5 font-mono text-xs text-mocha"
    >
      {output}
    </pre>
  )
}

/**
 * The teammate a message went to: `to` is an id, the name in the list or the name the teammate
 * gave itself, as send_message takes them (in the open Agent's Team, whatever the case).
 */
function recipientOf(workspace: WorkspaceValue | null, to: string): Agent | undefined {
  if (!workspace || !to) return undefined
  const byId = workspace.agentById(to)
  if (byId) return byId
  const key = to.trim().toLowerCase()
  const team = workspace.agent?.agent.teamId
  const named = (match: (agent: Agent) => boolean) => {
    const found = workspace.agents.filter((agent) => agent.teamId === team && match(agent))
    return found.length === 1 ? found[0] : undefined
  }
  return (
    named((agent) => agent.name.trim().toLowerCase() === key) ??
    named((agent) => chosenName(agent)?.toLowerCase() === key)
  )
}

/** Messages to teammates: who got what, and what that teammate is doing now. */
function Handoffs({ steps }: { steps: Step[] }) {
  const workspace = useWorkspaceOptional()
  const activity = useActivityOptional()
  // A refused call (its arguments cut off, say) handed nothing off: it is listed as not sent.
  const sent = steps.filter((step) => step.status !== 'failed').length
  return (
    <div className="my-3 overflow-hidden rounded-[10px] border border-border bg-muted text-sm">
      <div className="flex min-h-9 items-center gap-2 px-3 py-1.5 text-mocha">
        <ArrowLeftRight className="size-[15px] shrink-0" aria-hidden="true" />
        <span className="font-semibold text-foreground">
          {sent === 0
            ? steps.length === 1
              ? 'Not handed off'
              : 'Nothing handed off'
            : sent === 1
              ? 'Handed off to a teammate'
              : `Handed off to ${sent} teammates`}
        </span>
        {workspace?.team && (
          <Link
            to="/"
            search={workspace.to({ panel: 'connections' })}
            className="ml-auto text-xs font-semibold"
          >
            See connections
          </Link>
        )}
      </div>
      {steps.map((step, index) => {
        const args = parseArgs(step.args)
        const to = typeof args?.to === 'string' ? args.to : ''
        const recipient = recipientOf(workspace, to)
        const message = typeof args?.text === 'string' ? args.text : ''
        const state = recipient ? activity?.stateOf(recipient.id) : undefined
        return (
          // The Open link sits over the fold's line, not inside its <summary> (a control in one).
          // biome-ignore lint/suspicious/noArrayIndexKey: steps only append within a turn.
          <div key={index} className="relative border-t border-frost/70">
            <details className="group">
              <summary
                className={`flex min-h-11 cursor-pointer list-none items-center gap-2.5 py-1.5 pl-3 [&::-webkit-details-marker]:hidden ${workspace && recipient ? 'pr-[4.5rem]' : 'pr-3'}`}
              >
                <AgentAvatar identity={recipient?.identity} size={24} />
                <span className="shrink-0 font-semibold text-foreground">
                  {recipient?.name ?? (to ? to.slice(0, 8) : 'Teammate')}
                </span>
                <span className="min-w-0 flex-1 truncate text-mocha group-open:invisible">
                  {message}
                </span>
                {step.status === 'failed' ? (
                  <span className="shrink-0 text-xs font-semibold text-danger">not sent</span>
                ) : step.status === 'running' ? (
                  <span className="shrink-0 text-xs text-mocha">sending…</span>
                ) : (
                  state && <span className="shrink-0 text-xs text-mocha">{state.text}</span>
                )}
              </summary>
              <p className="m-0 whitespace-pre-wrap break-words px-3 pb-2.5 pl-[3.1rem] text-chocolate">
                {message}
              </p>
              {step.status === 'failed' && (
                <p className="m-0 break-words px-3 pb-2.5 pl-[3.1rem] text-xs text-danger">
                  {step.output}
                </p>
              )}
            </details>
            {workspace && recipient && (
              <Link
                to="/"
                search={{
                  agent: recipient.id,
                  ...(workspace.search.panel ? { panel: workspace.search.panel } : {}),
                }}
                className="absolute right-3 top-2 flex h-7 items-center rounded-[10px] border border-border bg-card px-2.5 text-xs font-semibold text-foreground hover:border-sapphire-light hover:text-sapphire"
              >
                Open<span className="sr-only"> {recipient.name}</span>
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The way from "I wrote these files" to their diff. */
function WrittenFiles({ paths }: { paths: string[] }) {
  const workspace = useWorkspaceOptional()
  const label = `${paths.length} file${paths.length === 1 ? '' : 's'} written`
  const names = paths.map((path) => path.split('/').pop() ?? path).join(', ')
  const body = (
    <>
      <Code2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="shrink-0 font-semibold text-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-mocha">{names}</span>
    </>
  )
  const frame =
    'my-3 flex min-h-11 w-full items-center gap-2.5 rounded-[10px] border border-border bg-card px-3 py-2 text-sm'
  if (!workspace?.team) return <div className={frame}>{body}</div>
  return (
    <Link
      to="/"
      search={workspace.to({ panel: 'changes', file: paths[0] })}
      className={`${frame} text-foreground hover:border-sapphire-light`}
    >
      {body}
      <span className="flex shrink-0 items-center gap-1.5 font-semibold text-accent-foreground">
        Review changes
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </span>
    </Link>
  )
}
