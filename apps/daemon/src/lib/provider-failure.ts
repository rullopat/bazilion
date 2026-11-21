// A failed provider test in plain words. Pi reports failures as `<status>: <the provider's JSON>`,
// `<status> <text>` or `Connection error.: <cause>`; Setup shows what happened and what to do, and
// keeps the provider's own message as the detail.

import type { ProviderFailure, ProviderFailureKind } from '@bazilion/api-types'
import type { ProviderDef } from '../core/providers.ts'

const UNREACHABLE =
  /connection error|econnrefused|enotfound|ehostunreach|enetunreach|etimedout|econnreset|fetch failed|bad port|socket hang up|getaddrinfo|und_err|request aborted|request timed out/
const CREDENTIALS =
  /invalid.{0,12}api.?key|incorrect api key|invalid x-api-key|invalid_api_key|authentication_error|unauthorized|invalid.{0,12}(access )?token/
const MODEL =
  /model_not_found|no models loaded|not found, try pulling|not_found_error.{0,40}\bmodel\b|\bmodel\b.{0,80}(not found|does not exist|do not have access|not available|is not supported)|(must be verified|not have access|no access).{0,60}\bmodel\b/
const LIMIT = /insufficient|quota|rate.?limit|billing|\bcredits?\b|overloaded/

export function classifyProviderFailure(message: string, timedOut = false): ProviderFailureKind {
  const text = message.toLowerCase()
  const status = /^(\d{3})\b/.exec(text)?.[1]
  if (timedOut || UNREACHABLE.test(text)) return 'unreachable'
  if (status === '401' || CREDENTIALS.test(text)) return 'credentials'
  if (MODEL.test(text)) return 'model'
  if (status === '402' || status === '429' || LIMIT.test(text)) return 'limit'
  if (status === '403') return 'credentials'
  return 'other'
}

/** Take stored credentials out of a provider's message and keep it to a line or two. */
export function redactDetail(message: string, secrets: readonly string[]): string {
  let detail = message
  for (const secret of secrets) {
    if (secret.length >= 6) detail = detail.split(secret).join('…')
  }
  detail = detail.replace(/\s+/g, ' ').trim()
  return detail.length > 400 ? `${detail.slice(0, 400)}…` : detail
}

export interface FailureContext {
  provider: ProviderDef
  /** The model that was asked, as people know it. */
  modelName: string
  /** A local server's address, without the path. */
  address?: string
  /** The request ran into Bazilion's own time limit. */
  timedOut?: boolean
  /** Values that must not appear in the detail. */
  secrets?: readonly string[]
}

export function describeProviderFailure(message: string, context: FailureContext): ProviderFailure {
  const { provider, modelName, address, timedOut = false } = context
  const name = provider.displayName
  const local = Boolean(provider.local)
  const kind = classifyProviderFailure(message, timedOut)
  const detail = redactDetail(message, context.secrets ?? [])
  const status = /^(\d{3})\b/.exec(message)?.[1]

  switch (kind) {
    case 'unreachable':
      if (timedOut)
        return {
          kind,
          title: `${name} did not answer in time`,
          hint: local
            ? 'A local model can take a while to load. Try again once it is loaded.'
            : 'Try again in a moment.',
          detail,
        }
      return local
        ? {
            kind,
            title: `Nothing answers at ${address ?? 'that address'}`,
            hint: `Start ${name} and switch its server on, then try again.`,
            detail,
          }
        : {
            kind,
            title: `${name} could not be reached`,
            hint: 'Check the network of the machine Bazilion runs on, then try again.',
            detail,
          }
    case 'credentials':
      if (provider.id === 'openai-codex')
        return { kind, title: 'ChatGPT did not accept the sign-in', hint: 'Sign in again.', detail }
      if (local)
        return {
          kind,
          title: `${name} asked for a key it did not get`,
          hint: 'Set the API key the server was started with, under More settings.',
          detail,
        }
      return provider.fields.some((field) => field.kind === 'secret')
        ? {
            kind,
            title: `${name} did not accept this key`,
            hint: 'Check that the whole key was pasted and that it was not revoked.',
            detail,
          }
        : {
            kind,
            title: `${name} did not accept the credentials`,
            hint: provider.hint ?? 'Check the credentials in the daemon’s environment.',
            detail,
          }
    case 'model':
      return local
        ? {
            kind,
            title: `${name} does not have ${modelName} ready`,
            hint: `Load it in ${name}, or choose another model.`,
            detail,
          }
        : {
            kind,
            title: `${name} does not offer ${modelName} to this account`,
            hint: 'Choose another model.',
            detail,
          }
    case 'limit':
      return {
        kind,
        title: `${name} accepted the key but refused the request`,
        hint: 'A limit was reached or there is no credit left. Check the plan and billing at the provider.',
        detail,
      }
    default:
      return local && status === '404'
        ? {
            kind,
            title: `${address ?? 'That address'} answered, but not like a model server`,
            hint: 'Check the address. It usually ends in /v1.',
            detail,
          }
        : {
            kind,
            title: `${name} answered with an error`,
            hint: 'Its own words are in the details.',
            detail,
          }
  }
}
