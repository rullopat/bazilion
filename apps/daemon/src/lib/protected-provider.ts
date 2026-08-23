import type { ResolvedAgent } from '@bazilion/api-types'
import { type BazilionDb, providerStateRepo } from '../core/index.ts'
import type { OpenAICodexWorkerRuntime } from '../runtime/worker/runtime.ts'
import { resolveAgentApiKey } from './api-key.ts'

export class ProtectedExecutionUnavailableError extends Error {
  readonly code = 'protected_execution_unavailable'

  constructor(message: string) {
    super(message)
    this.name = 'ProtectedExecutionUnavailableError'
  }
}

export interface ProtectedOpenAICodexResolution {
  runtime: OpenAICodexWorkerRuntime
  refreshApiKey: (providerName: string) => Promise<string>
}

/** Resolve the only credential shape admitted to BAZ-027 protected workers. */
export async function resolveProtectedOpenAICodexRuntime(
  db: BazilionDb,
  authToken: string,
  agent: ResolvedAgent,
  reasoningLevel = agent.reasoningLevel,
): Promise<ProtectedOpenAICodexResolution> {
  const separator = agent.model.indexOf(':')
  const providerName = separator < 0 ? agent.model : agent.model.slice(0, separator)
  const modelId = separator < 0 ? '' : agent.model.slice(separator + 1)
  if (providerName !== 'openai-codex' || !modelId) {
    throw new ProtectedExecutionUnavailableError(
      'Protected unattended turns currently require an OpenAI Codex model.',
    )
  }
  if (!providerStateRepo.listEnabled(db).has('openai-codex')) {
    throw new ProtectedExecutionUnavailableError(
      'OpenAI Codex is not enabled for protected unattended turns.',
    )
  }

  let resolution: Awaited<ReturnType<typeof resolveAgentApiKey>>
  try {
    resolution = await resolveAgentApiKey(db, authToken, agent, { withRefresher: true })
  } catch {
    throw new ProtectedExecutionUnavailableError(
      'ChatGPT is not connected for protected unattended turns.',
    )
  }
  if (!resolution.apiKey?.trim() || !resolution.refreshApiKey) {
    throw new ProtectedExecutionUnavailableError(
      'OpenAI Codex access and bound refresh are required for protected unattended turns.',
    )
  }

  return {
    runtime: {
      providerName: 'openai-codex',
      modelId,
      reasoningLevel,
      accessToken: resolution.apiKey,
    },
    refreshApiKey: resolution.refreshApiKey,
  }
}
