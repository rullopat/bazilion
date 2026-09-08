import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { Paths } from '../core/paths.ts'
import { readResultSession } from './result-source.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Persist a canonical empty Pi session before daemon metadata can select it.
 * The caller owns the Agent lifecycle lease and supplies the immutable ID.
 * Uncommitted staging files cannot be mistaken for canonical JSONL sessions.
 */
export function createConversationFile(
  paths: Paths,
  agentId: string,
  conversationId: string,
  cwd: string,
): string {
  if (!uuid.test(agentId) || !uuid.test(conversationId))
    throw new Error('Invalid conversation identity')
  const directory = join(realpathSync(paths.agentsDir), agentId, 'sessions')
  if (realpathSync(directory) !== directory) throw new Error('Conversation escaped its Agent')
  const filename = `${conversationId}.jsonl`
  const destination = join(directory, filename)
  const staging = join(directory, `.conversation-${randomUUID()}.tmp`)
  const header = SessionManager.inMemory(cwd, { id: conversationId }).getHeader()
  const fd = openSync(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    try {
      writeFileSync(fd, `${JSON.stringify(header)}\n`)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      // Publish without replacing an existing transcript, even on a retried request.
      linkSync(staging, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      readResultSession(paths, agentId, filename, conversationId)
    }
    const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY)
    try {
      fsyncSync(directoryFd)
    } finally {
      closeSync(directoryFd)
    }
    return filename
  } finally {
    unlinkSync(staging)
  }
}
