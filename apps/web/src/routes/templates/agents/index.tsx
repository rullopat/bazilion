import type {
  ModelsResponse,
  ProfileSummary,
  ProfileTemplates,
  SkillInfo,
  Team,
  TeamTemplate,
} from '@bazilion/api-types'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ManagePage } from '../../../components/ManagePage'
import { MODELS_PATH } from '../../../components/ModelMenu'
import { CreateAgentTemplateDialog } from '../../../components/manage/AgentTemplateParts'
import { SpawnDialog } from '../../../components/SpawnDialog'
import {
  CardEmpty,
  CardList,
  Chip,
  ListRow,
  RowMenu,
  SetupCard,
} from '../../../components/ui/parts'
import { api } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'
import {
  count,
  modelLine,
  skillsLine,
  templateDeleteBlocker,
  templateName,
  templateUseLine,
} from '../../../lib/manage'

const fetchTemplates = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [templates, teamTemplates, models, skills, starter, teams] = await Promise.all([
    client.get<ProfileSummary[]>('/api/profiles'),
    client.get<TeamTemplate[]>('/api/team-templates'),
    client.get<ModelsResponse>(MODELS_PATH),
    client.get<SkillInfo[]>('/api/skills'),
    client.get<ProfileTemplates>('/api/profiles/_/templates'),
    client.get<Team[]>('/api/teams'),
  ])
  return { templates, teamTemplates, chat: models.chat, skills, starter, teams }
})

export const Route = createFileRoute('/templates/agents/')({
  // `?new=1` opens the create dialog, as the workspace's New menu does.
  validateSearch: (search: Record<string, unknown>): { new?: 1 } => ({
    new: search.new === 1 || search.new === '1' ? 1 : undefined,
  }),
  loader: () => fetchTemplates(),
  component: AgentTemplatesPage,
})

function AgentTemplatesPage() {
  const { templates, teamTemplates, chat, skills, starter, teams } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const [creating, setCreating] = useState(search.new === 1)
  const [spawnFrom, setSpawnFrom] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ProfileSummary | null>(null)
  const closeCreate = () => {
    setCreating(false)
    if (search.new) void navigate({ to: '/templates/agents', search: {}, replace: true })
  }

  return (
    <ManagePage
      title="Agent templates"
      description="What a new Agent starts with: its files, its model and its skills. Agents already spawned keep their own copies."
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          New Agent template
        </Button>
      }
    >
      <SetupCard
        labelledBy="manage-agent-templates"
        icon={<FileText className="size-5" />}
        title="Agent templates"
        description="Open one to edit its files, model and skills."
        action={<Chip tone="neutral">{count(templates.length, 'template')}</Chip>}
      >
        {templates.length === 0 ? (
          <CardEmpty
            icon={<FileText className="size-5" />}
            title="No Agent templates yet"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                New Agent template
              </Button>
            }
          >
            Every Agent is spawned from a template.
          </CardEmpty>
        ) : (
          <CardList>
            {templates.map((template) => {
              const model = modelLine(template.defaultModel, chat)
              const blocker = templateDeleteBlocker(template, teamTemplates)
              const href = `/templates/agents/${encodeURIComponent(template.id)}`
              return (
                <ListRow
                  inline
                  key={template.id}
                  title={
                    <a href={href} className="text-foreground hover:text-primary">
                      {templateName(template)}
                    </a>
                  }
                  chip={model.missing && <Chip tone="warning">Model not in Chat</Chip>}
                  meta={
                    <>
                      <span className={model.missing ? 'font-semibold text-warning' : ''}>
                        {model.name}
                      </span>
                      <span>{skillsLine(template)}</span>
                      <span>{templateUseLine(template, teamTemplates)}</span>
                      <code>{template.id}</code>
                    </>
                  }
                  actions={
                    <>
                      <Button
                        variant="ghost"
                        aria-label={`Add an Agent from ${templateName(template)}`}
                        onClick={() => setSpawnFrom(template.id)}
                      >
                        Add an Agent
                      </Button>
                      <RowMenu
                        label={`More for ${templateName(template)}`}
                        items={[
                          {
                            label: 'Edit files and settings',
                            onSelect: () => {
                              window.location.assign(href)
                            },
                          },
                          {
                            label: 'Delete…',
                            danger: true,
                            disabledReason: blocker,
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

      {creating && (
        <CreateAgentTemplateDialog
          chat={chat}
          skills={skills}
          starter={starter}
          onClose={closeCreate}
        />
      )}
      {spawnFrom && (
        <SpawnDialog
          profiles={templates}
          teams={teams}
          profileId={spawnFrom}
          onClose={() => setSpawnFrom(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete the ${deleting ? templateName(deleting) : ''} template?`}
        description={
          <p className="m-0">
            This deletes the template and its files. No Agent and no Team template uses it.
          </p>
        }
        confirmLabel="Delete template"
        onConfirm={async () => {
          if (!deleting) return
          await api(`/api/profiles/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
          await router.invalidate({ sync: true })
        }}
      />
    </ManagePage>
  )
}
