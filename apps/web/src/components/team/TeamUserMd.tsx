import type { Team } from '@bazilion/api-types'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { Button } from '../Button'
import { UnsavedChangesGuard } from '../UnsavedChangesGuard'

const LIMIT = 12_000

/** USER.md: what every member of the Team is told about the operator. Only the operator edits it. */
export function TeamUserMd({ team }: { team: Team }) {
  const router = useRouter()
  const [userMd, setUserMd] = useState(team.userMd)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const dirty = userMd !== team.userMd

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/teams/${encodeURIComponent(team.id)}/user-md`, {
        method: 'PUT',
        body: { userMd },
      })
      // Wait for the page's data: the text is unchanged once the Team holds what was saved.
      await router.invalidate({ sync: true })
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <UnsavedChangesGuard when={dirty} subject="USER.md changes" />
      <textarea
        aria-label="USER.md"
        value={userMd}
        onChange={(event) => {
          setUserMd(event.target.value)
          setSaved(false)
        }}
        className="min-h-[52dvh] font-mono text-sm leading-[1.55]"
        placeholder="What the Agents should know about you in this Team…"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={busy || !dirty || userMd.length > LIMIT}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <span
          className={`text-xs ${userMd.length > LIMIT ? 'font-semibold text-danger' : 'text-muted-foreground'}`}
        >
          {userMd.length.toLocaleString()} of {LIMIT.toLocaleString()} characters
        </span>
        {saved && !dirty && (
          <span role="status" className="text-xs text-success">
            Saved. Members read it from their next turn.
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  )
}
