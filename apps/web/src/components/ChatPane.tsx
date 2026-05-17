// Chat panel: renders the running transcript, sends messages, consumes the
// daemon's NDJSON ChatFrame stream. Initial messages come from the route
// loader; new ones land via fetch + ReadableStream consume.

import type { ChatFrame, ProviderMessage, SessionHeadResponse } from '@bazilion/api-types'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderMd } from '../lib/md'

const INBOX_WAKE_PREFIX = '[[bazilion:inbox-wake]]\n'
const COMPACTION_REPLAY_PREFIX = '[conversation summary]'
const AUTOSCROLL_THRESHOLD_PX = 40
const SESSION_POLL_MS = 10_000
const TOOL_GROUP_MAX_HEIGHT_PX = 320
const MAX_INPUT_HEIGHT = 200

type ToolItem = {
  kind: 'call' | 'result' | 'error'
  id: string
  name: string
  body: string
}

type RenderEntry =
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string }
  | { type: 'tool'; items: ToolItem[] }
  | { type: 'system'; content: string }
  | { type: 'error'; content: string }

const SLASH_HELP =
  'slash commands:\n' +
  '  /context           — context breakdown (system prompt, tools, skills, history)\n' +
  '  /compact [N]       — summarize the head; keep the last N messages verbatim (default 10)\n' +
  '  /reset             — reset chat history for this agent\n' +
  '  /help              — show this list'

interface ChatContextResponse {
  agentId: string
  model: string
  systemPrompt: { chars: number; tokens: number; files: { name: string; chars: number }[] }
  tools: {
    count: number
    listChars: number
    schemaChars: number
    entries: { name: string; schemaChars: number; paramCount: number | null }[]
  }
  skills: { count: number; entries: { name: string; blockChars: number }[] }
  history: {
    messageEntries: number
    compactionEntries: number
    chars: number
    bytes: number
    tokensEstimate: number
  }
  totals: { chars: number; tokens: number }
}

interface ChatCompactResponse {
  before: number
  after: number
  summarized: number
  keptTail: number
  tokensBefore: number
  tokensAfter: number
  summary: string
}

function prettyArgs(raw: string): string {
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

// Project canonical ProviderMessage[] into render entries: assistant content +
// any tool calls, then tool-role messages collapse into the same group.
function projectMessages(msgs: ProviderMessage[]): RenderEntry[] {
  const entries: RenderEntry[] = []
  let openTool: { type: 'tool'; items: ToolItem[] } | null = null
  for (const m of msgs) {
    if (m.role === 'user') {
      openTool = null
      entries.push({ type: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      if (m.content) {
        openTool = null
        entries.push({ type: 'assistant', content: m.content })
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        if (!openTool) {
          openTool = { type: 'tool', items: [] }
          entries.push(openTool)
        }
        for (const tc of m.toolCalls) {
          openTool.items.push({ kind: 'call', id: tc.id, name: tc.name, body: tc.arguments })
        }
      }
    } else if (m.role === 'tool') {
      if (!openTool) {
        openTool = { type: 'tool', items: [] }
        entries.push(openTool)
      }
      const isError = m.content.startsWith('Error:') || m.content.startsWith('error:')
      openTool.items.push({
        kind: isError ? 'error' : 'result',
        id: m.toolCallId ?? '',
        name: m.toolName ?? '',
        body: m.content,
      })
    }
  }
  return entries
}

export interface ChatPaneProps {
  agentId: string
  agentName: string
  initialMessages: ProviderMessage[]
  /** SSR snapshot of the session-file head; the stale-banner poll compares against it. */
  initialSessionHead?: SessionHeadResponse
}

export function ChatPane({
  agentId,
  agentName,
  initialMessages,
  initialSessionHead,
}: ChatPaneProps) {
  const [serverMessages, setServerMessages] = useState<ProviderMessage[]>(initialMessages)
  const [liveEntries, setLiveEntries] = useState<RenderEntry[]>([])
  const [systemBubbles, setSystemBubbles] = useState<
    Array<{ id: number; content: string; afterIdx: number }>
  >([])
  const [thinking, setThinking] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [staleBanner, setStaleBanner] = useState(false)

  const messagesRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const currentAbortRef = useRef<AbortController | null>(null)
  // Slash-command output bubbles are anchored to the count of visible
  // (non-system) entries at push time, so they stay in place when later
  // messages arrive instead of being pinned to the bottom of the transcript.
  const systemIdRef = useRef(0)
  const visibleEntryCountRef = useRef(0)
  const knownHeadRef = useRef<SessionHeadResponse>(
    initialSessionHead ?? { file: null, size: 0 },
  )
  // Keep current streaming/state references stable across closures (the poll
  // loop and visibilitychange handler both read them).
  const streamingRef = useRef(false)
  streamingRef.current = streaming

  // Re-seed when the agent prop changes (the loader returns new initialMessages
  // for a different agent on the home page).
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit reset on agent switch
  useEffect(() => {
    setServerMessages(initialMessages)
    setLiveEntries([])
    setSystemBubbles([])
    setEditIdx(null)
    setInput('')
    setThinking(false)
    setStreaming(false)
    setStaleBanner(false)
    knownHeadRef.current = initialSessionHead ?? { file: null, size: 0 }
  }, [agentId])

  // --- smart autoscroll ---
  const wasNearBottomRef = useRef(true)
  useLayoutEffect(() => {
    const el = messagesRef.current
    if (!el) return
    if (wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  })
  function captureScroll() {
    const el = messagesRef.current
    if (!el) {
      wasNearBottomRef.current = true
      return
    }
    wasNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < AUTOSCROLL_THRESHOLD_PX
  }

  // --- textarea auto-resize ---
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [input])

  // --- pending-send marker (visibilitychange → reload if midflight) ---
  useEffect(() => {
    const key = `bz_pending_${agentId}`
    function onVis() {
      if (document.visibilityState === 'visible' && sessionStorage.getItem(key)) {
        sessionStorage.removeItem(key)
        window.location.reload()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [agentId])

  // --- stale-banner poll loop ---
  useEffect(() => {
    if (!initialSessionHead) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    async function tick() {
      if (stopped) return
      if (!document.hidden && !streamingRef.current && !staleBanner) {
        try {
          const res = await fetch(
            `/api/agents/${encodeURIComponent(agentId)}/sessions/head`,
          )
          if (res.ok) {
            const body = (await res.json()) as SessionHeadResponse
            if (typeof body.size === 'number') {
              const known = knownHeadRef.current
              if (body.file !== known.file || body.size !== known.size) {
                setStaleBanner(true)
              }
            }
          }
        } catch {
          // transient — try again next tick
        }
      }
      timer = setTimeout(tick, SESSION_POLL_MS)
    }
    timer = setTimeout(tick, SESSION_POLL_MS)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [agentId, initialSessionHead, staleBanner])

  async function refreshKnownHead() {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/sessions/head`)
      if (!res.ok) return
      const body = (await res.json()) as SessionHeadResponse
      if (typeof body.size === 'number') {
        knownHeadRef.current = { file: body.file ?? null, size: body.size }
      }
    } catch {
      // swallow
    }
  }

  // --- system bubble helper (slash command output) ---
  function pushSystem(text: string) {
    captureScroll()
    setSystemBubbles((prev) => [
      ...prev,
      { id: systemIdRef.current++, content: text, afterIdx: visibleEntryCountRef.current },
    ])
  }

  // --- slash commands ---
  async function runContextCommand() {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat/context`)
      if (!res.ok) {
        pushSystem(`/context failed: ${res.statusText}`)
        return
      }
      const ctx = (await res.json()) as ChatContextResponse
      const fmt = (chars: number, tokens: number) =>
        `${chars.toLocaleString()} chars (~${tokens.toLocaleString()} tok)`
      const lines: string[] = []
      lines.push(`context for ${ctx.agentId}`)
      lines.push(`model: ${ctx.model}`)
      lines.push('')
      lines.push(`system prompt: ${fmt(ctx.systemPrompt.chars, ctx.systemPrompt.tokens)}`)
      for (const f of ctx.systemPrompt.files) {
        lines.push(`  - ${f.name}: ${f.chars.toLocaleString()} chars`)
      }
      lines.push('')
      lines.push(
        `tools: ${ctx.tools.count} (${ctx.tools.schemaChars.toLocaleString()} chars of schema)`,
      )
      for (const t of ctx.tools.entries.slice(0, 5)) {
        lines.push(`  - ${t.name}: ${t.schemaChars.toLocaleString()} chars`)
      }
      if (ctx.skills.count > 0) {
        lines.push('')
        lines.push(`skills: ${ctx.skills.count}`)
        for (const s of ctx.skills.entries.slice(0, 10)) {
          lines.push(`  - ${s.name}: ${s.blockChars.toLocaleString()} chars`)
        }
      }
      lines.push('')
      lines.push(
        `history: ${ctx.history.messageEntries} messages / ${ctx.history.compactionEntries} compactions`,
      )
      lines.push(`  ${fmt(ctx.history.chars, ctx.history.tokensEstimate)}`)
      lines.push(`  bytes on disk: ${formatBytes(ctx.history.bytes)}`)
      lines.push('')
      lines.push(`TOTAL: ${fmt(ctx.totals.chars, ctx.totals.tokens)}`)
      pushSystem(lines.join('\n'))
    } catch (err) {
      pushSystem(`/context failed: ${(err as Error).message}`)
    }
  }

  async function runResetCommand() {
    if (serverMessages.length === 0) {
      pushSystem('/reset: history already empty')
      return
    }
    if (!confirm('reset chat history for this agent?')) return
    exitEditMode()
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat/reset`, {
        method: 'POST',
      })
      if (!res.ok) {
        let msg = res.statusText
        try {
          msg = ((await res.json()) as { error?: string }).error || msg
        } catch {}
        pushSystem(`/reset failed: ${msg}`)
        return
      }
      setServerMessages([])
      setLiveEntries([])
      // Drop prior slash-command bubbles whose anchors point into the wiped
      // history — they'd otherwise render at the trailing end with stale context.
      setSystemBubbles([])
      pushSystem('/reset: history wiped')
    } catch (err) {
      pushSystem(`/reset failed: ${(err as Error).message}`)
    }
  }

  async function runCompactCommand(rest: string) {
    if (serverMessages.length < 2) {
      pushSystem('/compact: need ≥2 messages to compact')
      return
    }
    let keepTail: number | undefined
    const argText = rest.trim()
    if (argText) {
      const n = Number(argText)
      if (Number.isFinite(n) && n >= 0) keepTail = Math.floor(n)
    }
    exitEditMode()
    setStreaming(true)
    setThinking(true)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat/compact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(keepTail !== undefined ? { keepTail } : {}),
      })
      if (!res.ok) {
        let msg = res.statusText
        try {
          msg = ((await res.json()) as { error?: string }).error || msg
        } catch {}
        pushSystem(`/compact failed: ${msg}`)
        return
      }
      const body = (await res.json()) as ChatCompactResponse
      pushSystem(
        `/compact: ${body.before} → ${body.after} entries (${body.summarized} summarized, ${body.keptTail} kept verbatim; ~${body.tokensBefore.toLocaleString()} → ~${body.tokensAfter.toLocaleString()} tok). reloading…`,
      )
      setTimeout(() => window.location.reload(), 400)
    } catch (err) {
      pushSystem(`/compact failed: ${(err as Error).message}`)
    } finally {
      setThinking(false)
      setStreaming(false)
    }
  }

  async function maybeHandleSlashCommand(text: string): Promise<boolean> {
    const trimmed = text.trim()
    if (!trimmed.startsWith('/')) return false
    const parts = trimmed.split(/\s+/)
    const cmd = (parts[0] ?? '').toLowerCase()
    const rest = parts.slice(1).join(' ')
    switch (cmd) {
      case '/help':
        pushSystem(SLASH_HELP)
        return true
      case '/context':
        await runContextCommand()
        return true
      case '/reset':
        await runResetCommand()
        return true
      case '/compact':
        await runCompactCommand(rest)
        return true
      default:
        return false
    }
  }

  // --- edit-last-message ---
  function findLastUserIdx(): number {
    for (let i = serverMessages.length - 1; i >= 0; i--) {
      if (serverMessages[i]?.role === 'user') return i
    }
    return -1
  }

  function enterEditMode() {
    if (liveEntries.length > 0 || streaming) return
    const idx = findLastUserIdx()
    if (idx === -1) return
    const userMsg = serverMessages[idx]
    if (!userMsg) return
    setEditIdx(idx)
    setInput(userMsg.content)
    inputRef.current?.focus()
  }

  function exitEditMode() {
    setEditIdx(null)
  }

  // --- send ---
  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return
      setInput('')

      // Slash commands shortcut.
      if (await maybeHandleSlashCommand(text)) return

      // Edit-mode truncate.
      let truncatedServerMessages: ProviderMessage[] | null = null
      if (editIdx !== null) {
        const keep = editIdx
        try {
          const res = await fetch(
            `/api/agents/${encodeURIComponent(agentId)}/chat/truncate`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ keepCount: keep }),
            },
          )
          if (!res.ok) {
            let err = res.statusText
            try {
              err = ((await res.json()) as { error?: string }).error || err
            } catch {}
            setInput(text)
            alert(`failed to replace last turn: ${err}`)
            return
          }
          truncatedServerMessages = serverMessages.slice(0, keep)
          setServerMessages(truncatedServerMessages)
          setEditIdx(null)
        } catch (err) {
          setInput(text)
          alert(`failed to replace last turn: ${(err as Error).message}`)
          return
        }
      }

      captureScroll()
      setLiveEntries([{ type: 'user', content: text }])
      sessionStorage.setItem(`bz_pending_${agentId}`, '1')
      const abort = new AbortController()
      currentAbortRef.current = abort
      setStreaming(true)
      setThinking(true)

      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: text }),
          signal: abort.signal,
        })
        if (!res.ok || !res.body) {
          let err = res.statusText
          try {
            err = ((await res.json()) as { error?: string }).error || err
          } catch {}
          setLiveEntries((prev) => [...prev, { type: 'error', content: `[error] ${err}` }])
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            let frame: ChatFrame
            try {
              frame = JSON.parse(line) as ChatFrame
            } catch {
              continue
            }
            handleFrame(frame)
          }
        }
        if (buffer.trim()) {
          try {
            handleFrame(JSON.parse(buffer) as ChatFrame)
          } catch {}
        }
        await refreshKnownHead()
        sessionStorage.removeItem(`bz_pending_${agentId}`)
      } catch (err) {
        const name = (err as Error).name
        if (name !== 'AbortError') {
          setLiveEntries((prev) => [
            ...prev,
            { type: 'error', content: `[network error] ${(err as Error).message}` },
          ])
        }
        sessionStorage.removeItem(`bz_pending_${agentId}`)
      } finally {
        setThinking(false)
        setStreaming(false)
        currentAbortRef.current = null
      }
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable refs intentional
    [agentId, editIdx, serverMessages, streaming],
  )

  function handleFrame(frame: ChatFrame) {
    if (frame.kind === 'fatal') {
      setLiveEntries((prev) => [
        ...prev,
        { type: 'error', content: `[fatal] ${frame.error}` },
      ])
      return
    }
    if (frame.kind === 'done') {
      setServerMessages(frame.messages)
      setLiveEntries([])
      return
    }
    if (frame.kind !== 'event') return
    const ev = frame.event
    captureScroll()
    if (ev.type === 'user_message') return
    if (ev.type === 'assistant_delta') {
      setThinking(false)
      setLiveEntries((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.type === 'assistant') {
          next[next.length - 1] = { type: 'assistant', content: last.content + ev.delta }
        } else {
          next.push({ type: 'assistant', content: ev.delta })
        }
        return next
      })
      return
    }
    if (ev.type === 'assistant_message') {
      setThinking(false)
      setLiveEntries((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.type === 'assistant') {
          next[next.length - 1] = { type: 'assistant', content: ev.text }
        } else {
          next.push({ type: 'assistant', content: ev.text })
        }
        return next
      })
      return
    }
    if (ev.type === 'tool_call' || ev.type === 'tool_result' || ev.type === 'tool_error') {
      setThinking(ev.type !== 'tool_call')
      const item: ToolItem =
        ev.type === 'tool_call'
          ? { kind: 'call', id: ev.id, name: ev.name, body: ev.arguments }
          : ev.type === 'tool_result'
            ? { kind: 'result', id: ev.id, name: ev.name, body: ev.result }
            : { kind: 'error', id: ev.id, name: ev.name, body: ev.error }
      setLiveEntries((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.type === 'tool') {
          next[next.length - 1] = { type: 'tool', items: [...last.items, item] }
        } else {
          next.push({ type: 'tool', items: [item] })
        }
        return next
      })
      return
    }
    if (ev.type === 'error') {
      setLiveEntries((prev) => [...prev, { type: 'error', content: `[error] ${ev.error}` }])
    }
  }

  async function cancel() {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/cancel`, {
        method: 'POST',
      })
      if (res.ok || res.status === 204) return
    } catch {
      // fall through to local fetch abort
    }
    currentAbortRef.current?.abort()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(input)
    }
  }

  // --- render projection ---
  const baseEntries = projectMessages(serverMessages)
  // Update the anchor reference so the next pushSystem() captures the current
  // count. Writing to a ref during render is supported by React.
  visibleEntryCountRef.current = baseEntries.length + liveEntries.length
  const lastUserIdx = (() => {
    if (liveEntries.length > 0 || streaming) return -1
    for (let i = baseEntries.length - 1; i >= 0; i--) {
      if (baseEntries[i]?.type === 'user') return i
    }
    return -1
  })()
  // willDropFromIdx: when in edit mode, every entry from the last user msg
  // onward will be dropped on submit. Compute the entry index of the
  // serverMessages[editIdx] user message.
  const willDropFromIdx = (() => {
    if (editIdx === null) return -1
    let userCount = 0
    for (let i = 0; i < baseEntries.length; i++) {
      if (baseEntries[i]?.type === 'user') {
        if (userCount === serverMessages.slice(0, editIdx + 1).filter((m) => m.role === 'user').length - 1) {
          return i
        }
        userCount++
      }
    }
    // Fallback: last user
    return lastUserIdx
  })()

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[16px] border border-frost bg-snow shadow-baziu-sm">
      <div className="flex items-baseline justify-between border-b border-frost px-4 py-2.5">
        <h1 className="font-display text-[1.2rem] text-charcoal">{agentName}</h1>
        <a
          href={`/agents/${agentId}`}
          className="text-xs text-mocha-light hover:text-sapphire"
        >
          settings →
        </a>
      </div>

      {staleBanner && (
        <div className="mx-5 mt-2 flex items-center gap-2 rounded-md border border-sapphire bg-frost px-4 py-2 text-[0.86em] text-mocha">
          <span
            className="h-2 w-2 flex-none rounded-full bg-sapphire"
            aria-hidden="true"
          />
          <span className="flex-1">new activity from another source — reload to see it</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-sm bg-sapphire px-3 py-1 text-[0.92em] text-snow hover:opacity-90"
          >
            reload
          </button>
          <button
            type="button"
            onClick={() => setStaleBanner(false)}
            className="px-1 text-mocha-light hover:text-mocha"
            aria-label="dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div
        ref={messagesRef}
        onScroll={captureScroll}
        className={`min-h-[240px] flex-1 overflow-y-auto px-5 py-5 ${editIdx !== null ? 'is-editing' : ''}`}
      >
        {baseEntries.length === 0 && liveEntries.length === 0 && systemBubbles.length === 0 && (
          <p className="py-12 text-center italic text-fawn">start a conversation…</p>
        )}
        {(() => {
          const out: ReactNode[] = []
          let sysIdx = 0
          const flushSysUpTo = (idx: number) => {
            while (
              sysIdx < systemBubbles.length &&
              (systemBubbles[sysIdx] as { afterIdx: number }).afterIdx <= idx
            ) {
              const sb = systemBubbles[sysIdx] as {
                id: number
                content: string
                afterIdx: number
              }
              out.push(
                <Bubble
                  key={`y-${sb.id}`}
                  entry={{ type: 'system', content: sb.content }}
                />,
              )
              sysIdx++
            }
          }
          flushSysUpTo(0)
          for (let i = 0; i < baseEntries.length; i++) {
            const entry = baseEntries[i] as RenderEntry
            out.push(
              <Bubble
                key={`s-${i}`}
                entry={entry}
                isLastUser={i === lastUserIdx && editIdx === null}
                isWillDrop={willDropFromIdx !== -1 && i >= willDropFromIdx}
                onEdit={enterEditMode}
              />,
            )
            flushSysUpTo(i + 1)
          }
          for (let i = 0; i < liveEntries.length; i++) {
            const entry = liveEntries[i] as RenderEntry
            out.push(<Bubble key={`l-${i}`} entry={entry} />)
            flushSysUpTo(baseEntries.length + i + 1)
          }
          // Anchors past the current real-entry count (e.g. after edit-mode
          // submit drops the tail) render at the end — better than vanishing.
          while (sysIdx < systemBubbles.length) {
            const sb = systemBubbles[sysIdx] as {
              id: number
              content: string
              afterIdx: number
            }
            out.push(
              <Bubble
                key={`y-${sb.id}`}
                entry={{ type: 'system', content: sb.content }}
              />,
            )
            sysIdx++
          }
          return out
        })()}
        {thinking && (
          <div className="flex items-center gap-2 px-1 py-1 text-[0.85em] text-mocha-light">
            <Dot />
            <Dot delay="0.15s" />
            <Dot delay="0.3s" />
            <span>agent is thinking…</span>
          </div>
        )}
      </div>

      {editIdx !== null && (
        <div className="flex items-center gap-2 border-t border-frost bg-sapphire-glow px-5 py-2 text-[0.85em] text-sapphire-deep">
          <span>editing last message — submit to replace, or</span>
          <button
            type="button"
            onClick={exitEditMode}
            className="ml-auto rounded-sm border border-sapphire-light bg-transparent px-2 py-0.5 text-[0.92em] text-sapphire-deep hover:bg-snow"
          >
            cancel
          </button>
        </div>
      )}

      <form
        className="flex items-end gap-2 border-t border-frost bg-ivory px-5 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={streaming}
          placeholder="say something… (Shift+Enter for newline; try /context, /compact, /reset)"
          autoComplete="off"
          className="max-h-[200px] min-h-[2.4rem] flex-1 resize-none overflow-y-auto rounded-md border-[1.5px] border-frost bg-snow px-3 py-2 text-[0.93em] leading-[1.45] text-chocolate outline-none transition-colors focus:border-sapphire focus:shadow-[0_0_0_3px_var(--color-sapphire-glow)]"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="rounded-md bg-sapphire px-4 py-2 text-[0.92em] font-semibold text-snow transition-colors hover:bg-sapphire-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          send
        </button>
        {streaming && (
          <button
            type="button"
            onClick={cancel}
            className="rounded-md border-[1.5px] border-frost bg-transparent px-3 py-1.5 text-[0.92em] font-medium text-mocha hover:border-sapphire-light hover:bg-sapphire-glow hover:text-sapphire"
          >
            cancel
          </button>
        )}
      </form>
    </div>
  )
}

interface BubbleProps {
  entry: RenderEntry
  isLastUser?: boolean
  isWillDrop?: boolean
  onEdit?: () => void
}

function Bubble({ entry, isLastUser, isWillDrop, onEdit }: BubbleProps) {
  const dropCls = isWillDrop ? 'opacity-40 [&_.bubble-content]:line-through' : ''
  if (entry.type === 'user') {
    if (entry.content.startsWith(INBOX_WAKE_PREFIX)) {
      const body = entry.content.slice(INBOX_WAKE_PREFIX.length)
      return (
        <div className={`my-4 flex flex-col items-end ${dropCls}`}>
          <span className="mb-1 text-[0.72em] font-semibold uppercase tracking-wider text-mocha opacity-90">
            inbox
          </span>
          <div className="bubble-content max-w-[85%] whitespace-pre-wrap break-words rounded-[14px_14px_4px_14px] border border-fawn border-l-[3px] border-l-mocha-light bg-ivory px-3 py-2 font-mono text-[0.88em] leading-[1.5] text-mocha">
            {body}
          </div>
        </div>
      )
    }
    return (
      <div className={`group relative my-4 flex flex-col items-end ${dropCls}`}>
        <span className="sr-only">you</span>
        <div className="bubble-content max-w-[85%] whitespace-pre-wrap break-words rounded-[14px_14px_4px_14px] border border-sapphire-light bg-sapphire-glow px-3 py-2 text-chocolate">
          {entry.content}
        </div>
        {isLastUser && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            title="edit and resend — replaces the last turn"
            className="absolute left-1 top-1 rounded-sm border border-fawn bg-ivory px-2 py-0.5 text-[0.78em] font-medium text-mocha opacity-65 transition hover:border-sapphire hover:bg-sapphire-glow hover:text-sapphire hover:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            edit
          </button>
        )}
      </div>
    )
  }
  if (entry.type === 'assistant') {
    if (entry.content.startsWith(COMPACTION_REPLAY_PREFIX)) {
      const summary = entry.content.slice(COMPACTION_REPLAY_PREFIX.length).trim()
      return (
        <div className={`my-3 border-y border-dashed border-frost py-2 text-[0.85em] italic text-mocha-light ${dropCls}`}>
          <details>
            <summary className="cursor-pointer select-none text-center [&::-webkit-details-marker]:hidden">
              — conversation summary (click to expand) —
            </summary>
            <div
              className="md-content mt-2 rounded-sm bg-frost/40 p-2 not-italic"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: marked + DOMPurify
              dangerouslySetInnerHTML={{ __html: renderMd(summary) }}
            />
          </details>
        </div>
      )
    }
    const isErr =
      entry.content.startsWith('[error]') ||
      entry.content.startsWith('[fatal]') ||
      entry.content.startsWith('[network error]')
    if (isErr) {
      return (
        <div className={`my-4 flex flex-col items-start ${dropCls}`}>
          <span className="mb-1 text-[0.72em] font-semibold uppercase tracking-wider text-[#9B3D3D]">
            error
          </span>
          <div
            className="bubble-content rounded-r-sm border-l-[3px] border-l-[#9B3D3D] bg-[rgba(196,135,138,0.06)] py-1 pl-3 pr-2 leading-[1.55]"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: marked + DOMPurify
            dangerouslySetInnerHTML={{ __html: renderMd(entry.content) }}
          />
        </div>
      )
    }
    return (
      <div className={`my-4 flex flex-col items-start ${dropCls}`}>
        <span className="sr-only">agent</span>
        <div
          className="md-content bubble-content w-full leading-[1.55] text-chocolate"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: marked + DOMPurify
          dangerouslySetInnerHTML={{ __html: renderMd(entry.content) }}
        />
      </div>
    )
  }
  if (entry.type === 'tool') {
    return <ToolGroup items={entry.items} dropCls={dropCls} />
  }
  if (entry.type === 'system') {
    return (
      <div className={`my-3 rounded-r-sm border-l-[3px] border-sapphire bg-sapphire-glow px-3 py-1 font-mono text-[0.88em] text-sapphire-deep ${dropCls}`}>
        <span className="mr-2 font-semibold uppercase tracking-wider opacity-80">system</span>
        <span className="whitespace-pre-wrap">{entry.content}</span>
      </div>
    )
  }
  if (entry.type === 'error') {
    return (
      <div className={`my-3 rounded-r-sm border-l-[3px] border-[#9B3D3D] bg-[rgba(196,135,138,0.08)] px-3 py-1 text-[0.92em] text-[#9B3D3D] ${dropCls}`}>
        {entry.content}
      </div>
    )
  }
  return null
}

function ToolGroup({ items, dropCls }: { items: ToolItem[]; dropCls: string }) {
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    setOverflows(el.scrollHeight > TOOL_GROUP_MAX_HEIGHT_PX + 4)
  }, [items.length])

  return (
    <div
      className={`my-1.5 rounded-r-sm border-l-[3px] border-fawn bg-ivory px-3 py-2 font-mono text-[0.82em] leading-[1.5] text-mocha-light ${dropCls}`}
    >
      <div
        ref={contentRef}
        className="relative overflow-hidden"
        style={{ maxHeight: expanded ? 'none' : `${TOOL_GROUP_MAX_HEIGHT_PX}px` }}
      >
        {items.map((it, i) => (
          <ToolLine key={i} item={it} />
        ))}
        {overflows && !expanded && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
            style={{
              background:
                'linear-gradient(to bottom, rgba(247,240,229,0), var(--color-ivory))',
            }}
          />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 rounded-sm border border-fawn bg-transparent px-2 py-0.5 text-[0.9em] text-mocha hover:border-sapphire hover:text-sapphire-deep"
        >
          {expanded ? 'show less ↑' : 'show more ↓'}
        </button>
      )}
    </div>
  )
}

function ToolLine({ item }: { item: ToolItem }) {
  if (item.kind === 'call') {
    const args = prettyArgs(item.body)
    const multiLine = args.includes('\n')
    return (
      <div className="whitespace-pre-wrap break-words py-0.5">
        <span className="mr-1 opacity-45">→</span>
        <span className="font-medium text-mocha">{item.name}</span>
        {multiLine ? (
          <pre className="ml-4 mt-0.5 rounded-sm bg-[rgba(42,31,22,0.04)] px-2 py-1 font-mono text-[0.95em] leading-[1.4] text-mocha">
            {args}
          </pre>
        ) : args ? (
          <span> ({args})</span>
        ) : null}
      </div>
    )
  }
  if (item.kind === 'error') {
    return (
      <div className="whitespace-pre-wrap break-words py-0.5 text-rose-baziu">
        <span className="mr-1 opacity-45">←</span>
        {item.body}
      </div>
    )
  }
  return (
    <div className="whitespace-pre-wrap break-words py-0.5">
      <span className="mr-1 opacity-45">←</span>
      {item.body}
    </div>
  )
}

function Dot({ delay = '0s' }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mocha-light/60"
      style={{ animationDelay: delay }}
      aria-hidden="true"
    />
  )
}

