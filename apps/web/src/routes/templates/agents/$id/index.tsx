import type {
  LoadedProfile,
  ModelsResponse,
  ProfileSummary,
  ProfileTemplates,
  SkillInfo,
  Team,
  TeamTemplate,
} from '@bazilion/api-types'
import { ApiClientError } from '@bazilion/client'
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useCallback, useState } from 'react'
import { Button } from '../../../../components/Button'
import { ConfirmDialog } from '../../../../components/ConfirmDialog'
import { ManagePage } from '../../../../components/ManagePage'
import { MODELS_PATH } from '../../../../components/ModelMenu'
import {
  TemplateFilesCard,
  TemplateSettingsCard,
} from '../../../../components/manage/AgentTemplateCards'
import { SpawnDialog } from '../../../../components/SpawnDialog'
import { UnsavedChangesGuard } from '../../../../components/UnsavedChangesGuard'
import { Banner, RowMenu } from '../../../../components/ui/parts'
import { api } from '../../../../lib/api'
import { daemonClient } from '../../../../lib/daemon-client'
import {
  modelLine,
  templateDeleteBlocker,
  templateName,
  templateUseLine,
} from '../../../../lib/manage'

const fetchTemplate = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    let loaded: LoadedProfile
    try {
      loaded = await client.get<LoadedProfile>(`/api/profiles/${encodeURIComponent(data.id)}`)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) return null
      throw error
    }
    const [models, skills, starter, templates, teamTemplates, teams] = await Promise.all([
      client.get<ModelsResponse>(MODELS_PATH),
      client.get<SkillInfo[]>('/api/skills'),
      client.get<ProfileTemplates>('/api/profiles/_/templates'),
      client.get<ProfileSummary[]>('/api/profiles'),
      client.get<TeamTemplate[]>('/api/team-templates'),
      client.get<Team[]>('/api/teams'),
    ])
    return { loaded, chat: models.chat, skills, starter, templates, teamTemplates, teams }
  })

export const Route = createFileRoute('/templates/agents/$id/')({
  loader: async ({ params }) => {
    const data = await fetchTemplate({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/templates/agents' })
    return data
  },
  component: AgentTemplatePage,
})

function AgentTemplatePage() {
  const { loaded, chat, skills, starter, templates, teamTemplates, teams } = Route.useLoaderData()
  const { profile } = loaded
  const router = useRouter()
  const navigate = useNavigate()
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [filesDirty, setFilesDirty] = useState(false)
  const [spawning, setSpawning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const onSettingsDirty = useCallback((dirty: boolean) => setSettingsDirty(dirty), [])
  const onFilesDirty = useCallback((dirty: boolean) => setFilesDirty(dirty), [])
  const summary = templates.find((entry) => entry.id === profile.id)
  const blocker = summary ? templateDeleteBlocker(summary, teamTemplates) : null
  const model = modelLine(profile.defaultModel, chat)
  const name = templateName(profile)

  return (
    <ManagePage
      title={name}
      description={
        <>
          What every Agent spawned from this template starts with.{' '}
          {summary ? `${templateUseLine(summary, teamTemplates)}.` : ''} Agents already spawned keep
          their own copies.
        </>
      }
      actions={
        <>
          <Button variant="primary" onClick={() => setSpawning(true)}>
            Add an Agent
          </Button>
          <RowMenu
            label={`More for ${name}`}
            items={[
              {
                label: 'Delete template…',
                danger: true,
                disabledReason: blocker,
                onSelect: () => setDeleting(true),
              },
            ]}
          />
        </>
      }
    >
      <UnsavedChangesGuard when={settingsDirty || filesDirty} subject="template changes" />
      {model.missing && (
        <Banner
          tone="warning"
          lead={`Its default model, ${model.name}, is not in Chat.`}
          action={
            <a href="/config" className="ghost-btn no-underline">
              Open Setup → Models
            </a>
          }
        >
          Agents spawned from it are refused until it is. Choose another model below, or add it in
          Setup.
        </Banner>
      )}
      <TemplateSettingsCard
        loaded={loaded}
        chat={chat}
        skills={skills}
        onDirtyChange={onSettingsDirty}
        onSaved={() => router.invalidate({ sync: true })}
      />
      <TemplateFilesCard loaded={loaded} starter={starter} onDirtyChange={onFilesDirty} />

      {spawning && (
        <SpawnDialog
          profiles={templates}
          teams={teams}
          profileId={profile.id}
          onClose={() => setSpawning(false)}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the ${name} template?`}
        description={
          <p className="m-0">
            This deletes the template and its files. No Agent and no Team template uses it.
          </p>
        }
        confirmLabel="Delete template"
        onConfirm={async () => {
          await api(`/api/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' })
          await navigate({ to: '/templates/agents' })
        }}
      />
    </ManagePage>
  )
}
