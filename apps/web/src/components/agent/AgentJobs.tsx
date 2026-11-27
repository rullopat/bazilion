// An Agent's background jobs: commands it started to keep running (a dev server, a watcher, a
// long build). Each runs until it ends or is stopped; when one ends, the Agent hears of it in the
// conversation that started it.

import type { Agent, Job, JobDetail, JobResponse, ListJobsResponse } from '@bazilion/api-types'
import { SquareTerminal } from 'lucide-react'
import { useState } from 'react'
import { useActivity } from '../../lib/activity'
import { api, errorMessage } from '../../lib/api'
import type { Tone } from '../../lib/model-facts'
import { useHydrated, useResource } from '../../lib/use-resource'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { CardEmpty, CardList, Chip, ListRow, Notice, SetupCard } from '../ui/parts'

function stateOf(job: Job): { label: string; tone: Tone } {
  if (job.status === 'running') return { label: 'Running', tone: 'success' }
  if (job.status === 'exited') {
    return job.exitCode === 0
      ? { label: 'Done', tone: 'neutral' }
      : { label: `Ended with code ${job.exitCode}`, tone: 'warning' }
  }
  if (job.stoppedBy === 'owner') return { label: 'Stopped by you', tone: 'neutral' }
  if (job.stoppedBy === 'agent') return { label: 'Stopped by the Agent', tone: 'neutral' }
  return { label: 'Stopped by a restart', tone: 'neutral' }
}

export function AgentJobs({ agent }: { agent: Agent }) {
  const activity = useActivity()
  // A job that starts or ends changes the count, which loads the list again.
  const running = activity.byAgent.get(agent.id)?.jobs ?? 0
  const path = `/api/agents/${encodeURIComponent(agent.id)}/jobs`
  const data = useResource((signal) => api<ListJobsResponse>(path, { signal }), [path], {
    refreshOn: running,
  })
  if (!data.data) {
    return data.error ? (
      <Notice role="alert" title="The jobs could not be loaded.">
        {data.error}
      </Notice>
    ) : (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Loading the jobs…
      </p>
    )
  }
  return <JobsView agentName={agent.name} jobs={data.data.jobs} onChanged={data.reload} />
}

export function JobsView({
  agentName,
  jobs,
  onChanged,
}: {
  agentName: string
  jobs: Job[]
  onChanged: () => Promise<void>
}) {
  const hydrated = useHydrated()
  const [open, setOpen] = useState<string | null>(null)
  const [stopping, setStopping] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const when = (at: number) => (hydrated ? new Date(at).toLocaleString() : '')

  async function stop(job: Job) {
    setError(null)
    try {
      await api(`/api/jobs/${encodeURIComponent(job.id)}/stop`, { method: 'POST', body: {} })
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <div className="grid gap-5">
      <SetupCard
        labelledBy="agent-jobs"
        icon={<SquareTerminal className="size-5" />}
        title="Background jobs"
        description={`Commands ${agentName} started to keep running. Each runs until it ends or is stopped; when one ends, ${agentName} hears of it.`}
      >
        {error && (
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <Notice role="alert" title="That did not work.">
              {error}
            </Notice>
          </div>
        )}
        {jobs.length === 0 ? (
          <CardEmpty icon={<SquareTerminal className="size-5" />} title="No jobs yet">
            When {agentName} starts a command that keeps running, a dev server or a long build, it
            shows here with its output.
          </CardEmpty>
        ) : (
          <CardList>
            {jobs.map((job) => {
              const state = stateOf(job)
              return (
                <ListRow
                  key={job.id}
                  title={<code className="font-mono text-[0.92em]">{job.command}</code>}
                  chip={<Chip tone={state.tone}>{state.label}</Chip>}
                  meta={
                    <>
                      <span>Started {when(job.startedAt)}</span>
                      {job.endedAt && <span>Ended {when(job.endedAt)}</span>}
                      <span>
                        {job.sandbox === 'docker' ? 'In Docker' : 'On this computer'}, {job.cwd}
                      </span>
                    </>
                  }
                  actions={
                    <>
                      <Button
                        variant="ghost"
                        aria-expanded={open === job.id}
                        onClick={() => setOpen(open === job.id ? null : job.id)}
                      >
                        {open === job.id ? 'Hide output' : 'Output'}
                      </Button>
                      {job.status === 'running' && (
                        <Button variant="danger" onClick={() => setStopping(job)}>
                          Stop
                        </Button>
                      )}
                    </>
                  }
                >
                  {open === job.id && <JobOutput id={job.id} status={job.status} />}
                </ListRow>
              )
            })}
          </CardList>
        )}
      </SetupCard>
      <ConfirmDialog
        open={stopping !== null}
        title="Stop this job?"
        description={
          stopping && (
            <>
              <code>{stopping.command}</code> stops now. {agentName} hears that you stopped it.
            </>
          )
        }
        confirmLabel="Stop"
        onOpenChange={(next) => {
          if (!next) setStopping(null)
        }}
        onConfirm={async () => {
          const job = stopping
          setStopping(null)
          if (job) await stop(job)
        }}
      />
    </div>
  )
}

function JobOutput({ id, status }: { id: string; status: Job['status'] }) {
  const path = `/api/jobs/${encodeURIComponent(id)}`
  const data = useResource(
    (signal) => api<JobResponse>(path, { signal }).then((body): JobDetail => body.job),
    [path, status],
  )
  if (!data.data) {
    return data.error ? (
      <p role="alert" className="m-0 text-sm text-danger">
        {data.error}
      </p>
    ) : (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Loading the output…
      </p>
    )
  }
  const job = data.data
  return (
    <div className="grid gap-1.5">
      {job.outputCut && <p className="m-0 text-xs text-muted-foreground">The end of the output:</p>}
      <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-snow p-3 font-mono text-[0.8em] leading-[1.45] text-charcoal">
        {job.output || 'No output yet.'}
      </pre>
      {job.status === 'running' && (
        <div>
          <Button variant="ghost" onClick={() => void data.reload()}>
            Refresh
          </Button>
        </div>
      )}
    </div>
  )
}
