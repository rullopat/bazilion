// The bar above a conversation: who it is with, in which Team, on which model, which of the
// Agent's conversations it is, and the switch for the side panel.

import type { Conversation, ConversationListResponse, ResolvedAgent } from '@bazilion/api-types'
import { Link, useRouter } from '@tanstack/react-router'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  MessageSquare,
  PanelRight,
  Pencil,
  Plus,
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useState } from 'react'
import { shortTime, useActivity } from '../../lib/activity'
import { api, errorMessage } from '../../lib/api'
import { useHydrated, useResource } from '../../lib/use-resource'
import { cn } from '../../lib/utils'
import type { PanelTab } from '../../lib/workspace'
import { AgentAvatar } from '../AgentAvatar'
import { Button } from '../Button'
import type { ChatControls } from '../chat/ChatPane'
import { Dialog, DialogActions } from '../Dialog'
import { useWorkspace } from './context'

const CHIP =
  'inline-flex h-[26px] shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2.5 text-xs font-semibold text-mocha hover:border-sapphire-light hover:text-sapphire'
const MENU_ITEM =
  'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

/** The model without its provider: `lmstudio:paper-coder-32b` reads as `paper-coder-32b`. */
function shortModel(model: string): string {
  const colon = model.indexOf(':')
  return colon > 0 ? model.slice(colon + 1) : model
}

export function ConversationHeader({
  agent,
  chat,
  panel,
  lastPanel,
}: {
  agent: ResolvedAgent
  /** Absent while an earlier conversation is being read. */
  chat?: ChatControls
  /** The side panel's tab, or `none` when it is hidden. */
  panel: PanelTab | 'none'
  /** The tab the panel reopens on. */
  lastPanel: PanelTab
}) {
  const { to } = useWorkspace()
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-frost px-3 py-2.5 sm:px-4">
      <Link
        to="/"
        search={{}}
        aria-label="Back to the list of agents"
        className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-border text-mocha lg:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
      </Link>
      <AgentAvatar identity={agent.agent.identity} size={32} />
      <h1 className="m-0 min-w-0 truncate font-display text-[1.2rem] leading-tight text-charcoal">
        {agent.agent.name}
      </h1>
      <Link to="/" search={to({ panel: 'team', section: undefined })} className={CHIP}>
        {agent.team.name}
      </Link>
      <Link
        to="/"
        search={to({ panel: 'agent', section: undefined })}
        title={`Model: ${agent.model}`}
        className={cn(CHIP, 'hidden font-mono font-normal sm:inline-flex')}
      >
        {shortModel(agent.model)}
        <ChevronDown className="size-[11px]" aria-hidden="true" />
      </Link>
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <ConversationMenu agentId={agent.agent.id} chat={chat} />
        <Link
          to="/"
          search={to({ panel: panel === 'none' ? lastPanel : 'none', section: undefined })}
          aria-label={panel === 'none' ? 'Show the side panel' : 'Hide the side panel'}
          title={panel === 'none' ? 'Show the side panel' : 'Hide the side panel'}
          aria-pressed={panel !== 'none'}
          className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] border ${
            panel === 'none'
              ? 'border-border bg-card text-mocha hover:text-sapphire'
              : 'border-primary/25 bg-accent text-accent-foreground'
          }`}
        >
          <PanelRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}

/** The Agent's conversations: read an earlier one, continue it, start a new one, rename. */
function ConversationMenu({ agentId, chat }: { agentId: string; chat?: ChatControls }) {
  const { search, to } = useWorkspace()
  const { turnsEnded } = useActivity()
  const router = useRouter()
  const hydrated = useHydrated()
  const base = `/api/agents/${encodeURIComponent(agentId)}/conversations`
  const [ownOpen, setOwnOpen] = useState(false)
  const [renaming, setRenaming] = useState<Conversation | null>(null)
  const [error, setError] = useState('')
  // A finished turn may have named the conversation after its first message.
  const list = useResource(
    (signal) => api<ConversationListResponse>(`${base}?limit=20`, { signal }),
    [base, turnsEnded],
  )
  const open = chat ? chat.conversationsOpen : ownOpen
  const setOpen = chat ? chat.setConversationsOpen : setOwnOpen
  const conversations = list.data?.conversations ?? []
  const activeId = list.data?.selectedId ?? null
  const shownId = search.conversation ?? activeId
  const shown = conversations.find((conversation) => conversation.id === shownId)

  async function startNew() {
    setError('')
    try {
      await api(base, { body: {} })
      if (chat) {
        // The chat on screen loads the new, empty conversation.
        await chat.reload()
      } else {
        // An earlier conversation was being read: the chat that opens next starts from the
        // page's data, so that is loaded again, and waited for, before leaving.
        await router.invalidate({ sync: true })
        await router.navigate({ to: '/', search: to({ conversation: undefined }) })
      }
      await list.reload()
    } catch (cause) {
      setError(errorMessage(cause))
      setOpen(true)
    }
  }

  return (
    <>
      <DropdownMenu.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) void list.reload()
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Conversations"
            className="unstyled inline-flex h-8 min-w-0 max-w-[15rem] items-center gap-1.5 rounded-[10px] border border-border bg-card px-2.5 text-[0.82rem] font-semibold text-foreground hover:border-sapphire-light"
          >
            <MessageSquare className="size-[15px] shrink-0 text-mocha" aria-hidden="true" />
            <span className="min-w-0 truncate">{shown?.title ?? 'Conversations'}</span>
            <ChevronDown className="size-3 shrink-0 text-mocha" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 max-h-[70vh] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg outline-none"
          >
            <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Conversations
            </DropdownMenu.Label>
            {list.error && (
              <p role="alert" className="m-0 px-2.5 py-1.5 text-xs text-danger">
                {list.error}
              </p>
            )}
            {error && (
              <p role="alert" className="m-0 px-2.5 py-1.5 text-xs text-danger">
                {error}
              </p>
            )}
            {!list.data && !list.error && (
              <p role="status" className="m-0 px-2.5 py-2 text-sm text-muted-foreground">
                Loading…
              </p>
            )}
            {list.data && conversations.length === 0 && (
              <p className="m-0 px-2.5 py-2 text-sm text-muted-foreground">
                The first message starts the first conversation.
              </p>
            )}
            {conversations.map((conversation) => {
              const active = conversation.id === activeId
              const reading = conversation.id === shownId
              return (
                <DropdownMenu.Item key={conversation.id} asChild className={MENU_ITEM}>
                  <Link
                    to="/"
                    search={to({ conversation: active ? undefined : conversation.id })}
                    aria-current={reading ? 'true' : undefined}
                    className={reading ? 'bg-accent/70 text-accent-foreground' : ''}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {conversation.title}
                    </span>
                    {active ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-success">
                        <Check className="size-3" aria-hidden="true" />
                        Active
                      </span>
                    ) : (
                      hydrated && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {shortTime(conversation.createdAt)}
                        </span>
                      )
                    )}
                  </Link>
                </DropdownMenu.Item>
              )
            })}
            {list.data && list.data.total > conversations.length && (
              <p className="m-0 px-2.5 py-1.5 text-xs text-muted-foreground">
                The newest {conversations.length} of {list.data.total}.{' '}
                <code>bazilion conversation list</code> shows them all.
              </p>
            )}
            <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
            <DropdownMenu.Item
              className={`${MENU_ITEM} font-semibold`}
              disabled={chat?.agentBusy ?? false}
              onSelect={() => void startNew()}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New conversation
              {chat?.agentBusy && (
                <span className="ml-auto text-xs font-normal">after this turn</span>
              )}
            </DropdownMenu.Item>
            {shown && (
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setRenaming(shown)}>
                <Pencil className="size-3.5" aria-hidden="true" />
                Rename “{shown.title.length > 24 ? `${shown.title.slice(0, 24)}…` : shown.title}”
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {renaming && (
        <RenameConversation
          base={base}
          conversation={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={() => list.reload()}
        />
      )}
    </>
  )
}

function RenameConversation({
  base,
  conversation,
  onClose,
  onRenamed,
}: {
  base: string
  conversation: Conversation
  onClose: () => void
  onRenamed: () => Promise<void>
}) {
  const [title, setTitle] = useState(conversation.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unchanged = !title.trim() || title.trim() === conversation.title

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (unchanged) return
    setBusy(true)
    setError('')
    try {
      await api(`${base}/${encodeURIComponent(conversation.id)}`, {
        method: 'PATCH',
        body: { title: title.trim() },
      })
      await onRenamed()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog title="Rename the conversation" busy={busy} onClose={onClose} className="max-w-md">
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Title
          <input
            autoFocus
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4">
          <DialogActions>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy || unchanged}>
              {busy ? 'Renaming…' : 'Rename'}
            </Button>
          </DialogActions>
        </div>
      </form>
    </Dialog>
  )
}
