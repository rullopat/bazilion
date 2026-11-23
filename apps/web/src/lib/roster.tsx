// Teams, Agents and templates changed somewhere else (the CLI, an Agent running `bazilion`, another
// tab): the live feed's roster digest moves, and the page loads its data again, so a new Team or
// Agent shows without a reload. What this tab changed itself it already reloads on its own.

import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useLive } from './live'

export function RosterWatcher() {
  const { subscribe } = useLive()
  const router = useRouter()
  useEffect(() => {
    let known: string | undefined
    return subscribe('activity', (event) => {
      if (known !== undefined && event.roster !== known) void router.invalidate()
      known = event.roster
    })
  }, [subscribe, router])
  return null
}
