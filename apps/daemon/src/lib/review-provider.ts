import type { ResolvedAgent } from '@bazilion/api-types'
import { type BazilionDb, mergeSecretsIntoEnv, providerStateRepo } from '../core/index.ts'
import {
  findProvider,
  parseModelString,
  providerApiKey,
  providerCredentialEnv,
  providerEndpoint,
} from '../core/providers.ts'
import type { ReviewProviderRuntime } from '../runtime/worker/runtime.ts'
import { resolveAgentApiKey } from './api-key.ts'
import { ExecutionUnavailableError } from './execution-unavailable.ts'

interface ReviewProvider {
  runtime: ReviewProviderRuntime
  /** The ChatGPT token refresher; static credentials need none, Pi holds them in memory. */
  refreshApiKey?: (providerName: string) => Promise<string>
}

/** A configured endpoint, admitted only without URL credentials and over HTTPS unless local. */
function reviewEndpoint(providerName: string, env: NodeJS.ProcessEnv): string | undefined {
  const raw = providerEndpoint(providerName, env)
  if (!raw) return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ExecutionUnavailableError('Provider endpoint is invalid.')
  }
  if (url.username || url.password || url.hash) {
    throw new ExecutionUnavailableError('Provider endpoint contains unsafe URL fields.')
  }
  // Local providers (LM Studio, Ollama, llama.cpp) may live anywhere on the LAN.
  if (!findProvider(providerName)?.local && url.protocol !== 'https:') {
    throw new ExecutionUnavailableError('Credential-bearing provider endpoints require HTTPS.')
  }
  return url.toString().replace(/\/$/, '')
}

function explicitCredentialEnv(providerName: string, env: NodeJS.ProcessEnv) {
  const values = providerCredentialEnv(providerName, env) ?? {}
  if (providerName === 'bedrock') {
    delete values.AWS_PROFILE
    const bearer = values.AWS_BEARER_TOKEN_BEDROCK
    const staticPair = values.AWS_ACCESS_KEY_ID && values.AWS_SECRET_ACCESS_KEY
    if (!bearer && !staticPair) {
      throw new ExecutionUnavailableError(
        'Bedrock learning reviews require an explicit bearer token or static key pair; AWS profiles are not read by the reviewer.',
      )
    }
  }
  if (providerName === 'google-vertex') {
    delete values.GOOGLE_APPLICATION_CREDENTIALS
    if (!values.GOOGLE_CLOUD_PROJECT || !values.GOOGLE_CLOUD_LOCATION) {
      throw new ExecutionUnavailableError(
        'Google Vertex learning reviews require an explicit project and location.',
      )
    }
  }
  return Object.entries(values).map(([name, value]) => ({ name, value }))
}

/**
 * Resolve the review model's provider credential for the learning-review worker, which runs with
 * a minimal environment and receives only this projection. `agent` carries the review's model and
 * reasoning level.
 */
export async function resolveReviewProvider(
  db: BazilionDb,
  authToken: string,
  agent: ResolvedAgent,
): Promise<ReviewProvider> {
  const { reasoningLevel } = agent
  let model: ReturnType<typeof parseModelString>
  try {
    model = parseModelString(agent.model)
  } catch {
    throw new ExecutionUnavailableError('Learning reviews require a provider:model model.')
  }
  const { providerName, modelId } = model
  if (!findProvider(providerName)) {
    throw new ExecutionUnavailableError(`Learning reviews do not know provider ${providerName}.`)
  }
  if (!providerStateRepo.listEnabled(db).has(providerName)) {
    throw new ExecutionUnavailableError(`${providerName} is not enabled.`)
  }

  if (providerName === 'openai-codex') {
    let resolution: Awaited<ReturnType<typeof resolveAgentApiKey>>
    try {
      resolution = await resolveAgentApiKey(db, authToken, agent)
    } catch {
      throw new ExecutionUnavailableError('ChatGPT is not connected.')
    }
    if (!resolution.apiKey?.trim() || !resolution.refreshApiKey) {
      throw new ExecutionUnavailableError(
        'OpenAI Codex access and bound refresh are required for learning reviews.',
      )
    }
    return {
      runtime: { providerName, modelId, reasoningLevel, apiKey: resolution.apiKey },
      refreshApiKey: resolution.refreshApiKey,
    }
  }

  const env = mergeSecretsIntoEnv(db, authToken)
  const apiKey = providerApiKey(providerName, env)
  const credentialEnv = explicitCredentialEnv(providerName, env)
  let credentialFile: ReviewProviderRuntime['credentialFile']
  if (providerName === 'google-vertex') {
    const content = env.GOOGLE_VERTEX_CREDENTIALS_JSON
    try {
      if (!content || Buffer.byteLength(content, 'utf8') > 64 * 1024) throw new Error()
      const parsed = JSON.parse(content) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    } catch {
      throw new ExecutionUnavailableError(
        'Google Vertex learning reviews require valid explicit credentials JSON.',
      )
    }
    credentialFile = { envName: 'GOOGLE_APPLICATION_CREDENTIALS', content }
  }
  if (!apiKey?.trim() && credentialEnv.length === 0 && !credentialFile) {
    throw new ExecutionUnavailableError(
      `${providerName} has no explicit credential for learning reviews.`,
    )
  }
  const baseUrl = reviewEndpoint(providerName, env)
  return {
    runtime: {
      providerName,
      modelId,
      reasoningLevel,
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(credentialEnv.length > 0 ? { credentialEnv } : {}),
      ...(credentialFile ? { credentialFile } : {}),
    },
  }
}
