import type { SetTeamUserMdRequest, Team } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { UserRound } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import { Button } from '../Button'
import { UnsavedChangesGuard } from '../UnsavedChangesGuard'
import { SaveBar, saveStatus, TextAreaField } from '../ui/form'
import { CardBody, CardForm, Notice, SetupCard } from '../ui/parts'

/** The daemon's cap, in bytes: USER.md goes into every member's instructions. */
const LIMIT = 12_000
const bytes = (text: string) => new TextEncoder().encode(text).length

/**
 * USER.md: what every member of the Team is told about the operator. The operator writes it, and
 * its Agents add to it as they learn about them; a save refuses to overwrite what an Agent wrote
 * since the editor opened.
 */
export function TeamUserMd({ team }: { team: Team }) {
  const router = useRouter()
  const path = `/api/teams/${encodeURIComponent(team.id)}`
  // What USER.md read when the editor opened (or was last saved): the save checks it still does.
  const [base, setBase] = useState<string | null>(null)
  const [userMd, setUserMd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const dirty = base !== null && userMd !== base
  const size = bytes(userMd)
  const tooLong = size > LIMIT

  async function load(): Promise<string> {
    const fresh = await api<Team>(path)
    return fresh.userMd
  }

  // The page's copy may be older than an Agent's last write: read it afresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per Team.
  useEffect(() => {
    let live = true
    load()
      .then((text) => {
        if (!live) return
        setBase(text)
        setUserMd(text)
      })
      .catch((cause) => live && setError(errorMessage(cause)))
    return () => {
      live = false
    }
  }, [path])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (base === null) return
    setBusy(true)
    setError(null)
    setChanged(null)
    try {
      const body: SetTeamUserMdRequest = { userMd, expected: base }
      await api(`${path}/user-md`, { method: 'PUT', body })
      setBase(userMd)
      setSaved(true)
      await router.invalidate({ sync: true })
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'user_md_changed') {
        setChanged(await load().catch(() => null))
      } else {
        setError(errorMessage(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <SetupCard
      labelledBy="team-user-md"
      icon={<UserRound className="size-5" />}
      title="About you"
      description="Who you are, how you like to work, what this Team is for. Its Agents add to it as they learn about you."
    >
      <UnsavedChangesGuard when={dirty} subject="USER.md changes" />
      {base === null ? (
        <CardBody>
          {error ? (
            <Notice role="alert" title="USER.md could not be loaded.">
              {error}
            </Notice>
          ) : (
            <p role="status" className="m-0 text-sm text-muted-foreground">
              Loading USER.md…
            </p>
          )}
        </CardBody>
      ) : (
        <CardForm onSubmit={(event) => void save(event)}>
          {changed !== null && (
            <Notice
              role="alert"
              title="An Agent changed USER.md since you opened it."
              actions={
                <Button
                  variant="ghost"
                  onClick={() => {
                    setBase(changed)
                    setUserMd(changed)
                    setChanged(null)
                  }}
                >
                  Load their version (drops your edit)
                </Button>
              }
            >
              Nothing was saved. Copy what you wrote if you want to keep it, then load their version
              and add it back.
            </Notice>
          )}
          <TextAreaField
            label="USER.md"
            value={userMd}
            rows={16}
            mono
            disabled={busy}
            placeholder={
              '# About me\n\nI run a small note-taking app. I like short answers.\n\n# This Team\n\nWe ship version 2 on Friday.'
            }
            problem={
              tooLong
                ? `Keep it under ${LIMIT.toLocaleString()} bytes; it is ${size.toLocaleString()}.`
                : undefined
            }
            hint={`${size.toLocaleString()} of ${LIMIT.toLocaleString()} bytes. Markdown.`}
            onChange={(value) => {
              setUserMd(value)
              setSaved(false)
            }}
          />
          <SaveBar
            busy={busy}
            disabled={!dirty || tooLong}
            status={saveStatus({
              error,
              dirty,
              saved,
              savedText: 'Saved. Members read it from their next turn.',
            })}
          />
        </CardForm>
      )}
    </SetupCard>
  )
}
