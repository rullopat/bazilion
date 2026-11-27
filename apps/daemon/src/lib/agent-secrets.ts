// An Agent's secrets as the daemon handles them (BAZ-090): the request card `secret_request`
// shows, and storing or removing one from the Agent's sheet or `bazilion agent secret`, which
// answers a request still waiting for that name.

import type { AgentQuestionSecret, AgentSecret } from '@bazilion/api-types'
import {
  checkSecretHosts,
  checkSecretName,
  listAgentSecrets,
  removeAgentSecret,
  setAgentSecret,
} from '../core/agent-secrets.ts'
import type { BazilionDb } from '../core/db/client.ts'
import { DomainError } from '../core/errors.ts'
import type { SecretRequestResult } from '../runtime/worker/ipc-protocol.ts'
import { signalLiveChange } from './live-signal.ts'
import { QUESTION_LIMITS, questionRegistry } from './questions.ts'

/** What the Agent asked for, checked: a name it may use, why, and the hosts. */
export function parseSecretRequest(raw: unknown): AgentQuestionSecret {
  const input = (raw ?? {}) as Record<string, unknown>
  const name = checkSecretName(input.name)
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason) throw new DomainError(400, 'say why you need the secret (reason)')
  if (reason.length > QUESTION_LIMITS.promptChars)
    throw new DomainError(400, `reason is longer than ${QUESTION_LIMITS.promptChars} characters`)
  const hosts = checkSecretHosts(input.hosts)
  return { name, reason, ...(hosts.length > 0 ? { hosts } : {}) }
}

/** `secret_request`: the card, unless the Agent has the secret and does not ask to replace it. */
export function requestAgentSecret(
  db: BazilionDb,
  password: string,
  input: { agentId: string; conversationId: string; secret: unknown; replace: boolean },
): SecretRequestResult {
  const secret = parseSecretRequest(input.secret)
  if (!input.replace) {
    const have = listAgentSecrets(db, password, input.agentId).find((s) => s.name === secret.name)
    if (have) return { kind: 'stored', secret: have }
  }
  return {
    kind: 'asked',
    question: questionRegistry.askSecret(
      { agentId: input.agentId, conversationId: input.conversationId },
      secret,
    ),
  }
}

/** Store or replace a secret from the Agent's sheet or the CLI; a waiting request is answered. */
export function storeAgentSecret(
  db: BazilionDb,
  password: string,
  agentId: string,
  input: { name: string; value: unknown; reason?: unknown; hosts?: unknown },
): AgentSecret {
  // A waiting request says why and for which hosts, unless the owner says otherwise.
  const asked = questionRegistry
    .list(agentId)
    .find((question) => question.question.secret?.name === input.name)?.question.secret
  const secret = setAgentSecret(db, password, agentId, {
    ...input,
    reason: input.reason ?? asked?.reason,
    hosts: input.hosts ?? asked?.hosts,
  })
  questionRegistry.settleSecret(agentId, secret.name)
  signalLiveChange()
  return secret
}

export function deleteAgentSecret(
  db: BazilionDb,
  password: string,
  agentId: string,
  name: string,
): void {
  if (!removeAgentSecret(db, password, agentId, name))
    throw new DomainError(404, `this Agent has no secret ${name}`)
  signalLiveChange()
}
