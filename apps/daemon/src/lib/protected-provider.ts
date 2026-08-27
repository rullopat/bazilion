import type { ResolvedAgent } from '@bazilion/api-types'
import { type BazilionDb, mergeSecretsIntoEnv, providerStateRepo } from '../core/index.ts'
import {
  LOCAL_PROVIDERS,
  PROTECTED_PROVIDER_NAMES,
  type ProtectedProviderName,
  providerApiKey,
  providerBaseUrl,
  providerCredentialEnv,
} from '../runtime/providers/pi-runtime.ts'
import type { ProtectedProviderWorkerRuntime } from '../runtime/worker/runtime.ts'
import { resolveAgentApiKey } from './api-key.ts'

export class ProtectedExecutionUnavailableError extends Error {
  readonly code = 'protected_execution_unavailable'

  constructor(message: string) {
    super(message)
    this.name = 'ProtectedExecutionUnavailableError'
  }
}

export interface ProtectedProviderResolution {
  runtime: ProtectedProviderWorkerRuntime
  refreshApiKey: (providerName: string) => Promise<string>
}

function protectedBaseUrl(providerName: string, env: NodeJS.ProcessEnv): string | undefined {
  const raw = providerBaseUrl(providerName, env)
  if (!raw) return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ProtectedExecutionUnavailableError('Protected provider endpoint is invalid.')
  }
  if (url.username || url.password || url.hash) {
    throw new ProtectedExecutionUnavailableError(
      'Protected provider endpoint contains unsafe URL fields.',
    )
  }
  if (providerName in LOCAL_PROVIDERS) {
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    ) {
      throw new ProtectedExecutionUnavailableError(
        'Protected local providers require an explicit loopback HTTP endpoint.',
      )
    }
  } else if (url.protocol !== 'https:') {
    throw new ProtectedExecutionUnavailableError(
      'Protected credential-bearing provider endpoints require HTTPS.',
    )
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
      throw new ProtectedExecutionUnavailableError(
        'Protected Bedrock turns require an explicit bearer token or static key pair; AWS profiles are not read by workers.',
      )
    }
  }
  if (providerName === 'google-vertex') {
    delete values.GOOGLE_APPLICATION_CREDENTIALS
    if (!values.GOOGLE_CLOUD_PROJECT || !values.GOOGLE_CLOUD_LOCATION) {
      throw new ProtectedExecutionUnavailableError(
        'Protected Google Vertex turns require an explicit project and location.',
      )
    }
  }
  return Object.entries(values).map(([name, value]) => ({ name, value }))
}

/** Resolve one exhaustive, credential-minimal projection for the selected Pi provider. */
export async function resolveProtectedProviderRuntime(
  db: BazilionDb,
  authToken: string,
  agent: ResolvedAgent,
  reasoningLevel = agent.reasoningLevel,
): Promise<ProtectedProviderResolution> {
  const separator = agent.model.indexOf(':')
  const rawProvider = separator < 0 ? agent.model : agent.model.slice(0, separator)
  const modelId = separator < 0 ? '' : agent.model.slice(separator + 1)
  if (!PROTECTED_PROVIDER_NAMES.includes(rawProvider as ProtectedProviderName) || !modelId) {
    throw new ProtectedExecutionUnavailableError(
      'Protected turns require a model from the pinned Pi provider catalog.',
    )
  }
  const providerName = rawProvider as ProtectedProviderName
  if (!providerStateRepo.listEnabled(db).has(providerName)) {
    throw new ProtectedExecutionUnavailableError(
      `${providerName} is not enabled for protected turns.`,
    )
  }

  if (providerName === 'openai-codex') {
    let resolution: Awaited<ReturnType<typeof resolveAgentApiKey>>
    try {
      resolution = await resolveAgentApiKey(db, authToken, agent, { withRefresher: true })
    } catch {
      throw new ProtectedExecutionUnavailableError('ChatGPT is not connected for protected turns.')
    }
    if (!resolution.apiKey?.trim() || !resolution.refreshApiKey) {
      throw new ProtectedExecutionUnavailableError(
        'OpenAI Codex access and bound refresh are required for protected turns.',
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
  let credentialFile: ProtectedProviderWorkerRuntime['credentialFile']
  if (providerName === 'google-vertex') {
    const content = env.GOOGLE_VERTEX_CREDENTIALS_JSON
    try {
      if (!content || Buffer.byteLength(content, 'utf8') > 64 * 1024) throw new Error()
      const parsed = JSON.parse(content) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    } catch {
      throw new ProtectedExecutionUnavailableError(
        'Protected Google Vertex turns require valid explicit credentials JSON.',
      )
    }
    credentialFile = { envName: 'GOOGLE_APPLICATION_CREDENTIALS', content }
  }
  if (!apiKey?.trim() && credentialEnv.length === 0 && !credentialFile) {
    throw new ProtectedExecutionUnavailableError(
      `${providerName} has no explicit credential for protected turns.`,
    )
  }
  const selectedCredential = apiKey ?? ''
  const baseUrl = protectedBaseUrl(providerName, env)
  const runtime: ProtectedProviderWorkerRuntime = {
    providerName,
    modelId,
    reasoningLevel,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(credentialEnv.length > 0 ? { credentialEnv } : {}),
    ...(credentialFile ? { credentialFile } : {}),
  }
  return {
    runtime,
    refreshApiKey: async (requestedProvider) => {
      if (requestedProvider !== providerName) throw new Error('unexpected protected provider')
      return selectedCredential
    },
  }
}
