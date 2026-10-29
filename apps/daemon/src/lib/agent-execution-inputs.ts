import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import type { Paths } from '../core/paths.ts'
import { ensureContainedRealDirectory, resolveRealDirectory } from '../runtime/safe-files.ts'
import { loadPromptSkills, loadProtectedHomeDocuments } from '../runtime/session/prompt.ts'
import type { ProtectedWorkerPaths } from '../runtime/worker/runtime.ts'
import { prepareInputFilesDirectory } from './attachments.ts'
import { ProtectedExecutionUnavailableError } from './protected-provider.ts'

/** Shared daemon-owned fixed-document snapshot and registered input paths; no runtime admission. */
export function prepareAgentExecutionPaths(
  paths: Paths,
  agent: ResolvedAgent,
  includeUploads = false,
): ProtectedWorkerPaths {
  let memoryDir: string, sessionDir: string, uploadsDir: string | undefined
  let homeDocuments: ReturnType<typeof loadProtectedHomeDocuments>
  try {
    resolveRealDirectory(agent.agent.dir)
    memoryDir = ensureContainedRealDirectory(join(agent.team.path, 'memory'), agent.team.path, {
      create: true,
    })
    sessionDir = ensureContainedRealDirectory(join(agent.agent.dir, 'sessions'), agent.agent.dir, {
      create: true,
    })
    uploadsDir = includeUploads ? prepareInputFilesDirectory(agent.agent.dir) : undefined
    homeDocuments = loadProtectedHomeDocuments(agent.agent.dir)
  } catch {
    throw new ProtectedExecutionUnavailableError(
      'Protected Agent paths are unavailable or unsafe. Run `bazilion doctor` for remediation.',
    )
  }
  return {
    agentDir: agent.agent.dir,
    teamDir: agent.team.path,
    memoryDir,
    sessionDir,
    ...(uploadsDir ? { uploadsDir } : {}),
    skills: loadPromptSkills(paths.skillsDir, agent.skills),
    homeDocuments,
  }
}
