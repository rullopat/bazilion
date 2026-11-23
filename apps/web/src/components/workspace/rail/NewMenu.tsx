// The rail's New menu: an Agent from an Agent template, a Team from a Team template, or a new
// empty Team.

import { DEFAULT_PROFILE_ID, type Profile, type TeamTemplate } from '@bazilion/api-types'
import { Bot, ChevronDown, Plus, UsersRound } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { Ref } from 'react'
import { MENU_ITEM, MENU_LABEL } from './menu'

export function NewMenu({
  buttonRef,
  profiles,
  teamTemplates,
  onSpawnAgent,
  onSpawnTeam,
  onCreateTeam,
}: {
  /** The menu's button, focused again when a dialog it opened closes. */
  buttonRef: Ref<HTMLButtonElement>
  /** The Agent templates, the default one first. */
  profiles: Profile[]
  teamTemplates: TeamTemplate[]
  onSpawnAgent: (profileId: string) => void
  onSpawnTeam: (templateId: string) => void
  onCreateTeam: () => void
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          ref={buttonRef}
          type="button"
          aria-label="Create a new Agent or Team"
          className="unstyled group inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground shadow-baziu-sm transition-colors hover:border-primary/30 hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New
          <ChevronDown
            className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-60 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg outline-none"
        >
          <DropdownMenu.Label className={MENU_LABEL}>
            <Bot className="size-3" aria-hidden="true" />
            Agent templates
          </DropdownMenu.Label>
          {profiles.length === 0 ? (
            <DropdownMenu.Item asChild className={MENU_ITEM}>
              <a href="/templates/agents?new=1">Create an Agent template</a>
            </DropdownMenu.Item>
          ) : (
            profiles.map((profile) => (
              <DropdownMenu.Item
                key={profile.id}
                className={MENU_ITEM}
                onSelect={() => onSpawnAgent(profile.id)}
              >
                <span className="min-w-0 flex-1 truncate">{profile.name || profile.id}</span>
                {profile.id === DEFAULT_PROFILE_ID && (
                  <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                    Default
                  </span>
                )}
              </DropdownMenu.Item>
            ))
          )}
          <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
          <DropdownMenu.Label className={MENU_LABEL}>
            <UsersRound className="size-3" aria-hidden="true" />
            Team templates
          </DropdownMenu.Label>
          {teamTemplates.length === 0 ? (
            <DropdownMenu.Item asChild className={MENU_ITEM}>
              <a href="/templates/teams?new=1">Create a Team template</a>
            </DropdownMenu.Item>
          ) : (
            teamTemplates.map((entry) => (
              <DropdownMenu.Item
                key={entry.id}
                className={MENU_ITEM}
                disabled={entry.slots.length === 0}
                title={
                  entry.slots.length === 0 ? 'Add at least one member before spawning' : undefined
                }
                onSelect={() => onSpawnTeam(entry.id)}
              >
                <span className="min-w-0 flex-1 truncate">{entry.name || entry.id}</span>
                <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-muted px-1.5 font-mono text-xs text-muted-foreground">
                  {entry.slots.length}
                </span>
              </DropdownMenu.Item>
            ))
          )}
          <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
          <DropdownMenu.Item className={MENU_ITEM} onSelect={onCreateTeam}>
            <Plus className="size-3.5" aria-hidden="true" />
            Create a Team
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
