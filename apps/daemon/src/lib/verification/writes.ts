import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { VerificationObservedWrites } from '@bazilion/api-types'
import type { VerificationRequestRecord } from '../../core/repos/verification-requests.ts'

// BAZ-044 gap: declared output paths are advisory, and this is what keeps that statement checkable.
//
// A check runs against a real workspace with the same shell a coding turn has, so nothing *prevents* it
// from writing outside the paths it declared — confining that would mean a read-only workspace with
// bind-mounted outputs, which is a posture change the story deliberately did not take. What can be done
// truthfully is to compare the tree before and after the checks and report where it moved, split by
// whether the declaration covered it. The report therefore says "a check wrote somewhere it did not
// declare" instead of claiming a write could not happen.
//
// This does **not** reuse BAZ-042's snapshot comparison, and that is deliberate. The review scope
// excludes build output (`dist`, `node_modules`, …) — which is precisely what a declared output path
// names — so a comparison through that scope would be blind to the writes it exists to report. This is
// its own bounded filesystem fingerprint instead: paths and content digests, never content, with hard
// caps so a regenerated build tree cannot turn a verification into an unbounded walk.

/** Bounds. A check that explodes a build tree marks the observation truncated rather than growing it. */
export const FINGERPRINT_LIMITS = {
  files: 20_000,
  /** Per-file digest ceiling: larger files are recorded by size only. */
  fileBytes: 8 * 1024 * 1024,
  /** Total bytes hashed before the fingerprint stops reading content. */
  totalBytes: 128 * 1024 * 1024,
  /** Paths reported per category. */
  reported: 50,
} as const

export interface WorkspaceFingerprint {
  /** Path → identity (`sha256:…`, `size:…` for a large file, `link:…` for a symlink). */
  entries: Map<string, string>
  truncated: boolean
}

async function fingerprintPath(root: string, path: string, digest: boolean): Promise<string> {
  const absolute = join(root, path)
  const info = await lstat(absolute)
  if (info.isSymbolicLink()) return `link:${await readlink(absolute)}`
  if (!info.isFile()) return `other:${info.mode}`
  if (!digest || info.size > FINGERPRINT_LIMITS.fileBytes) return `size:${info.size}`
  return `sha256:${createHash('sha256')
    .update(await readFile(absolute))
    .digest('hex')}`
}

/**
 * A bounded fingerprint of the Team workspace.
 *
 * `.git` is skipped: its bytes are internal bookkeeping, and a check writing there is reported as an
 * observed path only through the checkout it would disturb, not by hashing object files.
 */
export async function fingerprintWorkspace(root: string): Promise<WorkspaceFingerprint> {
  const entries = new Map<string, string>()
  let truncated = false
  let files = 0
  let hashedBytes = 0
  const queue: string[] = ['']
  while (queue.length > 0) {
    const dir = queue.shift() ?? ''
    let children: string[]
    try {
      children = await readdir(join(root, dir), { withFileTypes: true }).then((rows) =>
        rows.map((row) => row.name),
      )
    } catch {
      continue
    }
    for (const name of children) {
      if (name === '.git') continue
      const path = dir === '' ? name : `${dir}/${name}`
      const absolute = join(root, path)
      let info: Awaited<ReturnType<typeof lstat>>
      try {
        info = await lstat(absolute)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        queue.push(path)
        continue
      }
      if (files >= FINGERPRINT_LIMITS.files) {
        truncated = true
        return { entries, truncated }
      }
      files++
      const digest = hashedBytes < FINGERPRINT_LIMITS.totalBytes
      if (digest && info.isFile() && info.size <= FINGERPRINT_LIMITS.fileBytes) {
        hashedBytes += info.size
      }
      try {
        entries.set(path, await fingerprintPath(root, path, digest))
      } catch {
        truncated = true
      }
    }
  }
  return { entries, truncated }
}

/**
 * Is `path` covered by a declared output path?
 *
 * A declaration names a file or a directory. Comparison is on path segments, not string prefixes, so a
 * declaration of `build` covers `build/out.js` but never `build-output/x.js`.
 */
export function isDeclaredOutputPath(path: string, declared: string): boolean {
  const target = path.replace(/^\.\//, '').replace(/\/+$/, '')
  const root = declared.replace(/^\.\//, '').replace(/\/+$/, '')
  if (root === '') return true
  return target === root || target.startsWith(`${root}/`)
}

function normalize(path: string): string {
  return path.replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * Where the tree moved between the baseline and now, split by whether the request declared it.
 *
 * An absent baseline is reported as `unknown` — never as "nothing was written", which is a claim this
 * cannot make.
 */
export function compareWorkspaceFingerprints(
  request: VerificationRequestRecord,
  baseline: WorkspaceFingerprint | null,
  after: WorkspaceFingerprint | null,
): VerificationObservedWrites {
  const declaredPaths = [
    ...new Set((request.environment.writablePaths ?? []).map(normalize)),
  ].sort()
  if (!baseline || !after) {
    return {
      comparison: 'unknown',
      declaredPaths,
      observedPaths: [],
      undeclaredPaths: [],
      truncated: false,
    }
  }
  const observed = new Set<string>()
  for (const [path, identity] of after.entries) {
    if (baseline.entries.get(path) !== identity) observed.add(path)
  }
  for (const path of baseline.entries.keys()) if (!after.entries.has(path)) observed.add(path)
  const sorted = [...observed].sort()
  const undeclared = sorted.filter(
    (path) => !declaredPaths.some((declared) => isDeclaredOutputPath(path, declared)),
  )
  return {
    comparison: sorted.length === 0 ? 'identical' : 'changed',
    declaredPaths,
    observedPaths: sorted.slice(0, FINGERPRINT_LIMITS.reported),
    undeclaredPaths: undeclared.slice(0, FINGERPRINT_LIMITS.reported),
    truncated: baseline.truncated || after.truncated || sorted.length > FINGERPRINT_LIMITS.reported,
  }
}
