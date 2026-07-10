import type { Agent, Group, Profile } from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ArrowRight, Bot, Boxes, Network, ShieldAlert } from 'lucide-react'
import { BindLiveHarnessDialog, CreateHarnessDialog, ResetHarnessPrototypeButton } from '../../components/harness/HarnessDialogs'
import { PrototypeBadge } from '../../components/harness/PrototypeBadge'
import { useHarnessPrototype } from '../../hooks/use-harness-prototype'
import { diffLiveHarness } from '../../lib/harness-prototype'
import { HARNESS_PRESET_META, formatHarnessTime } from '../../lib/harness-presenter'
import { daemonClient } from '../../lib/daemon-client'

interface HarnessesLoaderData {
  groups: Group[]
  agents: Agent[]
  profiles: Profile[]
}

const fetchHarnessInputs = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HarnessesLoaderData> => {
    const client = daemonClient()
    const [groups, agents, profiles] = await Promise.all([
      client.get<Group[]>('/api/groups'),
      client.get<Agent[]>('/api/agents?includeArchived=true'),
      client.get<Profile[]>('/api/profiles'),
    ])
    return { groups, agents, profiles }
  },
)

export const Route = createFileRoute('/harnesses/')({
  loader: () => fetchHarnessInputs(),
  component: HarnessesPage,
})

function HarnessesPage() {
  const { groups, agents, profiles } = Route.useLoaderData()
  const { state, hydrated } = useHarnessPrototype()

  return (
    <div className="mx-auto max-w-6xl pb-10">
      <header className="flex flex-col gap-4 border-b border-frost pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h1 className="mb-0">harnesses</h1>
            <PrototypeBadge />
          </div>
          <p className="max-w-2xl text-sm leading-6 text-mocha">
            Shape who may talk to whom, inspect live teams, and test denied paths. Policy changes
            stay in this browser and are not enforced by the daemon.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CreateHarnessDialog profiles={profiles} />
          <BindLiveHarnessDialog groups={groups} agents={agents} />
          <ResetHarnessPrototypeButton />
        </div>
      </header>

      {!hydrated ? (
        <div className="py-16 text-center text-sm text-mocha-light">Loading local harnesses...</div>
      ) : (
        <>
          <section className="py-7">
            <div className="mb-3 flex items-center gap-2">
              <Boxes className="h-4 w-4 text-sapphire" aria-hidden="true" />
              <h2 className="m-0 font-body text-sm font-semibold uppercase text-mocha-light">
                Templates
              </h2>
              <span className="text-xs text-mocha-light">{state.templates.length}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {state.templates.map((template) => (
                <a
                  key={template.id}
                  href={`/harnesses/${encodeURIComponent(template.id)}`}
                  className="group min-w-0 rounded-md border border-frost bg-snow p-4 text-inherit shadow-baziu-sm transition hover:border-sapphire-light hover:shadow-baziu-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="m-0 truncate font-body text-base font-semibold normal-case text-chocolate">
                        {template.name}
                      </h3>
                      <p className="mt-1 text-xs font-medium text-sapphire">
                        {HARNESS_PRESET_META[template.preset].label}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 flex-none text-mocha-light transition-transform group-hover:translate-x-0.5 group-hover:text-sapphire" />
                  </div>
                  <p className="mt-3 line-clamp-2 text-xs leading-5 text-mocha-light">
                    {HARNESS_PRESET_META[template.preset].summary}
                  </p>
                  <div className="mt-4 flex items-center gap-3 border-t border-frost pt-3 text-xs text-mocha">
                    <span>{template.members.length} members</span>
                    <span>{template.policy.edges.length} edges</span>
                    {template.policy.edges.length === 0 && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[#9b6466]">
                        <ShieldAlert className="h-3.5 w-3.5" /> isolated
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </section>

          <section className="border-t border-frost py-7">
            <div className="mb-3 flex items-center gap-2">
              <Network className="h-4 w-4 text-sapphire" aria-hidden="true" />
              <h2 className="m-0 font-body text-sm font-semibold uppercase text-mocha-light">
                Live harnesses
              </h2>
              <span className="text-xs text-mocha-light">{state.liveHarnesses.length}</span>
            </div>
            {state.liveHarnesses.length === 0 ? (
              <div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-fawn bg-ivory px-5 text-center">
                <div>
                  <Bot className="mx-auto mb-2 h-5 w-5 text-mocha-light" aria-hidden="true" />
                  <p className="text-sm font-medium text-chocolate">No live groups bound yet</p>
                  <p className="mt-1 text-xs text-mocha-light">
                    Bind an existing group to use real agent ids and chat navigation.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-frost bg-snow">
                {state.liveHarnesses.map((harness) => {
                  const source = state.templates.find(
                    (template) => template.id === harness.sourceTemplateId,
                  )
                  const diff = diffLiveHarness(source, harness)
                  return (
                    <a
                      key={harness.id}
                      href={`/harnesses/${encodeURIComponent(harness.id)}`}
                      className="group flex min-h-16 items-center gap-4 border-b border-frost px-4 py-3 text-inherit last:border-0 hover:bg-sapphire-glow"
                    >
                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-sapphire-glow text-sapphire">
                        <Bot className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-sm text-chocolate">{harness.name}</strong>
                          {diff.modified && (
                            <span className="rounded-sm bg-rose-baziu/15 px-1.5 py-0.5 text-[0.68rem] font-semibold uppercase text-[#8a5558] dark:text-[#e5b0b3]">
                              Modified
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-mocha-light">
                          Based on {source?.name ?? 'missing template'} · {harness.members.length}{' '}
                          agents · local edit {formatHarnessTime(harness.updatedAt)}
                        </span>
                      </span>
                      <ArrowRight className="h-4 w-4 flex-none text-mocha-light transition-transform group-hover:translate-x-0.5 group-hover:text-sapphire" />
                    </a>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
