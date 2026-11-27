/**
 * A secret an Agent uses (BAZ-090): its commands get it as an environment variable, and
 * `web_fetch` puts it in headers written `{{secret:NAME}}` for its hosts only. The value is never
 * sent back.
 */
export interface AgentSecret {
  name: string
  /** Why the Agent asked for it; null when you set it yourself without one. */
  reason: string | null
  /** The hosts `web_fetch` may send it to; empty means commands only. */
  hosts: string[]
  storedAt: number
}

export interface ListAgentSecretsResponse {
  secrets: AgentSecret[]
}

/** Store or replace a secret. Omitted `hosts` and `reason` keep what the secret had. */
export interface SetAgentSecretRequest {
  value: string
  hosts?: string[]
  reason?: string
}

export interface SetAgentSecretResponse {
  secret: AgentSecret
}
