import type { TeamTemplate } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { ItemList, ItemRow, PageHeader, PageShell, SectionCard } from '../../../components/Page'
import { SectionTabs, TEMPLATE_TABS } from '../../../components/SectionTabs'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const fetchTemplates = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<TeamTemplate[]>('/api/team-templates'),
)

export const Route = createFileRoute('/templates/teams/')({
  loader: () => fetchTemplates(),
  component: TeamTemplatesPage,
})

function TeamTemplatesPage() {
  const templates = Route.useLoaderData()
  const router = useRouter()
  return (
    <PageShell size="wide">
      <PageHeader
        eyebrow="Templates"
        title="Team templates"
        description="Reusable rosters: one Agent per slot, plus who may message whom."
      />
      <SectionTabs label="Template kinds" base="/templates" tabs={TEMPLATE_TABS} />
      <CreateTemplateForm onCreated={() => router.invalidate()} />
      <SectionCard title="Templates">
        {templates.length === 0 ? (
          <p className="muted">No Team templates yet.</p>
        ) : (
          <ItemList>
            {templates.map((template) => (
              <ItemRow
                key={template.id}
                title={
                  <a href={`/templates/teams/${encodeURIComponent(template.id)}`}>
                    {template.name}
                  </a>
                }
                meta={
                  <>
                    <code>{template.id}</code>
                    <span>
                      {template.slots.length} slot{template.slots.length === 1 ? '' : 's'}
                    </span>
                    <span>{template.policyMode}</span>
                  </>
                }
              />
            ))}
          </ItemList>
        )}
      </SectionCard>
    </PageShell>
  )
}

function CreateTemplateForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/api/team-templates', { body: { id: id.trim(), name: name.trim() } })
      setId('')
      setName('')
      await onCreated()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title="New Team template">
      <form onSubmit={(event) => void submit(event)}>
        {error && (
          <p role="alert" className="err">
            {error}
          </p>
        )}
        <div className="grid gap-x-3 sm:grid-cols-2">
          <label>
            ID
            <input
              required
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="review-team"
            />
          </label>
          <label>
            Name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Review team"
            />
          </label>
        </div>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create Team template'}
        </Button>
      </form>
    </SectionCard>
  )
}
