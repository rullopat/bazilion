import type {
  PublicationHostAdapter,
  PublicationHostOutcome,
  PublicationHostResult,
  PublicationHostTarget,
  PublicationRemoteResult,
} from './adapter.ts'

// BAZ-046: GitHub, as the first host.
//
// Two things are decided here and worth stating, because both are about not pretending:
//
//   1. **The remote comes from configuration.** `https://github.com/<owner>/<name>.git` is built from the
//      repository the operator configured. The Team repository's own `origin` is never consulted, so a
//      project that happens to be a clone of something cannot be published to by accident.
//   2. **The pull request is reported only if GitHub said so.** The number and URL are read from the
//      response. A 201 with no URL records no URL, and a request that failed records the failure — nothing
//      is inferred from the fact that a push succeeded.

const API = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = 30_000

export function createGitHubAdapter(input: {
  credential: string
  /** Overridable for tests, which stand a local server in for the API. */
  apiBaseUrl?: string
  fetchImpl?: typeof fetch
}): PublicationHostAdapter {
  const apiBase = input.apiBaseUrl ?? API
  const doFetch = input.fetchImpl ?? fetch
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${input.credential}`,
    'content-type': 'application/json',
    'user-agent': 'bazilion',
    'x-github-api-version': '2022-11-28',
  }

  return {
    remoteUrl(target: PublicationHostTarget): PublicationRemoteResult {
      // Each half starts with an alphanumeric, so `.`, `..` and a leading dash cannot appear as a
      // repository name — `../escape` is a plausible-looking string that must not become a URL.
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(target.repository)) {
        return {
          ok: false,
          reason: 'origin_not_configured',
          detail: `the configured repository is not a GitHub owner/name: ${target.repository}`,
        }
      }
      return { ok: true, url: `https://github.com/${target.repository}.git` }
    },

    async openPullRequest(target: PublicationHostTarget): Promise<PublicationHostResult> {
      let response: Response
      try {
        response = await doFetch(`${apiBase}/repos/${target.repository}/pulls`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: target.title,
            head: target.headBranch,
            base: target.baseBranch,
            body: target.body,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch {
        // A transport failure is not a refusal: the branch is already on the host, and whether a pull
        // request exists is unknown rather than false.
        return {
          ok: false,
          reason: 'host_unavailable',
          detail:
            'the host could not be reached, so whether the branch has a pull request is unknown',
        }
      }
      if (!response.ok) {
        const text = await safeText(response)
        return {
          ok: false,
          reason: 'host_refused',
          detail: `the host refused the pull request (${response.status}): ${text}`,
        }
      }
      const body = (await response.json().catch(() => null)) as {
        number?: unknown
        html_url?: unknown
      } | null
      const outcome: PublicationHostOutcome = {
        pullRequestNumber: typeof body?.number === 'number' ? body.number : null,
        pullRequestUrl: typeof body?.html_url === 'string' ? body.html_url : null,
      }
      // A 201 without a URL is reported as published with no URL, not as a pull request that exists.
      return { ok: true, outcome }
    },
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.replace(/\s+/g, ' ').slice(0, 200)
  } catch {
    return 'no response body'
  }
}
