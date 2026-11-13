// The Agent page frame: header, lifecycle actions and section tabs around the chat, inbox,
// triggers, learning and settings views.

import type { ResolvedAgent } from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createFileRoute, Outlet, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { type ReactNode, useState } from 'react'
import { AgentAvatar } from '../../../components/AgentAvatar'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { CopyButton } from '../../../components/CopyButton'
import { PageShell, StatusBadge } from '../../../components/Page'
import { AGENT_TABS, SectionTabs } from '../../../components/SectionTabs'
import { archiveAgent, deleteAgent, unarchiveAgent } from '../../../lib/agent-actions'
import { errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const fetchAgent = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<ResolvedAgent | null> => {
    try {
      return await daemonClient().get<ResolvedAgent>(`/api/agents/${encodeURIComponent(data.id)}`)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null
      throw error
    }
  })

export const Route = createFileRoute('/agents/$id')({
  loader: async ({ params }) => {
    const resolved = await fetchAgent({ data: { id: params.id } })
    if (!resolved) throw redirect({ to: '/agents' })
    return resolved
  },
  component: AgentLayout,
})

function AgentLayout() {
  const resolved = Route.useLoaderData()
  const { agent } = resolved
  const router = useRouter()
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const archived = agent.status === 'archived'

  async function restore() {
    setError(null)
    try {
      await unarchiveAgent(agent.id)
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <PageShell>
      <header className="mb-8">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar identity={agent.identity} size={44} />
          <div className="min-w-0">
            <h1 className="mb-0 break-words">{agent.name}</h1>
            {(agent.identity?.creature || agent.identity?.vibe) && (
              <p className="muted mt-0.5 text-sm">
                {[agent.identity?.creature, agent.identity?.vibe].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Tag>
            <span className="min-w-0 select-all break-all px-1.5 font-mono text-[0.95em] text-mocha">
              {agent.id}
            </span>
            <CopyButton value={agent.id} ariaLabel="Copy agent UUID" title="Copy UUID" />
          </Tag>
          <Tag>
            status: <span className="ml-1">{agent.status}</span>
          </Tag>
          <Tag>
            profile: <code className="ml-1 bg-transparent px-0">{resolved.profile.id}</code>
          </Tag>
          <Tag>
            team:{' '}
            <a
              href={`/teams/${encodeURIComponent(resolved.team.id)}`}
              className="ml-1 font-mono underline"
            >
              {resolved.team.id}
            </a>{' '}
            ·{' '}
            <a
              href={`/teams/${encodeURIComponent(resolved.team.id)}/memory`}
              className="ml-0.5 underline"
            >
              shared memory →
            </a>
          </Tag>
          <Tag>
            model: <code className="ml-1 break-all bg-transparent px-0">{resolved.model}</code>
          </Tag>
          <Tag>
            reasoning: <code className="ml-1 bg-transparent px-0">{resolved.reasoningLevel}</code>
          </Tag>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {archived ? (
            <Button variant="ghost" onClick={() => void restore()}>
              Restore
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm('archive')}>
              Archive
            </Button>
          )}
          <Button variant="danger" onClick={() => setConfirm('delete')}>
            Delete permanently
          </Button>
        </div>
      </header>

      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {archived && (
        <div className="mb-4 rounded-md border border-frost bg-fawn/35 px-4 py-2 text-[0.9em] text-chocolate">
          <strong className="text-warning">This agent is archived.</strong> It is hidden from the
          agent lists and receives no work. Restore it above, or delete it permanently.
        </div>
      )}

      <SectionTabs
        label="Agent sections"
        base={`/agents/${encodeURIComponent(agent.id)}`}
        tabs={AGENT_TABS}
      >
        {archived && (
          <StatusBadge variant="warning" className="ml-auto self-center uppercase tracking-wide">
            archived
          </StatusBadge>
        )}
      </SectionTabs>

      <Outlet />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={
          confirm === 'delete' ? `Delete ${agent.name} permanently?` : `Archive ${agent.name}?`
        }
        description={
          confirm === 'delete' ? (
            <p>
              This permanently removes messages, triggers, skill attachments, sessions, and the
              Agent's private on-disk directory. This cannot be undone.
            </p>
          ) : (
            <p>
              The Agent will stop receiving normal work and disappear from current lists. You can
              restore it later from “Show archived”.
            </p>
          )
        }
        confirmLabel={confirm === 'delete' ? 'Delete permanently' : 'Archive Agent'}
        confirmVariant={confirm === 'delete' ? 'danger' : 'primary'}
        onConfirm={async () => {
          if (confirm === 'delete') {
            await deleteAgent(agent.id)
            window.location.assign('/agents')
          } else {
            await archiveAgent(agent.id)
            await router.invalidate()
          }
        }}
      />
    </PageShell>
  )
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 break-all rounded-full border border-frost bg-ivory px-3 py-0.5 text-[0.84em] text-mocha-light">
      {children}
    </span>
  )
}
