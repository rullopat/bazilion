// The browser tab's title: what the page shows ("Mira · Launch", "Models · Setup"), and in front
// of it how many things wait on the operator, so another tab tells them an Agent needs them.

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { useAttentionCount } from './attention-count'

const APP = 'bazilion'

const SetTitle = createContext<(title: string | null) => void>(() => {})

/** "(2) Mira · Launch — bazilion": the count only while something waits. */
export function documentTitle(title: string | null, waiting: number): string {
  const page = title ? `${title} — ${APP}` : APP
  return waiting > 0 ? `(${waiting > 99 ? '99+' : waiting}) ${page}` : page
}

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  const { waiting } = useAttentionCount()
  useEffect(() => {
    document.title = documentTitle(title, waiting)
  }, [title, waiting])
  return <SetTitle.Provider value={setTitle}>{children}</SetTitle.Provider>
}

/** Name the page in the tab; null leaves the app's name alone. */
export function usePageTitle(title: string | null): void {
  const set = useContext(SetTitle)
  useEffect(() => {
    set(title)
    return () => set(null)
  }, [set, title])
}
