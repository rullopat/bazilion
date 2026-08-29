// Chat panel: renders the running transcript, sends messages, consumes the
// daemon's NDJSON ChatFrame stream. Initial messages come from the route
// loader; new ones land via fetch + ReadableStream consume.

import type {
  Attachment,
  ChatFrame,
  ChatRequest,
  CommandApproval,
  CommandApprovalDecisionResponse,
  ListCommandApprovalsResponse,
  ProviderMessage,
  SessionHeadResponse,
} from '@bazilion/api-types'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderMd } from '../lib/md'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'

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

export type RenderEntry =
  | {
      type: 'user'
      content: string
      images?: { data: string; mimeType: string }[]
      files?: { name: string }[]
    }
  | { type: 'assistant'; content: string }
  | { type: 'tool'; items: ToolItem[] }
  | { type: 'images'; images: { data: string; mimeType: string }[] }
  | { type: 'file'; name: string; mimeType: string; data: string }
  | { type: 'command_approval'; approval: CommandApproval }
  | { type: 'system'; content: string }
  | { type: 'error'; content: string }

/** Keep one inline card per ephemeral shell approval while preserving its first position. */
export function upsertCommandApprovalEntry(
  entries: RenderEntry[],
  approval: CommandApproval,
): RenderEntry[] {
  const index = entries.findIndex(
    (entry) => entry.type === 'command_approval' && entry.approval.id === approval.id,
  )
  if (index === -1) return [...entries, { type: 'command_approval', approval }]
  const next = [...entries]
  next[index] = { type: 'command_approval', approval }
  return next
}

export function interactiveChatRequest(
  message: string,
  attachments: Attachment[],
): ChatRequest {
  return { message, attachments, bashApprovalMode: 'interactive' }
}

export function shellApprovalsUrl(agentId: string): string {
  return `/api/shell-approvals?agentId=${encodeURIComponent(agentId)}`
}

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

/** Read any File into a base64 Attachment (strips the data: URL prefix). */
function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve({
        name: file.name,
        data: comma >= 0 ? result.slice(comma + 1) : result,
        mimeType: file.type || 'application/octet-stream',
      })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const isImageMime = (m: string) => m.startsWith('image/')

// Project canonical ProviderMessage[] into render entries: assistant content +
// any tool calls, then tool-role messages collapse into the same team.
function projectMessages(msgs: ProviderMessage[]): RenderEntry[] {
  const entries: RenderEntry[] = []
  let openTool: { type: 'tool'; items: ToolItem[] } | null = null
  for (const m of msgs) {
    if (m.role === 'user') {
      openTool = null
      entries.push({
        type: 'user',
        content: m.content,
        ...(m.images && m.images.length > 0 ? { images: m.images } : {}),
      })
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
      // Images are deliverables — emit them as a standalone block OUTSIDE the
      // tool box (and close the team so they don't get visually nested).
      if (m.images && m.images.length > 0) {
        entries.push({ type: 'images', images: m.images })
        openTool = null
      }
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
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const [staleBanner, setStaleBanner] = useState(false)
  const [recoveredTurn, setRecoveredTurn] = useState(false)
  const [approvalBusy, setApprovalBusy] = useState<Record<string, boolean>>({})
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({})
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  const messagesRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const currentAbortRef = useRef<AbortController | null>(null)
  const currentAgentIdRef = useRef(agentId)
  const commandApprovalTurnRef = useRef(false)
  currentAgentIdRef.current = agentId
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
  const turnBusy = streaming || recoveredTurn

  // Re-seed when the agent prop changes (the loader returns new initialMessages
  // for a different agent on the home page).
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit reset on agent switch
  useEffect(() => {
    currentAbortRef.current?.abort()
    currentAbortRef.current = null
    commandApprovalTurnRef.current = false
    setServerMessages(initialMessages)
    setLiveEntries([])
    setSystemBubbles([])
    setEditIdx(null)
    setInput('')
    setThinking(false)
    setStreaming(false)
    setStaleBanner(false)
    setRecoveredTurn(false)
    setApprovalBusy({})
    setApprovalErrors({})
    knownHeadRef.current = initialSessionHead ?? { file: null, size: 0 }
  }, [agentId])

  // A browser navigation cannot re-open the original NDJSON response, but the
  // daemon keeps the turn and its shell approval alive. Recover only this
  // Agent's pending shell cards; Team Policy communication approvals remain on
  // their separate /approvals surface.
  useEffect(() => {
    const controller = new AbortController()
    let stopped = false
    async function recoverPendingCommandApprovals() {
      try {
        const response = await fetch(shellApprovalsUrl(agentId), {
          signal: controller.signal,
        })
        if (!response.ok) return
        const body = (await response.json()) as ListCommandApprovalsResponse
        const pending = body.approvals.filter(
          (approval) => approval.agentId === agentId && approval.status === 'pending',
        )
        if (stopped || pending.length === 0) return
        sessionStorage.removeItem(`bz_pending_${agentId}`)
        commandApprovalTurnRef.current = true
        setLiveEntries((entries) => pending.reduce(upsertCommandApprovalEntry, entries))
        setRecoveredTurn(true)
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
        // Recovery is best-effort. A live stream still delivers the same
        // event, and the normal session-head poll reports later activity.
      }
    }
    void recoverPendingCommandApprovals()
    return () => {
      stopped = true
      controller.abort()
    }
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
    if (currentAgentIdRef.current !== agentId) return
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/sessions/head`)
      if (!res.ok) return
      const body = (await res.json()) as SessionHeadResponse
      if (currentAgentIdRef.current === agentId && typeof body.size === 'number') {
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

  async function performReset() {
    exitEditMode()
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat/reset`, {
      method: 'POST',
    })
    if (!res.ok) {
      let message = res.statusText
      try {
        message = ((await res.json()) as { error?: string }).error || message
      } catch {}
      throw new Error(message)
    }
    setServerMessages([])
    setLiveEntries([])
    setSystemBubbles([])
    pushSystem('/reset: history wiped')
  }

  async function runResetCommand() {
    if (serverMessages.length === 0) {
      pushSystem('/reset: history already empty')
      return
    }
    setResetConfirmOpen(true)
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
    if (liveEntries.length > 0 || turnBusy) return
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

  // --- attachments (one generic list; the daemon classifies each: images →
  // vision, others → stored and referenced by path for the agent) ---
  async function addFiles(files: FileList | File[] | null) {
    if (!files || turnBusy) return
    const arr = Array.from(files)
    if (arr.length === 0) return
    const encoded = await Promise.all(arr.map(fileToAttachment))
    setAttachments((prev) => [...prev, ...encoded].slice(0, 16))
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files)
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    if (turnBusy) {
      setDragging(false)
      return
    }
    setDragging(true)
  }
  function onDragLeave(e: React.DragEvent) {
    // Only clear when the pointer leaves the container itself (not a child).
    if (e.currentTarget === e.target) setDragging(false)
  }
  function onDrop(e: React.DragEvent) {
    if (e.dataTransfer.files.length === 0) return
    e.preventDefault()
    setDragging(false)
    if (turnBusy) return
    void addFiles(e.dataTransfer.files)
  }

  // --- send ---
  const send = useCallback(
    async (text: string) => {
      const atts = attachments
      if ((!text.trim() && atts.length === 0) || turnBusy) return
      setInput('')

      // Slash commands shortcut (text-only; leave any attachments pending).
      if (await maybeHandleSlashCommand(text)) return
      setAttachments([])

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
            pushSystem(`Could not replace the last turn: ${err}`)
            return
          }
          truncatedServerMessages = serverMessages.slice(0, keep)
          setServerMessages(truncatedServerMessages)
          setEditIdx(null)
        } catch (err) {
          setInput(text)
          pushSystem(`Could not replace the last turn: ${(err as Error).message}`)
          return
        }
      }

      captureScroll()
      const previewImages = atts.filter((a) => isImageMime(a.mimeType))
      const previewFiles = atts.filter((a) => !isImageMime(a.mimeType))
      setLiveEntries([
        {
          type: 'user',
          content: text,
          ...(previewImages.length > 0 ? { images: previewImages } : {}),
          ...(previewFiles.length > 0
            ? { files: previewFiles.map((f) => ({ name: f.name ?? 'file' })) }
            : {}),
        },
      ])
      setRecoveredTurn(false)
      setApprovalBusy({})
      setApprovalErrors({})
      commandApprovalTurnRef.current = false
      sessionStorage.setItem(`bz_pending_${agentId}`, '1')
      const abort = new AbortController()
      currentAbortRef.current = abort
      setStreaming(true)
      setThinking(true)

      let terminalFrameReceived = false
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(interactiveChatRequest(text, atts)),
          signal: abort.signal,
        })
        if (res.status === 202) {
          const pending = (await res.json()) as {
            approvalId: string
            expiresAt: number
          }
          setLiveEntries((prev) => [
            ...prev,
            {
              type: 'error',
              content: `[approval pending] ${pending.approvalId} · expires ${new Date(pending.expiresAt).toLocaleString()} · review in /approvals`,
            },
          ])
          sessionStorage.removeItem(`bz_pending_${agentId}`)
          return
        }
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
            if (frame.kind === 'done' || frame.kind === 'fatal') terminalFrameReceived = true
            handleFrame(frame)
          }
        }
        if (buffer.trim()) {
          try {
            const frame = JSON.parse(buffer) as ChatFrame
            if (frame.kind === 'done' || frame.kind === 'fatal') terminalFrameReceived = true
            handleFrame(frame)
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
        if (currentAgentIdRef.current === agentId && currentAbortRef.current === abort) {
          if (!terminalFrameReceived && commandApprovalTurnRef.current) {
            setRecoveredTurn(true)
          }
          setThinking(false)
          setStreaming(false)
          currentAbortRef.current = null
        }
      }
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: stable refs intentional
    [agentId, editIdx, serverMessages, turnBusy, attachments],
  )

  function handleFrame(frame: ChatFrame) {
    if (currentAgentIdRef.current !== agentId) return
    if (frame.kind === 'fatal') {
      commandApprovalTurnRef.current = false
      setLiveEntries((prev) => [
        ...prev.map((entry) =>
          entry.type === 'command_approval' && entry.approval.status === 'pending'
            ? {
                type: 'command_approval' as const,
                approval: { ...entry.approval, status: 'cancelled' as const },
              }
            : entry,
        ),
        { type: 'error', content: `[fatal] ${frame.error}` },
      ])
      setRecoveredTurn(false)
      return
    }
    if (frame.kind === 'done') {
      commandApprovalTurnRef.current = false
      setServerMessages(frame.messages)
      setLiveEntries([])
      setRecoveredTurn(false)
      setApprovalBusy({})
      setApprovalErrors({})
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
    if (ev.type === 'command_approval') {
      // The chat endpoint is Agent-scoped. Keep a defensive client-side check
      // too so a malformed frame can never render an actionable card for a
      // different Agent.
      if (ev.approval.agentId !== agentId) return
      commandApprovalTurnRef.current = true
      setThinking(ev.approval.status !== 'pending' && ev.approval.status !== 'cancelled')
      setLiveEntries((entries) => upsertCommandApprovalEntry(entries, ev.approval))
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
      const images = ev.type === 'tool_result' ? ev.images : undefined
      setLiveEntries((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.type === 'tool') {
          next[next.length - 1] = { type: 'tool', items: [...last.items, item] }
        } else {
          next.push({ type: 'tool', items: [item] })
        }
        // Images are deliverables — push them as a standalone block outside the
        // tool box (this also "closes" the team, so the next tool starts fresh).
        if (images && images.length > 0) next.push({ type: 'images', images })
        return next
      })
      return
    }
    if (ev.type === 'file') {
      setLiveEntries((prev) => [
        ...prev,
        { type: 'file', name: ev.name, mimeType: ev.mimeType, data: ev.data },
      ])
      return
    }
    if (ev.type === 'error') {
      setLiveEntries((prev) => [...prev, { type: 'error', content: `[error] ${ev.error}` }])
    }
  }

  async function reconcileCommandApproval(approvalId: string): Promise<CommandApproval | null> {
    if (currentAgentIdRef.current !== agentId) return null
    try {
      const response = await fetch(shellApprovalsUrl(agentId))
      if (!response.ok) return null
      const body = (await response.json()) as ListCommandApprovalsResponse
      if (currentAgentIdRef.current !== agentId) return null
      const approval = body.approvals.find(
        (item) => item.id === approvalId && item.agentId === agentId,
      )
      if (approval) {
        setLiveEntries((entries) => upsertCommandApprovalEntry(entries, approval))
      }
      return approval ?? null
    } catch {
      return null
    }
  }

  async function decideCommandApproval(
    approval: CommandApproval,
    decision: 'allow' | 'deny',
  ) {
    if (approval.agentId !== agentId || approval.status !== 'pending') return
    setApprovalBusy((current) => ({ ...current, [approval.id]: true }))
    setApprovalErrors((current) => {
      const next = { ...current }
      delete next[approval.id]
      return next
    })
    try {
      const response = await fetch(`/api/shell-approvals/${encodeURIComponent(approval.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const body = (await response.json().catch(() => null)) as
        | (CommandApprovalDecisionResponse & { error?: string })
        | null
      if (currentAgentIdRef.current !== agentId) return
      if (body?.approval?.agentId === agentId) {
        setLiveEntries((entries) => upsertCommandApprovalEntry(entries, body.approval))
      }
      if (!response.ok) {
        const message = body?.error ?? `Decision failed (${response.status})`
        const terminalStatus = commandApprovalStatusFromConflict(message)
        if (terminalStatus) {
          setLiveEntries((entries) =>
            upsertCommandApprovalEntry(entries, { ...approval, status: terminalStatus }),
          )
          return
        }
        throw new Error(message)
      }
    } catch (error) {
      // The daemon may have committed the one-shot decision before the network
      // response was lost. Reconcile before offering a retry so Allow can never
      // look pending after it has already started the command.
      const reconciled = await reconcileCommandApproval(approval.id)
      if (currentAgentIdRef.current !== agentId) return
      if (!reconciled || reconciled.status === 'pending') {
        setApprovalErrors((current) => ({
          ...current,
          [approval.id]: error instanceof Error ? error.message : String(error),
        }))
      }
    } finally {
      if (currentAgentIdRef.current === agentId) {
        setApprovalBusy((current) => ({ ...current, [approval.id]: false }))
      }
    }
  }

  async function cancel() {
    const hasLocalStream = currentAbortRef.current !== null
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/cancel`, {
        method: 'POST',
      })
      if (currentAgentIdRef.current !== agentId) return
      if (res.ok || res.status === 204) {
        if (!hasLocalStream) {
          commandApprovalTurnRef.current = false
          setLiveEntries((entries) =>
            entries.map((entry) =>
              entry.type === 'command_approval' && entry.approval.status === 'pending'
                ? {
                    type: 'command_approval',
                    approval: { ...entry.approval, status: 'cancelled' },
                  }
                : entry,
            ),
          )
          setRecoveredTurn(false)
        }
        return
      }
    } catch {
      // fall through to local fetch abort
    }
    if (currentAgentIdRef.current !== agentId) return
    if (hasLocalStream) {
      currentAbortRef.current?.abort()
    } else {
      setLiveEntries((entries) => [
        ...entries,
        { type: 'error', content: '[cancel failed] could not reach the active turn' },
      ])
    }
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
    if (liveEntries.length > 0 || turnBusy) return -1
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
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-[16px] border border-frost bg-snow shadow-baziu-sm"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[16px] border-2 border-dashed border-sapphire bg-sapphire-glow/80 text-[0.95em] font-medium text-sapphire-deep">
          drop images or files to attach
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-b border-frost px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <a
            href="/"
            className="inline-flex h-7 items-center rounded-md border border-frost px-2 text-xs font-semibold text-mocha lg:hidden"
          >
            ← agents
          </a>
          <h1 className="truncate font-display text-[1.2rem] text-charcoal">{agentName}</h1>
        </div>
        <a
          href={`/agents/${agentId}?mode=settings`}
          className="shrink-0 text-xs text-mocha-light hover:text-sapphire"
        >
          Manage agent →
        </a>
      </div>
      {staleBanner && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mx-5 mt-2 flex items-center gap-2 rounded-md border border-sapphire bg-frost px-4 py-2 text-[0.86em] text-mocha"
        >
          <span
            className="h-2 w-2 flex-none rounded-full bg-sapphire"
            aria-hidden="true"
          />
          <span className="flex-1">
            {recoveredTurn
              ? 'the recovered turn has new activity — reload to see it'
              : 'new activity from another source — reload to see it'}
          </span>
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
        role="log"
        aria-label={`Conversation with ${agentName}`}
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={turnBusy}
        className={`min-h-[240px] flex-1 overflow-y-auto px-5 py-5 ${editIdx !== null ? 'is-editing' : ''}`}
      >
        {baseEntries.length === 0 && liveEntries.length === 0 && systemBubbles.length === 0 && (
          <p className="py-12 text-center italic text-mocha-light">Start a conversation…</p>
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
                  onCommandApprovalDecision={decideCommandApproval}
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
                onCommandApprovalDecision={decideCommandApproval}
                commandApprovalBusy={
                  entry.type === 'command_approval' && Boolean(approvalBusy[entry.approval.id])
                }
                commandApprovalError={
                  entry.type === 'command_approval'
                    ? approvalErrors[entry.approval.id]
                    : undefined
                }
              />,
            )
            flushSysUpTo(i + 1)
          }
          for (let i = 0; i < liveEntries.length; i++) {
            const entry = liveEntries[i] as RenderEntry
            out.push(
              <Bubble
                key={`l-${i}`}
                entry={entry}
                onCommandApprovalDecision={decideCommandApproval}
                commandApprovalBusy={
                  entry.type === 'command_approval' && Boolean(approvalBusy[entry.approval.id])
                }
                commandApprovalError={
                  entry.type === 'command_approval'
                    ? approvalErrors[entry.approval.id]
                    : undefined
                }
              />,
            )
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
                onCommandApprovalDecision={decideCommandApproval}
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
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {turnBusy ? `${agentName} is responding.` : 'Conversation ready.'}
      </p>

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

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-frost bg-ivory px-5 pt-3">
          {attachments.map((a, i) => {
            const remove = () => setAttachments((prev) => prev.filter((_, j) => j !== i))
            return isImageMime(a.mimeType) ? (
              <div key={`${a.mimeType}-${i}`} className="relative">
                <img
                  src={`data:${a.mimeType};base64,${a.data}`}
                  alt="pending attachment"
                  className="h-16 w-16 rounded-md border border-frost object-cover"
                />
                <button
                  type="button"
                  onClick={remove}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-frost bg-snow text-[0.7em] text-mocha hover:border-sapphire hover:text-sapphire"
                  aria-label="remove attachment"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div
                key={`${a.name ?? 'file'}-${i}`}
                className="flex items-center gap-1.5 rounded-md border border-frost bg-snow px-2 py-1 text-[0.82em] text-mocha"
              >
                <span>📄</span>
                <span className="max-w-[160px] truncate">{a.name ?? 'file'}</span>
                <button
                  type="button"
                  onClick={remove}
                  className="text-[0.85em] text-mocha hover:text-sapphire"
                  aria-label="remove attachment"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

      <form
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2 border-t border-frost bg-ivory px-3 py-3 sm:px-5"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={turnBusy}
          title="attach images or files"
          aria-label="attach files"
          className="rounded-md border-[1.5px] border-frost bg-snow px-3 py-2 text-[1em] text-mocha transition-colors hover:border-sapphire hover:text-sapphire disabled:cursor-not-allowed disabled:opacity-50"
        >
          📎
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={turnBusy}
          placeholder="say something… (Shift+Enter for newline; paste or 📎 to attach images/files)"
          autoComplete="off"
          aria-label={`Message ${agentName}`}
          className="max-h-[200px] min-h-[2.4rem] flex-1 resize-none overflow-y-auto rounded-md border-[1.5px] border-frost bg-snow px-3 py-2 text-[0.93em] leading-[1.45] text-chocolate outline-none transition-colors focus:border-sapphire focus:shadow-[0_0_0_3px_var(--color-sapphire-glow)]"
        />
        {turnBusy ? (
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel current response"
            className="rounded-md border-[1.5px] border-danger bg-transparent px-3 py-2 text-[0.92em] font-medium text-danger hover:bg-danger/10"
          >
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() && attachments.length === 0}
            className="rounded-md bg-sapphire px-4 py-2 text-[0.92em] font-semibold text-snow transition-colors hover:bg-sapphire-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        )}
      </form>
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title={`Reset chat with ${agentName}?`}
        description={
          <p>
            This permanently wipes the persisted session history for this Agent. Agent files,
            Team memory, and other Agent settings are not changed.
          </p>
        }
        confirmLabel="Reset chat history"
        onConfirm={async () => {
          try {
            await performReset()
          } catch (error) {
            pushSystem(`/reset failed: ${error instanceof Error ? error.message : String(error)}`)
            throw error
          }
        }}
      />
    </div>
  )
}

interface BubbleProps {
  entry: RenderEntry
  isLastUser?: boolean
  isWillDrop?: boolean
  onEdit?: () => void
  onCommandApprovalDecision?: (
    approval: CommandApproval,
    decision: 'allow' | 'deny',
  ) => void
  commandApprovalBusy?: boolean
  commandApprovalError?: string
}

function Bubble({
  entry,
  isLastUser,
  isWillDrop,
  onEdit,
  onCommandApprovalDecision,
  commandApprovalBusy,
  commandApprovalError,
}: BubbleProps) {
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
      <div className={`team relative my-4 flex flex-col items-end ${dropCls}`}>
        <span className="sr-only">you</span>
        {entry.images && entry.images.length > 0 && (
          <div className="mb-1 flex max-w-[85%] flex-wrap justify-end gap-1">
            {entry.images.map((img, i) => (
              <img
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only within one message
                key={i}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt="attachment"
                className="max-h-48 rounded-lg border border-sapphire-light"
              />
            ))}
          </div>
        )}
        {entry.files && entry.files.length > 0 && (
          <div className="mb-1 flex max-w-[85%] flex-wrap justify-end gap-1">
            {entry.files.map((f, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only within one message
                key={i}
                className="flex items-center gap-1 rounded-md border border-sapphire-light bg-sapphire-glow px-2 py-1 text-[0.8em] text-chocolate"
              >
                📄 <span className="max-w-[180px] truncate">{f.name}</span>
              </span>
            ))}
          </div>
        )}
        {entry.content && (
          <div className="bubble-content max-w-[85%] whitespace-pre-wrap break-words rounded-[14px_14px_4px_14px] border border-sapphire-light bg-sapphire-glow px-3 py-2 text-chocolate">
            {entry.content}
          </div>
        )}
        {isLastUser && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            title="edit and resend — replaces the last turn"
            className="absolute left-1 top-1 rounded-sm border border-fawn bg-ivory px-2 py-0.5 text-[0.78em] font-medium text-mocha opacity-65 transition hover:border-sapphire hover:bg-sapphire-glow hover:text-sapphire hover:opacity-100 team-hover:opacity-100 team-focus-within:opacity-100"
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
          <span className="mb-1 text-[0.72em] font-semibold uppercase tracking-wider text-danger">
            error
          </span>
          <div
            className="bubble-content rounded-r-sm border-l-[3px] border-l-danger bg-danger/10 py-1 pl-3 pr-2 leading-[1.55]"
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
  if (entry.type === 'images') {
    return (
      <div className={`my-2 space-y-2 ${dropCls}`}>
        {entry.images.map((img, i) => (
          <img
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only within one result
            key={i}
            src={`data:${img.mimeType};base64,${img.data}`}
            alt="screenshot"
            className="block max-w-full rounded-lg border border-fawn"
          />
        ))}
      </div>
    )
  }
  if (entry.type === 'file') {
    const isImage = entry.mimeType.startsWith('image/')
    const href = `data:${entry.mimeType};base64,${entry.data}`
    return (
      <div className={`my-2 ${dropCls}`}>
        {isImage && (
          <img src={href} alt={entry.name} className="mb-1 block max-w-full rounded-lg border border-fawn" />
        )}
        <a
          href={href}
          download={entry.name}
          className="inline-flex items-center gap-2 rounded-md border border-fawn bg-ivory px-3 py-2 text-[0.88em] text-mocha hover:border-sapphire hover:text-sapphire"
        >
          <span>📄</span>
          <span className="max-w-[260px] truncate">{entry.name}</span>
          <span className="text-[0.85em] opacity-70">download</span>
        </a>
      </div>
    )
  }
  if (entry.type === 'command_approval') {
    return (
      <CommandApprovalCard
        approval={entry.approval}
        busy={commandApprovalBusy}
        error={commandApprovalError}
        onDecision={onCommandApprovalDecision}
      />
    )
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
      <div className={`my-3 rounded-r-sm border-l-[3px] border-danger bg-danger/10 px-3 py-1 text-[0.92em] text-danger ${dropCls}`}>
        {entry.content}
      </div>
    )
  }
  return null
}

export function CommandApprovalCard({
  approval,
  busy = false,
  error,
  onDecision,
}: {
  approval: CommandApproval
  busy?: boolean
  error?: string
  onDecision?: (approval: CommandApproval, decision: 'allow' | 'deny') => void
}) {
  const pending = approval.status === 'pending'

  return (
    <section
      className="my-3 rounded-lg border border-danger/50 bg-danger/5 p-4 text-chocolate"
      aria-label="Shell command approval"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="m-0 text-[0.72em] font-semibold uppercase tracking-wider text-danger">
            Shell command approval
          </p>
          <h2 className="m-0 mt-1 font-body text-[0.95em] font-semibold">
            {pending ? 'A risky command is waiting for you' : 'Command decision recorded'}
          </h2>
        </div>
        <span className="rounded-full border border-danger/30 px-2 py-0.5 text-[0.75em] font-semibold uppercase tracking-wide text-danger">
          {approval.status.replaceAll('_', ' ')}
        </span>
      </div>

      <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-fawn bg-snow p-3 font-mono text-[0.82em] leading-[1.45] text-charcoal">
        {approval.command}
      </pre>

      <ul className="mt-3 space-y-1.5 pl-5 text-[0.84em] leading-[1.4] text-mocha">
        {approval.risks.map((risk) => (
          <li key={`${risk.code}:${risk.span.start}:${risk.span.end}`}>
            <span className="font-medium text-chocolate">{risk.message}</span>{' '}
            <code className="text-[0.9em]">{risk.code}</code>
          </li>
        ))}
      </ul>

      {pending ? (
        <>
          <p className="mt-3 text-[0.78em] text-mocha-light">
            This approval expires{' '}
            <time dateTime={new Date(approval.expiresAt).toISOString()}>
              {new Date(approval.expiresAt).toLocaleString()}
            </time>
            . Deny blocks only this command; cancel stops the whole turn.
          </p>
          {error && (
            <p role="alert" className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-[0.82em] text-danger">
              {error}
            </p>
          )}
          {onDecision && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => onDecision(approval, 'deny')}
              >
                Deny
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => onDecision(approval, 'allow')}
              >
                Allow once
              </Button>
            </div>
          )}
        </>
      ) : (
        <p role="status" className="mt-3 text-[0.84em] font-medium text-mocha">
          {commandApprovalStatusCopy(approval.status)}
        </p>
      )}
    </section>
  )
}

function commandApprovalStatusCopy(status: CommandApproval['status']): string {
  switch (status) {
    case 'pending':
      return 'Waiting for a decision.'
    case 'allowed':
      return 'Allowed once — the command may run for this tool call only.'
    case 'denied':
      return 'Denied — the command was not run.'
    case 'auto_denied':
      return 'Automatically denied — no interactive approval path was available.'
    case 'expired':
      return 'Expired — the command was not run.'
    case 'cancelled':
      return 'Cancelled — the command was not run.'
  }
}

function commandApprovalStatusFromConflict(
  message: string,
): Exclude<CommandApproval['status'], 'pending'> | null {
  const prefix = 'shell approval already decided: '
  if (!message.startsWith(prefix)) return null
  const status = message.slice(prefix.length)
  switch (status) {
    case 'allowed':
    case 'denied':
    case 'auto_denied':
    case 'expired':
    case 'cancelled':
      return status
    default:
      return null
  }
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
  // Images are rendered by ToolGroup outside the height clip (they're
  // deliverables, not collapsible scaffolding) — here we only show the text.
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
