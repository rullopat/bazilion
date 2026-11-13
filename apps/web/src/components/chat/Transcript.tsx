import type { CommandApproval, ProviderMessage } from '@bazilion/api-types'
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { inboxUpdateLabel } from '../../lib/inbox-presentation'
import { renderMd } from '../../lib/md'
import { ResultCard } from '../ResultCard'
import { CommandApprovalCard } from './CommandApprovalCard'
import { projectMessages, type RenderEntry, type ToolItem } from './entries'

const INBOX_WAKE_PREFIX = '[[bazilion:inbox-wake]]\n'
const COMPACTION_REPLAY_PREFIX = '[conversation summary]'
const TOOL_GROUP_MAX_HEIGHT_PX = 320

const noSubscription = () => () => {}

/**
 * False during SSR and the hydration pass, true afterwards. Markdown renders as escaped text until
 * then, so the server HTML and the first client render match byte for byte.
 */
export function useMarkdownReady(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
}

export interface ApprovalControls {
  busy: Record<string, boolean>
  errors: Record<string, string>
  decide: (approval: CommandApproval, decision: 'allow' | 'deny') => void
}

export function Bubble({
  entry,
  markdownReady,
  onEdit,
  dropped = false,
  approvals,
}: {
  entry: RenderEntry
  markdownReady: boolean
  /** Shown on the last user message: edit and resend it. */
  onEdit?: () => void
  /** Struck through: an edit in progress replaces it. */
  dropped?: boolean
  approvals?: ApprovalControls
}) {
  const dropClass = dropped ? 'opacity-40 [&_.bubble-content]:line-through' : ''
  switch (entry.type) {
    case 'user':
      if (entry.content.startsWith(INBOX_WAKE_PREFIX)) {
        const body = entry.content.slice(INBOX_WAKE_PREFIX.length)
        return (
          <details
            className={`my-3 rounded-lg border border-fawn bg-ivory px-3 py-2 text-sm text-mocha ${dropClass}`}
            aria-label="Teammate update"
          >
            <summary className="cursor-pointer font-medium">{inboxUpdateLabel(body)}</summary>
            <p className="mt-2 text-xs">Original message and Agent instructions</p>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {body}
            </pre>
          </details>
        )
      }
      return (
        <div className={`group relative my-4 flex flex-col items-end ${dropClass}`}>
          <span className="sr-only">you</span>
          {entry.images && entry.images.length > 0 && (
            <div className="mb-1 flex max-w-[85%] flex-wrap justify-end gap-1">
              {entry.images.map((image, index) => (
                <img
                  // biome-ignore lint/suspicious/noArrayIndexKey: a message's images never reorder.
                  key={index}
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt="attachment"
                  className="max-h-48 rounded-lg border border-sapphire-light"
                />
              ))}
            </div>
          )}
          {entry.files && entry.files.length > 0 && (
            <div className="mb-1 flex max-w-[85%] flex-wrap justify-end gap-1">
              {entry.files.map((file, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: a message's files never reorder.
                  key={index}
                  className="flex items-center gap-1 rounded-md border border-sapphire-light bg-sapphire-glow px-2 py-1 text-[0.8em] text-chocolate"
                >
                  📄 <span className="max-w-[180px] truncate">{file.name}</span>
                </span>
              ))}
            </div>
          )}
          {entry.content && (
            <div className="bubble-content max-w-[85%] whitespace-pre-wrap break-words rounded-[14px_14px_4px_14px] border border-sapphire-light bg-sapphire-glow px-3 py-2 text-chocolate">
              {entry.content}
            </div>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              title="Edit and resend: replaces the last turn"
              className="absolute left-1 top-1 rounded-sm border border-fawn bg-ivory px-2 py-0.5 text-[0.78em] font-medium text-mocha opacity-65 transition hover:border-sapphire hover:bg-sapphire-glow hover:text-sapphire hover:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              edit
            </button>
          )}
        </div>
      )
    case 'assistant':
      if (entry.content.startsWith(COMPACTION_REPLAY_PREFIX)) {
        const summary = entry.content.slice(COMPACTION_REPLAY_PREFIX.length).trim()
        return (
          <div
            className={`my-3 border-y border-dashed border-frost py-2 text-[0.85em] italic text-mocha-light ${dropClass}`}
          >
            <details>
              <summary className="cursor-pointer select-none text-center [&::-webkit-details-marker]:hidden">
                — conversation summary (click to expand) —
              </summary>
              <div
                className="md-content mt-2 rounded-sm bg-frost/40 p-2 not-italic"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output sanitized by DOMPurify.
                dangerouslySetInnerHTML={{ __html: renderMd(summary, markdownReady) }}
              />
            </details>
          </div>
        )
      }
      return (
        <div className={`my-4 flex flex-col items-start ${dropClass}`}>
          <span className="sr-only">agent</span>
          <div
            className="md-content bubble-content w-full leading-[1.55] text-chocolate"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: marked output sanitized by DOMPurify.
            dangerouslySetInnerHTML={{ __html: renderMd(entry.content, markdownReady) }}
          />
        </div>
      )
    case 'tool':
      return <ToolGroup items={entry.items} className={dropClass} />
    case 'images':
      return (
        <div className={`my-2 space-y-2 ${dropClass}`}>
          {entry.images.map((image, index) => (
            <img
              // biome-ignore lint/suspicious/noArrayIndexKey: a result's images never reorder.
              key={index}
              src={`data:${image.mimeType};base64,${image.data}`}
              alt="screenshot"
              className="block max-w-full rounded-lg border border-fawn"
            />
          ))}
        </div>
      )
    case 'result':
      return <ResultCard resultId={entry.resultId} />
    case 'command_approval':
      return (
        <CommandApprovalCard
          approval={entry.approval}
          busy={approvals?.busy[entry.approval.id] ?? false}
          error={approvals?.errors[entry.approval.id]}
          onDecision={approvals?.decide}
        />
      )
    case 'system':
      return (
        <div className="my-3 rounded-r-sm border-l-[3px] border-sapphire bg-sapphire-glow px-3 py-1 font-mono text-[0.88em] text-sapphire-deep">
          <span className="mr-2 font-semibold uppercase tracking-wider opacity-80">system</span>
          <span className="whitespace-pre-wrap">{entry.content}</span>
        </div>
      )
    case 'error':
      return (
        <div className="my-3 rounded-r-sm border-l-[3px] border-danger bg-danger/10 px-3 py-1 text-[0.92em] text-danger">
          {entry.content}
        </div>
      )
  }
}

function prettyArgs(raw: string): string {
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function ToolGroup({ items, className }: { items: ToolItem[]; className: string }) {
  // A teammate message renders as its own card once its result exists, so its call line goes.
  const visible = items.filter(
    (item) =>
      !(
        item.kind === 'call' &&
        item.name === 'send_message' &&
        items.some((other) => other.id === item.id && other.kind !== 'call')
      ),
  )
  // Never clip a group while a tool is streaming its output.
  const live = items.some((item) => item.kind === 'progress')
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  // Re-measure when the content changes; a result replacing a live tail keeps the item count.
  const contentKey = items.map((item) => `${item.kind}:${item.body.length}`).join()
  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey is the change signal.
  useLayoutEffect(() => {
    const element = contentRef.current
    if (element) setOverflows(element.scrollHeight > TOOL_GROUP_MAX_HEIGHT_PX + 4)
  }, [contentKey])

  return (
    <div
      className={`my-1.5 rounded-r-sm border-l-[3px] border-fawn bg-ivory px-3 py-2 font-mono text-[0.82em] leading-[1.5] text-mocha-light ${className}`}
    >
      <div
        ref={contentRef}
        className="relative overflow-hidden"
        style={{ maxHeight: expanded || live ? 'none' : `${TOOL_GROUP_MAX_HEIGHT_PX}px` }}
      >
        {visible.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a call and its result share an id.
          <ToolLine key={index} item={item} />
        ))}
        {overflows && !expanded && !live && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
            style={{ background: 'linear-gradient(to bottom, transparent, var(--color-ivory))' }}
          />
        )}
      </div>
      {overflows && !live && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 rounded-sm border border-fawn bg-transparent px-2 py-0.5 text-[0.9em] text-mocha hover:border-sapphire hover:text-sapphire-deep"
        >
          {expanded ? 'show less ↑' : 'show more ↓'}
        </button>
      )}
    </div>
  )
}

function ToolLine({ item }: { item: ToolItem }) {
  if (item.name === 'send_message' && item.kind !== 'error') {
    return (
      <details className="py-1 font-sans text-sm">
        <summary className="cursor-pointer">
          {item.kind === 'call'
            ? 'Sending teammate message…'
            : item.body.startsWith('sent message ')
              ? 'Teammate message sent'
              : 'Teammate message status'}
        </summary>
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
          {item.body}
        </pre>
      </details>
    )
  }
  if (item.kind === 'progress') return <LiveToolOutput output={item.body} />
  if (item.kind === 'call') {
    const args = prettyArgs(item.body)
    return (
      <div className="whitespace-pre-wrap break-words py-0.5">
        <span className="mr-1 opacity-45">→</span>
        <span className="font-medium text-mocha">{item.name}</span>
        {args.includes('\n') ? (
          <pre className="ml-4 mt-0.5 rounded-sm bg-[rgba(42,31,22,0.04)] px-2 py-1 font-mono text-[0.95em] leading-[1.4] text-mocha">
            {args}
          </pre>
        ) : args ? (
          <span> ({args})</span>
        ) : null}
      </div>
    )
  }
  return (
    <div
      className={`whitespace-pre-wrap break-words py-0.5 ${item.kind === 'error' ? 'text-rose-baziu' : ''}`}
    >
      <span className="mr-1 opacity-45">←</span>
      {item.body}
    </div>
  )
}

/** Latest output of a running tool, kept scrolled to its end. */
function LiveToolOutput({ output }: { output: string }) {
  const ref = useRef<HTMLPreElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow every new output tail.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [output])
  return (
    <pre
      ref={ref}
      className="my-0.5 ml-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[rgba(42,31,22,0.04)] px-2 py-1"
    >
      {output}
    </pre>
  )
}

/** A conversation's messages, read-only (the conversation library). */
export function ReadOnlyTranscript({ messages }: { messages: ProviderMessage[] }) {
  const markdownReady = useMarkdownReady()
  return (
    <section aria-label="Conversation history">
      {projectMessages(messages).map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a closed conversation never reorders.
        <Bubble key={index} entry={entry} markdownReady={markdownReady} />
      ))}
    </section>
  )
}
