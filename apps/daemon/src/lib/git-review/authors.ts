// Which Agent last wrote each changed file, read from the Team members' conversations: their
// `write` and `edit` tool calls that did not fail. A change a shell command made has no author.

import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ReviewChangeAuthor } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import * as agentRepo from '../../core/repos/agents.ts'
import * as conversations from '../../core/repos/conversations.ts'
import { readSessionFile } from '../../runtime/pi/session-file.ts'

const FILE_TOOLS = new Set(['write', 'edit'])
/** Each member's newest conversations are read; older ones rarely explain uncommitted changes. */
const CONVERSATIONS_PER_AGENT = 5
/** Where a Docker turn sees the Team workspace. */
const SANDBOX_ROOT = '/workspace'

interface SessionLine {
  type?: string
  cwd?: string
  timestamp?: string
  message?: {
    role?: string
    toolCallId?: string
    isError?: boolean
    content?: unknown
  }
}

interface ToolCallPart {
  type?: string
  id?: string
  name?: string
  arguments?: { path?: unknown }
}

/** A tool's path as a path inside the Team workspace, or null when it points elsewhere. */
function workspacePath(path: string, cwd: string, roots: readonly string[]): string | null {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path)
  for (const root of roots) {
    const inside = relative(root, absolute)
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) {
      return inside.split(sep).join('/')
    }
  }
  return null
}

export function readChangeAuthors(
  db: BazilionDb,
  paths: Paths,
  team: { id: string; path: string },
  changedPaths: readonly string[],
): Record<string, ReviewChangeAuthor> {
  const wanted = new Set(changedPaths)
  const authors: Record<string, ReviewChangeAuthor> = {}
  if (wanted.size === 0) return authors
  const roots = [team.path, SANDBOX_ROOT]
  try {
    roots.push(realpathSync(team.path))
  } catch {
    // A workspace that cannot be resolved keeps the path as registered.
  }
  const members = agentRepo
    .list(db, { includeArchived: true })
    .filter((agent) => agent.teamId === team.id)
  for (const agent of members) {
    const directory = join(paths.agentDir(agent.id), 'sessions')
    const recent = conversations.list(db, agent.id, CONVERSATIONS_PER_AGENT, 0).conversations
    for (const conversation of recent) {
      let lines: SessionLine[]
      try {
        lines = readSessionFile(directory, conversation.id) as SessionLine[]
      } catch {
        continue
      }
      const cwd = lines[0]?.cwd ?? team.path
      const failed = new Set<string>()
      for (const line of lines) {
        const message = line.message
        if (message?.role === 'toolResult' && message.isError && message.toolCallId) {
          failed.add(message.toolCallId)
        }
      }
      for (const line of lines) {
        if (line.type !== 'message' || line.message?.role !== 'assistant') continue
        if (!Array.isArray(line.message.content)) continue
        const at = Date.parse(line.timestamp ?? '')
        if (!Number.isFinite(at)) continue
        for (const part of line.message.content as ToolCallPart[]) {
          if (part?.type !== 'toolCall' || !part.name || !FILE_TOOLS.has(part.name)) continue
          if (part.id && failed.has(part.id)) continue
          const target = part.arguments?.path
          if (typeof target !== 'string') continue
          const path = workspacePath(target, cwd, roots)
          if (!path || !wanted.has(path)) continue
          const known = authors[path]
          if (known && known.at >= at) continue
          authors[path] = {
            agentId: agent.id,
            agentName: agent.name,
            conversationId: conversation.id,
            at,
          }
        }
      }
    }
  }
  return authors
}
