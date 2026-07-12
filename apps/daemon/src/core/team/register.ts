// Register a team: pick a slug, materialize `~/.bazilion/teams/<slug>/`
// (real dir or symlink), insert the row.
//
// Two modes:
//   - default: creates a real directory at `paths.teamDir(slug)`.
//   - `--link <target>`: creates a symlink at `paths.teamDir(slug)` →
//     `<target>`. The link target must exist and be a directory — that's
//     the "I want my agents working on my existing project tree" path.
//
// Slug = the row's id. Names are humanized labels separate from the slug;
// callers may pass `name` explicitly or let it default to the slug.

import { existsSync, mkdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Team } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import { validateSlug } from '../profile/validate.ts'
import * as teamRepo from '../repos/teams.ts'

export interface RegisterTeamInput {
  /** Slug. Becomes the row id AND the directory name under `teams/`. */
  id: string
  /** Human-readable label. Defaults to `id`. */
  name?: string
  /**
   * If set, materialize `paths.teamDir(id)` as a symlink to this absolute
   * path instead of as a real directory. Target must exist and be a dir.
   */
  link?: string
}

export function registerTeam(db: BazilionDb, input: RegisterTeamInput, paths: Paths): Team {
  validateSlug(input.id)

  if (teamRepo.get(db, input.id, paths)) {
    throw new Error(`team already registered: ${input.id}`)
  }

  const slot = paths.teamDir(input.id)
  if (existsSync(slot)) {
    throw new Error(`team slot already on disk at ${slot} (move or remove it first)`)
  }

  // Make sure the parent `teams/` dir exists — the daemon's bootstrap creates
  // it but tests sometimes resolve a custom $BAZILION_HOME without going
  // through bootstrap.
  mkdirSync(paths.teamsDir, { recursive: true })

  if (input.link) {
    const target = resolve(input.link)
    if (!existsSync(target)) {
      throw new Error(`--link target does not exist: ${target}`)
    }
    if (!statSync(target).isDirectory()) {
      throw new Error(`--link target is not a directory: ${target}`)
    }
    symlinkSync(target, slot, 'dir')
  } else {
    mkdirSync(slot, { recursive: true })
  }

  // Memory subdir is the qmd index root for this team — created here so
  // the first tool call doesn't have to ensure it.
  mkdirSync(resolve(slot, 'memory'), { recursive: true })

  try {
    return db.raw.transaction(() => {
      return teamRepo.insert(db, { id: input.id, name: input.name ?? input.id }, paths)
    })()
  } catch (error) {
    // Remove only the canonical slot. For linked Teams rmSync removes the
    // symlink itself and never touches its target.
    rmSync(slot, { recursive: true, force: true })
    throw error
  }
}
