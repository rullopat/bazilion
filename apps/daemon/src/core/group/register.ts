// Register a group: pick a slug, materialize `~/.bazilion/groups/<slug>/`
// (real dir or symlink), insert the row.
//
// Two modes:
//   - default: creates a real directory at `paths.groupDir(slug)`.
//   - `--link <target>`: creates a symlink at `paths.groupDir(slug)` →
//     `<target>`. The link target must exist and be a directory — that's
//     the "I want my agents working on my existing project tree" path.
//
// Slug = the row's id. Names are humanized labels separate from the slug;
// callers may pass `name` explicitly or let it default to the slug.

import { existsSync, mkdirSync, statSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Group } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import { validateSlug } from '../profile/validate.ts'
import * as groupRepo from '../repos/groups.ts'

export interface RegisterGroupInput {
  /** Slug. Becomes the row id AND the directory name under `groups/`. */
  id: string
  /** Human-readable label. Defaults to `id`. */
  name?: string
  /**
   * If set, materialize `paths.groupDir(id)` as a symlink to this absolute
   * path instead of as a real directory. Target must exist and be a dir.
   */
  link?: string
}

export function registerGroup(db: BazilionDb, input: RegisterGroupInput, paths: Paths): Group {
  validateSlug(input.id)

  if (groupRepo.get(db, input.id, paths)) {
    throw new Error(`group already registered: ${input.id}`)
  }

  const slot = paths.groupDir(input.id)
  if (existsSync(slot)) {
    throw new Error(`group slot already on disk at ${slot} (move or remove it first)`)
  }

  // Make sure the parent `groups/` dir exists — the daemon's bootstrap creates
  // it but tests sometimes resolve a custom $BAZILION_HOME without going
  // through bootstrap.
  mkdirSync(paths.groupsDir, { recursive: true })

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

  // Memory subdir is the qmd index root for this group — created here so
  // the first tool call doesn't have to ensure it.
  mkdirSync(resolve(slot, 'memory'), { recursive: true })

  return groupRepo.insert(db, { id: input.id, name: input.name ?? input.id }, paths)
}
