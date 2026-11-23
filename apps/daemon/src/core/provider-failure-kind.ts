// The kind of a provider failure, read from its message: Setup's provider tests and Attention's
// failed turns both say what went wrong from it.

import type { ProviderFailureKind } from '@bazilion/api-types'

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
