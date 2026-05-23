// Daemon-side `UserMdHost` implementation backed by the local SQLite handle
// + `groupRepo`. Same shape as `messaging-host.ts`: the worker subprocess
// calls IPC, the daemon dispatches through this host.
//
// Optimistic concurrency: `get` returns the current content plus a short
// content-derived etag. `write` requires the caller to echo that etag back
// in `ifMatch`; if the stored content moved on in the meantime (another
// agent in the same group wrote concurrently) the write fails with a
// conflict error containing the new etag, and the caller is expected to
// re-read, re-merge, and retry. No locks, no leases — pessimistic locking
// would block agents for whole LLM turns (seconds-to-minutes), which is far
// worse than the vanishingly-rare retry path.
//
// USER.md is capped at USER_MD_MAX_BYTES (kept in sync with the cap in
// routes/groups.ts) because it's inlined into every agent's system prompt
// on every turn — uncapped growth would silently blow out the context.

import { createHash } from 'node:crypto'
import { type BazilionDb, groupRepo } from '../core/index.ts'
import type { Paths } from '../core/paths.ts'
import type {
  UserMdGetResult,
  UserMdHost,
  UserMdWriteResult,
} from '../runtime/index.ts'

export const USER_MD_MAX_BYTES = 12_000

/** Short content hash. 16 hex chars is comfortable headroom against accidental collision. */
function computeEtag(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)
}

export function createDbUserMdHost(db: BazilionDb, paths: Paths): UserMdHost {
  return {
    get(groupId): UserMdGetResult {
      const group = groupRepo.get(db, groupId, paths)
      if (!group) throw new Error(`group not found: ${groupId}`)
      return { content: group.userMd, etag: computeEtag(group.userMd) }
    },
    write(groupId, content, ifMatch): UserMdWriteResult {
      const group = groupRepo.get(db, groupId, paths)
      if (!group) throw new Error(`group not found: ${groupId}`)
      const currentEtag = computeEtag(group.userMd)
      if (currentEtag !== ifMatch) {
        throw new Error(
          `etag mismatch — USER.md was updated by another agent. Current etag is ${currentEtag} (you passed ${ifMatch}). Call user_md_get again to re-read, merge your change, and retry.`,
        )
      }
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > USER_MD_MAX_BYTES) {
        throw new Error(
          `USER.md would exceed the ${USER_MD_MAX_BYTES}-byte cap (you tried to write ${bytes}). Trim your content or ask the human to compact via the web UI.`,
        )
      }
      groupRepo.setUserMd(db, groupId, content)
      return { etag: computeEtag(content), totalBytes: bytes }
    },
  }
}
