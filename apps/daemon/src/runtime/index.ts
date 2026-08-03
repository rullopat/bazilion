export type { OAuthAuthInfo, OAuthPrompt } from '@earendil-works/pi-ai'
export type { StoredCredentials } from './auth/openai-codex.ts'
export {
  clearCredentials as clearOpenAICodexCredentials,
  getStatus as getOpenAICodexStatus,
  hasCredentials as hasOpenAICodexCredentials,
  loadAccessToken as loadOpenAICodexAccessToken,
  loginOpenAICodex,
  OPENAI_CODEX_SECRET_KEY,
  refreshOpenAICodexToken,
  saveLoginCredentials as saveOpenAICodexLoginCredentials,
} from './auth/openai-codex.ts'
export { filesBackend } from './memory/files.ts'
export { qmdBackend } from './memory/qmd.ts'
export type { MemoryBackend } from './memory/types.ts'
export {
  extractAssistantText,
  extractAssistantToolCalls,
  extractToolResultText,
  piMessagesToProviderView,
  translatePiEvent,
} from './pi/events.ts'
export type { BazilionSessionHandle, CreateBazilionSessionOptions } from './pi/session.ts'
export {
  countSessionMessagesForTest,
  createBazilionSession,
  isProviderEnabled,
  loadEnabledRegistry,
  loadInitialMessages,
  loadSessionHead,
  loadSessionMessages,
  seedSessionForTest,
} from './pi/session.ts'
// Pi-coding-agent integration surface. The worker runs inside a
// `BazilionSession` (pi's AgentSession wrapper) and endpoints (/compact,
// /context, /reset) drive pi session operations directly.
export type { BazilionCustomToolsOpts } from './pi/tools.ts'
export { createBazilionCustomTools, ourToolToPiTool } from './pi/tools.ts'
export type { CatalogResult, LiveFetchResult } from './providers/catalog.ts'
export { listCatalogModels, listCatalogModelsSync } from './providers/catalog.ts'
export type { PiProviderConfig } from './providers/pi-adapter.ts'
export { piProvider, resolveModel as resolvePiModel } from './providers/pi-adapter.ts'
export type {
  ProviderConfig,
  ProviderMeta,
  ProviderRegistry,
  ResolvedModel,
} from './providers/registry.ts'
export {
  createProviderRegistry,
  listAllProviders,
  loadProviderConfigFromEnv,
} from './providers/registry.ts'
export type { RetryOptions } from './providers/retry.ts'
export { isRetryableError, withRetry } from './providers/retry.ts'
export type {
  Provider,
  ProviderRequest,
  ProviderResponse,
  StopReason,
} from './providers/types.ts'
export {
  buildSystemPrompt,
  loadPromptSkills,
  type PromptSkill,
} from './session/prompt.ts'
export { bootstrapTool } from './tools/bootstrap.ts'
export { memoryTools } from './tools/memory.ts'
export { messagingTools } from './tools/messaging.ts'
export { createToolRegistry } from './tools/registry.ts'
export type { ToolHandler, ToolRegistry } from './tools/types.ts'
export { webTools } from './tools/web.ts'

export type {
  ApiKeyRefreshHost,
  BrowserHost,
  InjectedMcpTool,
  McpHost,
  MessagingHost,
  UserMdGetResult,
  UserMdHost,
  UserMdWriteResult,
} from './worker/ipc-protocol.ts'
export type { ReviewWorkerProposal, SpawnWorkerOpts } from './worker/spawn.ts'
export { spawnReviewWorker, spawnWorkerTurn } from './worker/spawn.ts'
