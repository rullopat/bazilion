import type { Agent, Team, HealthReport, ResolvedTeamPolicy } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  EmptyState,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
} from '../../components/Page'
import { RecoveryState } from '../../components/RecoveryState'
import { daemonClient } from '../../lib/daemon-client'

interface TeamsData {
  teams: Team[]
  memberCounts: Record<string, number>
  policies: Record<string, { revision: number; baseline: string | null; edges: number }>
  readiness: HealthReport['teamPolicyManagement']
}

const fetchTeamsData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TeamsData> => {
    const c = daemonClient()
    const [teams, agents, health] = await Promise.all([
      c.get<Team[]>('/api/teams'),
      c.get<Agent[]>('/api/agents?includeArchived=true'),
      c.get<HealthReport>('/api/health/details'),
    ])
    const memberCounts: Record<string, number> = {}
    for (const a of agents) memberCounts[a.teamId] = (memberCounts[a.teamId] ?? 0) + 1
    const policies: TeamsData['policies'] = {}
    await Promise.all(teams.map(async (team) => {
      const detail = await c.get<ResolvedTeamPolicy>(`/api/teams/${encodeURIComponent(team.id)}/policy`)
      policies[team.id] = {
        revision: detail.teamPolicy.revision,
        baseline: detail.baseline ? `${detail.baseline.templateId} r${detail.baseline.templateRevision}` : null,
        edges: detail.edges.length,
      }
    }))
    return { teams, memberCounts, policies, readiness: health.teamPolicyManagement }
  },
)

export const Route = createFileRoute('/teams/')({
  loader: () => fetchTeamsData(),
  component: TeamsPage,
  errorComponent: ({ error, reset }) => <RecoveryState title="Teams unavailable" error={error} reset={reset} fallbackHref="/" />,
})

function TeamsPage() {
  const { teams, memberCounts, policies, readiness } = Route.useLoaderData()
  const router = useRouter()
  const [removeTarget, setRemoveTarget] = useState<Team | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function remove(id: string) {
    const revision = policies[id]?.revision
    if (!revision) throw new Error('The Team policy revision is unavailable. Nothing was removed.')
    const res = await fetch(
      `/api/teams/${encodeURIComponent(id)}?expectedTeamPolicyRevision=${revision}`,
      { method: 'DELETE' },
    )
    if (!res.ok && res.status !== 204) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `Could not remove Team (${res.status})`)
    }
    await router.invalidate()
  }

  return (
    <PageShell size="wide">
      <PageHeader
        eyebrow="Workspace"
        title="Teams"
        description="Each Team owns one workspace, one live membership roster, and one effective communication policy. Every agent belongs to exactly one Team."
      />

      <SectionCard
        title="Policy enforcement"
        description={`Management contract v${readiness.contractVersion} is ready for this daemon.`}
        actions={
          <StatusBadge variant={readiness.enforcementActive ? 'success' : 'warning'}>
            {readiness.enforcementActive ? 'Enforcement on' : 'Enforcement off'}
          </StatusBadge>
        }
        aria-label="Team Policy enforcement readiness"
      >
        <p className="text-sm text-muted-foreground">
          {readiness.enforcementActive ? (
            'Communication boundaries are currently enforcing each Team policy.'
          ) : (
            <>
              Set <code>BAZILION_TEAM_POLICY_ENFORCEMENT=on</code> and restart the daemon to
              enforce Team policies.
            </>
          )}
        </p>
      </SectionCard>

      <RegisterTeamForm onRegistered={() => router.invalidate()} />

      {actionError && <p role="alert" className="err">{actionError}</p>}

      <SectionCard
        title="Registered teams"
        description="Open a Team to manage its context, members, shared memory, and policy."
      >
        {teams.length === 0 ? (
          <EmptyState
            title="No teams registered"
            description="Register a Team above to create a workspace for your agents."
          />
        ) : (
          <>
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[820px]">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Members</th>
                  <th>Policy</th>
                  <th>Baseline</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {teams.map((g) => {
                  const count = memberCounts[g.id] ?? 0
                  const policy = policies[g.id]
                  return (
                    <tr key={g.id}>
                      <td>
                        <code>{g.id}</code>
                      </td>
                      <td>
                        <a href={`/teams/${g.id}`}>{g.name}</a>
                      </td>
                      <td>{count}</td>
                      <td>
                        <a href={`/teams/${g.id}/policy`}>
                          {policy ? `r${policy.revision} · ${policy.edges} edges` : 'Unavailable'}
                        </a>
                      </td>
                      <td>{policy?.baseline ?? 'None'}</td>
                      <td>
                        <div className="flex justify-end">
                          {count === 0 ? (
                            <Button variant="danger" onClick={() => setRemoveTarget(g)}>
                              Remove
                            </Button>
                          ) : (
                            <StatusBadge
                              variant="neutral"
                              title={`${count} agent(s) belong to this Team`}
                            >
                              In use
                            </StatusBadge>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {teams.map((team) => {
              const count = memberCounts[team.id] ?? 0
              const policy = policies[team.id]
              return (
                <article key={team.id} className="min-w-0 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a
                        href={`/teams/${encodeURIComponent(team.id)}`}
                        className="block truncate font-semibold text-foreground"
                      >
                        {team.name}
                      </a>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {team.id}
                      </p>
                    </div>
                    <StatusBadge variant={count > 0 ? 'success' : 'neutral'}>
                      {count} member{count === 1 ? '' : 's'}
                    </StatusBadge>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg bg-muted p-2">
                      <dt className="font-semibold text-muted-foreground">Policy</dt>
                      <dd className="mt-0.5">
                        <a href={`/teams/${encodeURIComponent(team.id)}/policy`}>
                          {policy ? `Revision ${policy.revision} · ${policy.edges} edges` : 'Unavailable'}
                        </a>
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted p-2">
                      <dt className="font-semibold text-muted-foreground">Baseline</dt>
                      <dd className="mt-0.5 break-words">{policy?.baseline ?? 'None'}</dd>
                    </div>
                  </dl>
                  {count === 0 && (
                    <div className="mt-3">
                      <Button variant="danger" onClick={() => setRemoveTarget(team)}>
                        Remove Team
                      </Button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title={`Remove ${removeTarget?.name ?? 'Team'}?`}
        description={
          <p>
            This removes the empty Team registration and its Bazilion-managed workspace slot.
            If the slot is a symlink, its external target is not deleted. This action cannot be
            undone from the web UI.
          </p>
        }
        confirmLabel="Remove Team"
        onConfirm={async () => {
          if (!removeTarget) return
          try {
            await remove(removeTarget.id)
          } catch (error) {
            setActionError(error instanceof Error ? error.message : String(error))
            throw error
          }
        }}
      />
    </PageShell>
  )
}

function RegisterTeamForm({ onRegistered }: { onRegistered: () => void }) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErr(null)
    if (!id.trim()) {
      setErr('id is required')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: id.trim(),
          name: name.trim() || undefined,
          link: link.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const e2 = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e2?.error ?? res.statusText)
      }
      setId('')
      setName('')
      setLink('')
      onRegistered()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SectionCard
      title="Register a team"
      description={
        <>
          Teams live under <code>~/.bazilion/teams/&lt;slug&gt;/</code>. Link an existing project
          directory or leave the target blank to create a fresh workspace.
        </>
      }
    >
      <form onSubmit={submit}>
        {err && <div role="alert" className="err">{err}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            ID (slug)
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              required
              placeholder="my-project"
            />
          </label>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My project"
            />
          </label>
          <label className="sm:col-span-2">
            Link target (optional, absolute path)
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/home/user/projects/my-project"
            />
          </label>
        </div>
        <div className="mt-4">
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? 'Registering…' : 'Register team'}
          </Button>
        </div>
      </form>
    </SectionCard>
  )
}
