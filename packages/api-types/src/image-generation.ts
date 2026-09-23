import type { ResultReference } from './results.ts'

/** The selection is also the credential/billing route; it is not a backend model attestation. */
export function imageGenerationRouteLabel(model: string): string {
  if (model === 'openai:gpt-image-2') return 'OpenAI API key'
  if (model === 'openai-codex:gpt-image-2') return 'ChatGPT/Codex login'
  if (model === 'google/gemini-3.1-flash-image' || model === 'openai/gpt-image-2')
    return 'OpenRouter'
  return 'Unknown image route'
}

/** Private IPC request. Agent/Team/model/credentials are supplied only by the bound daemon host. */
export interface ImageGenerationInput {
  sessionId: string
  toolCallId: string
  prompt: string
  name?: string
}

/** Bytes travel only to the existing authorized file-delivery path, never tool-result image blocks. */
export interface ImageGenerationOutput {
  model: string
  files: Array<{ name: string; mimeType: string; data: string; result: ResultReference }>
}
