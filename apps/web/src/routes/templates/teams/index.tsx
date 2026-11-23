import type { Team, TeamTemplate } from '@bazilion/api-types'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Network } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { Dialog, DialogActions } from '../../../components/Dialog'
import { ManagePage } from '../../../components/ManagePage'
import { SpawnTeamModal } from '../../../components/SpawnTeamModal'
import { TextField } from '../../../components/ui/form'
import {
  CardEmpty,
  CardList,
  Chip,
  ListRow,
  Notice,
  RowMenu,
  SetupCard,
} from '../../../components/ui/parts'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'
import { count, rosterCounts, rosterLine, slugify, slugProblem } from '../../../lib/manage'
import { MODE_NAME } from '../../../lib/team-policy'

const fetchTemplates = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [templates, teams] = await Promise.all([
    client.get<TeamTemplate[]>('/api/team-templates'),
    client.get<Team[]>('/api/teams'),
  ])
  return { templates, teams }
})

export const Route = createFileRoute('/templates/teams/')({
  // `?new=1` opens the create dialog, as the workspace's New menu does.
  validateSearch: (search: Record<string, unknown>): { new?: 1 } => ({
    new: search.new === 1 || search.new === '1' ? 1 : undefined,
  }),
  loader: () => fetchTemplates(),
  component: TeamTemplatesPage,
})

function TeamTemplatesPage() {
  const { templates, teams } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const [creating, setCreating] = useState(search.new === 1)
  const [spawning, setSpawning] = useState<TeamTemplate | null>(null)
  const [deleting, setDeleting] = useState<TeamTemplate | null>(null)
  const closeCreate = () => {
    setCreating(false)
    if (search.new) void navigate({ to: '/templates/teams', search: {}, replace: true })
  }

  return (
    <ManagePage
      title="Team templates"
      description="Reusable rosters: one Agent per slot, from an Agent template, and who may message whom. Using one adds its Agents and their connections to a new Team or one that exists."
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          New Team template
        </Button>
      }
    >
      <SetupCard
        labelledBy="manage-team-templates"
        icon={<Network className="size-5" />}
        title="Team templates"
        description="Open one to arrange its Agents and their connections."
        action={<Chip tone="neutral">{count(templates.length, 'template')}</Chip>}
      >
        {templates.length === 0 ? (
          <CardEmpty
            icon={<Network className="size-5" />}
            title="No Team templates yet"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                New Team template
              </Button>
            }
          >
            A Team template spawns a whole Team in one go: a lead and its helpers, a writer and a
            reviewer.
          </CardEmpty>
        ) : (
          <CardList>
            {templates.map((template) => {
              const href = `/templates/teams/${encodeURIComponent(template.id)}`
              return (
                <ListRow
                  inline
                  key={template.id}
                  title={
                    <a href={href} className="text-foreground hover:text-primary">
                      {template.name}
                    </a>
                  }
                  chip={
                    template.policyMode === 'restricted' && (
                      <Chip tone="neutral">{MODE_NAME.restricted}</Chip>
                    )
                  }
                  meta={
                    <>
                      <span className="text-foreground">{rosterLine(template)}</span>
                      <span>{rosterCounts(template)}</span>
                      <code>{template.id}</code>
                    </>
                  }
                  actions={
                    <>
                      <Button
                        variant="ghost"
                        disabled={template.slots.length === 0}
                        aria-label={`Use ${template.name}`}
                        onClick={() => setSpawning(template)}
                      >
                        Use
                      </Button>
                      <RowMenu
                        label={`More for ${template.name}`}
                        items={[
                          {
                            label: 'Edit roster and connections',
                            onSelect: () => {
                              window.location.assign(href)
                            },
                          },
                          {
                            label: 'Delete…',
                            danger: true,
                            onSelect: () => setDeleting(template),
                          },
                        ]}
                      />
                    </>
                  }
                />
              )
            })}
          </CardList>
        )}
      </SetupCard>

      {creating && <CreateTeamTemplateDialog onClose={closeCreate} />}
      {spawning && (
        <SpawnTeamModal
          template={spawning}
          teams={teams}
          onClose={() => setSpawning(null)}
          onSpawned={(slug) => {
            setSpawning(null)
            void navigate({ to: '/', search: { team: slug, panel: 'team' } })
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete the ${deleting?.name ?? ''} Team template?`}
        description={
          <p className="m-0">Teams already spawned from it keep their Agents and connections.</p>
        }
        confirmLabel="Delete template"
        onConfirm={async () => {
          if (!deleting) return
          await api(`/api/team-templates/${encodeURIComponent(deleting.id)}`, {
            method: 'DELETE',
          })
          await router.invalidate({ sync: true })
        }}
      />
    </ManagePage>
  )
}

/** Create an empty roster, then open it to add Agents. */
function CreateTeamTemplateDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownId = idTouched ? id : slugify(name)
  const idProblem = slugProblem(shownId)
  const ready = name.trim() !== '' && shownId !== '' && !idProblem

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/team-templates', { body: { id: shownId, name: name.trim() } })
      await navigate({ to: '/templates/teams/$id', params: { id: shownId } })
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="New Team template"
      description="It starts empty; you add its Agents and connections next."
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={(event) => void create(event)} className="grid gap-4">
        <TextField
          label="Name"
          value={name}
          disabled={busy}
          placeholder="Review team"
          className="max-w-none"
          onChange={setName}
        />
        <TextField
          label="ID"
          value={shownId}
          disabled={busy}
          placeholder="review-team"
          mono
          className="max-w-none"
          problem={idProblem}
          onChange={(value) => {
            setIdTouched(true)
            setId(value)
          }}
        />
        {error && (
          <Notice tone="warning" role="alert" title="The template was not created.">
            {error}
          </Notice>
        )}
        <DialogActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !ready}>
            {busy ? 'Creating…' : 'Create and add Agents'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
