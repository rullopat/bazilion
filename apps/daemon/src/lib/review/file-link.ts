import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import type { ReviewFileLink } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import type { ReviewPacketRecord } from '../../core/repos/review-packets.ts'
import { requireTeam } from '../git-review/service.ts'
import { readRevisionChanges } from './revision.ts'

// BAZ-043 criterion 5: file links and editor handoff, told truthfully.
//
// Three things this refuses to do, because each one is a lie an editor button commonly tells:
//
//   1. **It never invents a host.** The workspace belongs to the machine running the daemon. A browser on
//      another computer cannot open the daemon host's path, so the link always says which host it names and
//      always offers a copyable, repository-relative location. Opening is an explicit action, never a side
//      effect of viewing.
//   2. **It never claims the live file is the reviewed revision.** Content is only the reviewed revision's
//      while the tree still matches the capture; once it has moved, the link points at a *different* file
//      and says so.
//   3. **A path is never a command.** Nothing here builds a shell string: a configured command is split into
//      argv and executed without a shell, and the path must be one the capture recorded. A hostile filename
//      is a filename, not an argument injection.

const execFileAsync = promisify(execFile)

/**
 * Operator-configured editor, e.g. `code --goto {path}:{line}` or `editor {path}`.
 *
 * Absent by default, and that is the safe default: without it the daemon offers a copyable location and no
 * open action.
 */
const EDITOR_TEMPLATE_ENV = 'BAZILION_REVIEW_EDITOR'

/** Optional `hostPrefix:containerPrefix` mapping when the daemon runs somewhere the editor does not. */
const EDITOR_MAP_ENV = 'BAZILION_REVIEW_EDITOR_MAP'

export interface FileLinkInput {
  db: BazilionDb
  paths: Paths
  packet: ReviewPacketRecord
  path: string
  line: number | null
  /** Whether the live tree still matches the capture, established by the caller. */
  contentAvailable: boolean
  env?: NodeJS.ProcessEnv
}

export function buildFileLink(input: FileLinkInput): ReviewFileLink {
  const env = input.env ?? process.env
  const notes: string[] = []
  const team = requireTeam(input.db, input.paths, input.packet.teamId)
  const revision = readRevisionChanges(input.db, input.paths, input.packet)
  const known = revision.ok && revision.changes.some((change) => change.path === input.path)

  const line = input.line !== null && input.line >= 1 ? input.line : null
  const copyTarget = line === null ? input.path : `${input.path}:${line}`

  const hostPath = known ? join(team.path, input.path) : null
  const template = env[EDITOR_TEMPLATE_ENV]?.trim()
  const mapped = hostPath ? mapHostPath(hostPath, env[EDITOR_MAP_ENV]) : null

  if (!known) {
    notes.push(
      'That path is not part of the reviewed revision, so there is nothing to open for it.',
    )
  }
  notes.push(
    input.contentAvailable
      ? 'The working tree still matches the reviewed revision, so this file is the reviewed content.'
      : 'The working tree has moved since the capture: this file is the current content, not the reviewed revision.',
  )
  if (!template) {
    notes.push(
      `No editor is configured for this daemon, so nothing was offered to run. Set ${EDITOR_TEMPLATE_ENV} on the daemon host to enable an open action.`,
    )
  }
  if (template && !mapped) {
    notes.push('The configured editor needs a path mapping that this daemon does not have.')
  }

  return {
    path: input.path,
    line,
    hostPath: mapped,
    copyTarget,
    mode: input.contentAvailable ? 'live' : revision.ok ? 'stale' : 'unknown',
    host: { daemon: safeHostname(), ownsWorkspace: true },
    canOpen: Boolean(template && mapped && known),
    command: template ?? null,
    notes,
  }
}

function safeHostname(): string | null {
  try {
    return hostname() || null
  } catch {
    return null
  }
}

/**
 * Apply `hostPrefix:editorPrefix` when the editor runs somewhere the daemon's paths do not apply.
 *
 * An unmapped absolute path is offered as-is only when the operator has not asked for a mapping: a mapping
 * that is configured but does not match means the editor could not reach the file, which is reported rather
 * than papered over.
 */
function mapHostPath(hostPath: string, mapping: string | undefined): string | null {
  if (!mapping?.trim()) return hostPath
  const [from, to] = mapping.split(':')
  if (!from || !to) return hostPath
  if (!isAbsolute(from) || !isAbsolute(to)) return null
  if (!hostPath.startsWith(from)) return null
  return `${to}${hostPath.slice(from.length)}`
}

export interface OpenResult {
  opened: boolean
  /** What ran, or why nothing did. The operator sees this, so it says exactly what happened. */
  detail: string
}

/**
 * Open one path — an explicit operator action, and the only thing in this module that executes anything.
 *
 * The template is split on whitespace into argv and run **without a shell**, so a filename cannot become a
 * command: it arrives as one argv element and nothing else. `{path}` and `{line}` are substituted inside
 * their own argv element, never spliced into a string that gets re-parsed.
 */
export async function openFileLink(link: ReviewFileLink): Promise<OpenResult> {
  if (!link.canOpen || !link.hostPath || !link.command) {
    return { opened: false, detail: link.notes.at(-1) ?? 'nothing to open' }
  }
  const argv = splitTemplate(link.command, link.hostPath, link.line)
  const [command, ...args] = argv
  if (!command) return { opened: false, detail: 'the configured editor command is empty' }
  try {
    await execFileAsync(command, args, { timeout: 10_000 })
    return { opened: true, detail: `ran ${command} on ${link.hostPath} (daemon host)` }
  } catch (error) {
    return {
      opened: false,
      detail: `the editor could not be started: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
}

/** Split a command template into argv. No shell, no quoting rules, no re-parsing. */
export function splitTemplate(template: string, path: string, line: number | null): string[] {
  return template
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '')
    .map((part) =>
      part.replaceAll('{path}', path).replaceAll('{line}', line === null ? '1' : String(line)),
    )
}
