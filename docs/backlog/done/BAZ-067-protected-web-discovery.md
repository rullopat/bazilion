---
id: BAZ-067
title: Bounded public-web discovery for protected Agent turns
status: done
size: M
created: 2026-09-20
refined: 2026-09-21
note: Implemented and locally verified (2026-09-21); re-verified inside the 0.22.0 freeze evidence. Release gated on the 0.22.0 review and version PR.
---

# BAZ-067 — Protected web discovery

> **Repositioned 2026-09-21 (operator decision, BAZ-069):** SearXNG was never meant to be
> Bazilion's *default* search story. This capability is the **opt-in, protected-turn discovery
> backend** (protected workers keep their no-browser posture). Ordinary turns get a
> browser-backed default search via the existing pool — see
> [BAZ-069](draft/BAZ-069-browser-backed-default-web-search.md).

## User stories

- As an operator, I want a delegated researcher to discover relevant public sources without giving
  its protected worker search credentials or restoring host/browser/MCP access.
- As an evaluator, I want the same bounded capability observed in real inbox and scheduled turns,
  so supplied URLs cannot masquerade as successful independent discovery.

## Goal and finding

Unblock the discovery prerequisite for [BAZ-064](../in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md)
and BAZ-065 without weakening the protected runtime. This is separate product work, not an exception
inside the acceptance harness and not additional scope for frozen `0.22.0`.

`runtime/pi/tools.ts` registers ordinary `webTools({env})`, but its protected custom-tool set only
includes `protectedWebFetchTool()`. `turn-invocation.ts` assigns scheduled/inbox invocations to the
protected surface. `worker-runtime.test.ts` explicitly asserts absence of `web_search` there.
Configuring Brave/SearXNG therefore does not provide protected source discovery. No defect in the
existing denial contract is claimed; the content journey requires a capability it does not yet offer.

## Refined decisions (2026-09-20)

- **First backend: SearXNG.** The ordinary tool already speaks its `format=json` API
  (`apps/daemon/src/runtime/tools/web.ts`), a self-hosted instance needs no third-party account, and
  there is no provider API key to leak or rotate — the only sensitive value is the base URL, which
  stays daemon-side. Brave (keyed, metered) is deliberately second; adding it later reuses the same
  host without redesign. One backend keeps the qualification bounded.
- **Transport: daemon-owned IPC host, mirroring `imageGenerationHost`.** The protected worker receives
  a narrow `SearchHost` over the existing worker IPC (same shape as `MessagingHost`/`imageGenerationHost`),
  not env credentials. The daemon validates the configured SearXNG base URL (operator-set, https or
  loopback), issues the request itself, and returns bounded results. The worker never learns the URL,
  any key, or a generic fetch capability.
- **Bounded contract:** fixed `/search?format=json`; query length/count caps; result cap (small, e.g.
  ≤10); per-field length caps on returned title/URL/snippet; one request per invocation, no worker-side
  retry; deadline and cancellation propagation; explicit disabled/missing-backend error naming the
  operator action. Results are untrusted data — provenance stays with the caller; `web_fetch` of a
  returned URL keeps its existing SSRF protections and is never automatic.
- **Admission:** registered only in the ordinary protected custom-tool projection for intended turns.
  Restricted review/verification workers stay denied; no route exists to smuggle a search host into a
  restricted spawner or another Agent's turn. Existing tests asserting `web_search` absence must be
  updated to assert *scoped presence plus restricted absence*, not blanket absence.
- **Configuration/readiness:** enabled only by operator config alongside the base URL; surfaced
  through existing config/diagnostics with CLI/web parity. No new database, capability registry or
  per-Agent search policy in this story.

## Out of scope

Brave or additional backends, social publication, browser/MCP access, crawling private sites,
authenticated page retrieval, arbitrary Agent-supplied backend endpoints, model-managed keys,
autonomous spend consent, per-trigger timezones, and changing the frozen image-generation
implementation. No live network execution is implied by this story's readiness.

## Tests and acceptance

- Real protected inbox and scheduled workers use the admitted search tool against a test-owned
  SearXNG fixture, with an independent request counter and bounded provenance-bearing results.
- Positive control plus negatives: missing/disabled backend, unreachable/malformed/oversized responses,
  oversized query, deadline, cancellation, URL validation (non-https/non-loopback rejection), config
  drift between claim and dispatch, and turn-identity mismatch.
- Inspect worker env, tool output, errors and transcripts for URL/key leakage; restricted-worker and
  cross-Agent host admission attempts are denied.
- Rerun affected protected-provider and security-acceptance gates; record that the protected-tool
  projection tests changed deliberately, with the scoped-presence rationale.

## Dependencies

Implementing this touches `runtime/pi/tools.ts`, worker IPC/entry/spawn and tests — files inside the
BAZ-059 frozen fingerprint. That fingerprint already moved on 2026-09-21 for the worker-exit defect
fix found by BAZ-064's harness (`worker/entry.ts`); the freeze evidence re-verification required by
that change is also the moment this story's merge can land. Coordinate both with the BAZ-059
release sequence. See [the BAZ-064 acceptance record](../BAZ-064-acceptance.md).
No blocked CT cell becomes Passed merely because this story is ready.

## As-built (2026-09-21, uncommitted)

- `apps/daemon/src/lib/web-search.ts`: the daemon-owned SearXNG host. `BAZILION_WEB_SEARCH_URL`
  (operator-set, https or loopback http) is validated and re-read per request — configuration drift
  between claim and dispatch is refused. One upstream request per invocation, 15s deadline with
  cancellation, query ≤512 chars, ≤8 results, title/url/snippet caps, backend failures reported
  without echoing the URL/body. No retry, no fallback, no credential exists to leak.
- Worker: `webSearchEnabled` on the protected (and configured) spec; the worker gets an IPC-backed
  `WebSearchHost` — never the URL. `runtime/pi/tools.ts` registers `web_search` in the protected
  projection only when the host is passed; restricted review/verification workers are cleared in
  `spawnHosts` and cannot receive it by injection (existing host-denial tests cover the shape).
- Returned URLs stay untrusted data: fetching them still goes through the SSRF-guarded `web_fetch`.
- Tests: `apps/daemon/test/lib/web-search.test.ts` (config validation incl. loopback/https split,
  bounds, malformed/failed/unreachable backends, drift, empty query, one-request-no-retry) and the
  integration proof in `apps/cli/test/content-team-research.test.ts`: a protected researcher wake
  calls `web_search` against a test-owned loopback SearXNG; the backend sees one bounded query and
  the injected page stays unfetched. The scoped-projection test in `worker-runtime.test.ts` asserts
  absent-without-host/present-with-host.
- Fingerprint moved deliberately (9 files; final `f0175ad1…` after the security-manifest test rename);
  BAZ-059's affected evidence re-runs before the version PR. Security acceptance: 173 required cases
  pass with the renamed projection test.
  Remaining before Done: release review in the BAZ-059 sequence; live search-quality judgment stays
  with BAZ-066's authorized live lanes.
