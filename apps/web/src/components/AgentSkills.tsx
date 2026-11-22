// One Agent's skills: which installed skills it follows. A skill the scan found something in is
// switched on only after its findings were read.

import type { SkillInfo } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { skillState } from '../lib/manage'
import { useResource } from '../lib/use-resource'
import { ConfirmDialog } from './ConfirmDialog'
import { FindingLines, FindingsNotice } from './manage/SkillsParts'
import { CardEmpty, CardList, Chip, ListRow, Notice, SetupCard, Switch } from './ui/parts'

/** The sheet: the installed skills, loaded here, with this Agent's on or off. */
export function AgentSkillsSheet({
  agentId,
  agentName,
  attached,
}: {
  agentId: string
  agentName: string
  attached: string[]
}) {
  const skills = useResource((signal) => api<SkillInfo[]>('/api/skills', { signal }), [])
  if (!skills.data) {
    return skills.error ? (
      <Notice role="alert" title="The skills could not be loaded.">
        {skills.error}
      </Notice>
    ) : (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Loading the skills…
      </p>
    )
  }
  return (
    <AgentSkills
      agentId={agentId}
      agentName={agentName}
      attached={new Set(attached)}
      all={skills.data}
    />
  )
}

/** Attach and detach installed skills for one Agent; scan findings need confirmation. */
export function AgentSkills({
  agentId,
  agentName = 'this Agent',
  attached,
  all,
}: {
  agentId: string
  agentName?: string
  attached: Set<string>
  all: SkillInfo[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [risky, setRisky] = useState<SkillInfo | null>(null)
  const [detaching, setDetaching] = useState<string | null>(null)
  const base = `/api/agents/${encodeURIComponent(agentId)}/skills`
  const on = all.filter((skill) => attached.has(skill.name)).length

  async function change(name: string, request: () => Promise<unknown>) {
    setPending(name)
    setError(null)
    try {
      await request()
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    } finally {
      setPending(null)
    }
  }

  const attach = (skill: SkillInfo) =>
    change(skill.name, () =>
      api(base, {
        body: { skill: skill.name, allowFindings: (skill.scanFindings ?? []).length > 0 },
      }),
    )
  const detach = (name: string) =>
    change(name, () => api(`${base}/${encodeURIComponent(name)}`, { method: 'DELETE' }))

  return (
    <SetupCard
      labelledBy="agent-skills"
      icon={<Sparkles className="size-5" />}
      title="Skills"
      description={
        <>
          Instructions {agentName} follows on every turn. Install and remove skills under{' '}
          <a href="/skills">Manage → Skills</a>.
        </>
      }
      action={<Chip tone={on > 0 ? 'success' : 'neutral'}>{on} on</Chip>}
    >
      {error && (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <Notice role="alert" title="That did not work.">
            {error}
          </Notice>
        </div>
      )}
      {all.length === 0 ? (
        <CardEmpty icon={<Sparkles className="size-5" />} title="No skills are installed">
          Import some under Manage → Skills, then switch them on here.
        </CardEmpty>
      ) : (
        <CardList>
          {all.map((skill) => {
            const isAttached = attached.has(skill.name)
            const findings = skill.scanFindings ?? []
            const state = skillState(skill)
            return (
              <ListRow
                key={skill.name}
                inline
                title={<span className="font-mono text-[0.92em]">{skill.name}</span>}
                chip={state && <Chip tone={state.tone}>{state.label}</Chip>}
                meta={<span>{skill.description || 'No description.'}</span>}
                actions={
                  <Switch
                    label={`${skill.name}: ${isAttached ? 'on' : 'off'}`}
                    checked={isAttached}
                    // An unreadable skill cannot be switched on, but one that broke after it
                    // was attached can still be switched off.
                    disabled={pending === skill.name || (Boolean(skill.parseError) && !isAttached)}
                    onChange={() => {
                      if (isAttached) setDetaching(skill.name)
                      else if (findings.length > 0) setRisky(skill)
                      else void attach(skill).catch(() => {})
                    }}
                  />
                }
              >
                {findings.length > 0 && <FindingsNotice findings={findings} />}
              </ListRow>
            )
          })}
        </CardList>
      )}
      <ConfirmDialog
        open={risky !== null}
        onOpenChange={(open) => {
          if (!open) setRisky(null)
        }}
        title={`Switch on ${risky?.name ?? 'the skill'}?`}
        description={
          <div className="grid gap-2">
            <p className="m-0">
              The scan found something in it. Its text goes into {agentName}’s instructions, so read
              what was found first.
            </p>
            <div className="text-sm">
              <FindingLines findings={risky?.scanFindings ?? []} />
            </div>
          </div>
        }
        confirmLabel="Switch it on anyway"
        onConfirm={async () => {
          if (risky) await attach(risky)
        }}
      />
      <ConfirmDialog
        open={detaching !== null}
        onOpenChange={(open) => {
          if (!open) setDetaching(null)
        }}
        title={`Switch off ${detaching ?? 'the skill'}?`}
        description={
          <p className="m-0">
            {agentName} stops following it from the next turn. The skill stays installed, and you
            can switch it on again.
          </p>
        }
        confirmVariant="primary"
        confirmLabel="Switch it off"
        onConfirm={async () => {
          if (detaching) await detach(detaching)
        }}
      />
    </SetupCard>
  )
}
