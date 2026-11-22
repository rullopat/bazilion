import type { ImportSkillsResponse, ProfileSummary, SkillInfo } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ManagePage } from '../../components/ManagePage'
import { FindingsNotice, ImportSkillsDialog } from '../../components/manage/SkillsParts'
import {
  Banner,
  CardBody,
  CardEmpty,
  CardList,
  CardToolbar,
  Chip,
  ListRow,
  Notice,
  RowMenu,
  SearchField,
  SetupCard,
} from '../../components/ui/parts'
import { api } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'
import {
  allSkillsLine,
  count,
  matchesSkill,
  skillChosenBy,
  skillSourceLabel,
  skillState,
  skillsNeedingALook,
  skillUseSentence,
} from '../../lib/manage'
import { ago } from '../../lib/model-facts'

const fetchSkills = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [skills, templates] = await Promise.all([
    client.get<SkillInfo[]>('/api/skills'),
    client.get<ProfileSummary[]>('/api/profiles'),
  ])
  // "Imported 2 days ago" is counted from one clock, on the server and in the browser.
  return { skills, templates, now: Date.now() }
})

export const Route = createFileRoute('/skills/')({
  loader: () => fetchSkills(),
  component: SkillsPage,
})

function SkillsPage() {
  const { skills, templates, now } = Route.useLoaderData()
  const router = useRouter()
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<ImportSkillsResponse | null>(null)
  const [removing, setRemoving] = useState<SkillInfo | null>(null)
  const [query, setQuery] = useState('')
  const shown = skills.filter((skill) => matchesSkill(skill, query))
  const look = skillsNeedingALook(skills)
  const importedFindings = imported
    ? Object.entries(imported.findings ?? {}).flatMap(([name, items]) =>
        items.map((item) => ({ ...item, message: `${name}: ${item.message}` })),
      )
    : []

  return (
    <ManagePage
      title="Skills"
      description="Prompt-only skills: a skill's SKILL.md is added to the system prompt of every Agent it is attached to. Templates attach skills at spawn; each Agent can change its own."
      actions={
        <Button variant="primary" onClick={() => setImporting(true)}>
          Import skills
        </Button>
      }
    >
      {look.length > 0 && (
        <Banner
          tone="warning"
          lead={`${count(look.length, 'skill')} ${look.length === 1 ? 'needs' : 'need'} a look.`}
        >
          {look
            .map((skill) =>
              skill.parseError
                ? `${skill.name} cannot be read`
                : `${skill.name} has a risky finding`,
            )
            .join('; ')}
          .
        </Banner>
      )}
      <SetupCard
        labelledBy="manage-skills"
        icon={<Sparkles className="size-5" />}
        title="Installed skills"
        description={`Each was scanned when it was imported. ${allSkillsLine(templates) ?? ''}`}
        action={<Chip tone="neutral">{count(skills.length, 'skill')}</Chip>}
      >
        {imported && (
          <CardBody className="py-3">
            <Notice
              tone="success"
              title={
                imported.imported.length > 0
                  ? `Imported ${count(imported.imported.length, 'skill')}: ${imported.imported.join(', ')}.`
                  : 'Nothing new was imported.'
              }
            >
              {imported.skipped.length > 0 &&
                `Already installed, so left as they were: ${imported.skipped.join(', ')}.`}
            </Notice>
            {importedFindings.length > 0 && (
              <FindingsNotice
                findings={importedFindings}
                title="Imported despite these findings:"
              />
            )}
          </CardBody>
        )}
        {skills.length > 0 && (
          <CardToolbar>
            <SearchField
              label="Find a skill"
              placeholder="Find by name or description"
              value={query}
              onChange={setQuery}
              className="min-w-0 flex-1 basis-60"
            />
          </CardToolbar>
        )}
        {skills.length === 0 ? (
          <CardEmpty
            icon={<Sparkles className="size-5" />}
            title="No skills installed"
            action={
              <Button variant="primary" onClick={() => setImporting(true)}>
                Import skills
              </Button>
            }
          >
            Import them from OpenClaw, a folder or a ZIP file.
          </CardEmpty>
        ) : shown.length === 0 ? (
          <CardEmpty title={`No skill matches “${query.trim()}”`}>
            Try another word from its name or description.
          </CardEmpty>
        ) : (
          <CardList>
            {shown.map((skill) => {
              const state = skillState(skill)
              const findings = skill.scanFindings ?? []
              return (
                <ListRow
                  key={skill.name}
                  title={<span className="font-mono text-[0.92em]">{skill.name}</span>}
                  chip={state && <Chip tone={state.tone}>{state.label}</Chip>}
                  meta={
                    <>
                      {skill.description && (
                        <span className="basis-full text-foreground">{skill.description}</span>
                      )}
                      {skillChosenBy(skill.name, templates) && (
                        <span>{skillChosenBy(skill.name, templates)}</span>
                      )}
                      <span>
                        {skillSourceLabel(skill.source)}
                        {skill.importedAt !== null && `, ${ago(skill.importedAt, now)}`}
                      </span>
                    </>
                  }
                  actions={
                    <RowMenu
                      label={`More for ${skill.name}`}
                      items={[
                        { label: 'Remove…', danger: true, onSelect: () => setRemoving(skill) },
                      ]}
                    />
                  }
                >
                  {skill.parseError ? (
                    <Notice
                      tone="warning"
                      title="Its SKILL.md cannot be read, so no Agent gets it."
                    >
                      <span className="break-words font-mono text-xs">{skill.parseError}</span>
                    </Notice>
                  ) : (
                    findings.length > 0 && <FindingsNotice findings={findings} />
                  )}
                </ListRow>
              )
            })}
          </CardList>
        )}
      </SetupCard>

      {importing && (
        <ImportSkillsDialog
          onClose={() => setImporting(false)}
          onImported={async (result) => {
            setImporting(false)
            setImported(result)
            await router.invalidate({ sync: true })
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={`Remove the ${removing?.name ?? ''} skill?`}
        description={
          <p className="m-0">
            This deletes its SKILL.md and every script and file in its folder. No Agent or template
            can use it until it is imported again.{' '}
            {removing && skillUseSentence(removing.name, templates)}
          </p>
        }
        confirmLabel="Remove skill"
        onConfirm={async () => {
          if (!removing) return
          await api(`/api/skills/${encodeURIComponent(removing.name)}`, { method: 'DELETE' })
          await router.invalidate({ sync: true })
        }}
      />
    </ManagePage>
  )
}
