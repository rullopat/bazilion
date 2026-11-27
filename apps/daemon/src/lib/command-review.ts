// The review model for dangerous commands (BAZILION_BASH_APPROVAL=review): before a command that
// the classifier finds dangerous goes to the owner, the model chosen as Command review (Setup →
// Models) reads it and allows it, refuses it, or passes it on. A model that cannot be reached, or
// whose answer cannot be read, passes it on: the owner decides, or nobody does and it is denied.

import type { CommandReview } from '@bazilion/api-types'
import type { BazilionDb } from '../core/index.ts'
import { parseModelString } from '../core/providers.ts'
import { loadAccessToken } from '../runtime/auth/openai-codex.ts'
import { completeOnce } from '../runtime/providers/pi-runtime.ts'

const SYSTEM_PROMPT = `You review shell commands that an AI Agent wants to run for its owner, before they run. The command was flagged as possibly dangerous by a simple classifier; most such commands are an ordinary step of the Agent's work.

Answer with one line of JSON and nothing else: {"decision": "allow" | "deny" | "ask", "reason": "<one short sentence for the owner>"}

- allow: an ordinary step of development, research or office work whose effects stay in the Agent's workspace, or are small and easy to undo.
- deny: it would destroy data the owner may need, expose secrets or credentials, change the system beyond the workspace, run code fetched from an unknown source, or harm anyone else.
- ask: you cannot tell what it does, or it cannot be undone and only the owner can judge whether that is wanted.`

export interface ReviewRequest {
  command: string
  risks: ReadonlyArray<{ code: string; message: string }>
  agentName: string
  /** Where commands run, as the Agent sees it. */
  workspace: string
  sandbox: 'host' | 'docker'
}

/** Read the model's verdict; anything unreadable is passed on to the owner. */
export function parseVerdict(text: string, model: string): CommandReview {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  try {
    const parsed = JSON.parse(json ?? '') as { decision?: unknown; reason?: unknown }
    const decision = parsed.decision
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 300) : ''
    if (decision === 'allow' || decision === 'deny' || decision === 'ask') {
      return { decision, reason: reason || 'No reason given.', model }
    }
  } catch {}
  return { decision: 'ask', reason: 'The review model’s answer could not be read.', model }
}

/** Ask the review model about one command. Never throws: a failure is an `ask`. */
export async function reviewCommand(
  input: ReviewRequest,
  options: {
    model: string
    db: BazilionDb
    authToken: string
    env: Readonly<Record<string, string | undefined>>
    signal?: AbortSignal
  },
): Promise<CommandReview> {
  try {
    const { providerName, modelId } = parseModelString(options.model)
    const apiKey =
      providerName === 'openai-codex'
        ? await loadAccessToken(options.db, options.authToken)
        : undefined
    const text = await completeOnce({
      providerName,
      modelId,
      env: options.env,
      ...(apiKey ? { apiKey } : {}),
      systemPrompt: SYSTEM_PROMPT,
      message: [
        `Agent: ${input.agentName}`,
        `Commands run ${input.sandbox === 'docker' ? 'in a Docker container without network' : "on the owner's computer"}, in ${input.workspace}.`,
        'Why it was flagged:',
        ...input.risks.map((risk) => `- ${risk.message} (${risk.code})`),
        'The command:',
        input.command,
      ].join('\n'),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    return parseVerdict(text, options.model)
  } catch (error) {
    return {
      decision: 'ask',
      reason: `The review model could not answer: ${error instanceof Error ? error.message : String(error)}`,
      model: options.model,
    }
  }
}
