---
id: BAZ-060
title: Deterministic delivery of explicitly approved social posts
status: draft
size: L
created: 2026-09-19
---

# BAZ-060 — Approved social delivery

## User stories

- As an operator, I want to approve exact text, media, account and time once, then have the daemon
  publish that captured payload without an Agent changing it.
- As an operator, I want failures and uncertain outcomes per destination so that a retry cannot
  duplicate posts which already succeeded.

## Goal

Create the daemon-owned connection and publication contract with a deterministic local/fake
adapter. Official platform adapters are separate work. The first content-Team test now uses
[Mastodon manual handoff](../../../examples/content-team/README.md); a Mastodon adapter would need
its own refinement. BAZ-061/062 retain the deferred Meta/LinkedIn scope.

## Why

Current communication approvals and Git publication are not social-publication approval. A
scheduled Agent prompt or logged-in browser cannot enforce immutable final-content review.

## Scope

- BAZ-058 revision → authenticated operator decision covering final payload/account/schedule →
  durable per-destination delivery and evidence. No agent-callable publishing tool.
- Connection identity/capability/grant/token lifecycle owned by daemon; secrets excluded from
  merged worker/MCP envs, transcripts, URLs and diagnostics. Enforce isolated content-Team posture;
  no host-secret reads, publishing browser session, generic MCP or daemon-bearer escape.
- Narrow adapter interface and local deterministic host, not a generic credentialed HTTP proxy.
- Approve-and-publish-now and approve-and-schedule with explicit timezone/lateness semantics;
  persisted claims, cancellation/rework races, restart recovery and per-target partial success.
- Revalidate approval, account/grants and immutable bytes before any media upload/staging.
- Distinguish preparing/uploaded/published/blocked/failed/uncertain. Reconcile only with actual host
  evidence/permissions; no universal exactly-once claim, auto-replay or guessed remote URL.
- Dedicated source Attention links, status/receipts and API/CLI/web parity; current alpha schema contract.
- Restore blocks social execution pending operator reconciliation; never clone active publication.

## Out of scope

Live network adapters, removing mandatory human approval, a universal workflow engine, publishing
through browser automation, modifying Git-publication contracts, analytics or post-publication edits.

## Tests

- Without exact approval, zero upload/stage/publish calls, including adversarial tools and secret reads.
- Content/destination/schedule changes invalidate eligibility; stale/double approval cannot send twice.
- Cancel/rework versus claim race reports real guarantee; already-sent work is not called recalled.
- Lost host acknowledgement/crash after acceptance becomes uncertain; partial batches never replay success.
- Revoked grants, removed accounts and missing media block without fallback/substitution.
- Restore while original lives does not publish or touch original-owned resources.
- Test-only host observes exact payload/digest/destination; history/UI/CLI agree after restart.

### Shared publication acceptance

These requirements belong to the publishing feature, independent of any content-Team example.
This story owns deterministic/fake-host checks; each adapter owns its platform-specific contract
and separately authorized live/human observations. Mocked success does not establish actual
account access or publication. BAZ-061/062 cover Meta/LinkedIn only, not Mastodon.

| Case | Required behavior |
| --- | --- |
| PUB-01 | Validate the exact account, official grants and supported action/format. Readiness is not entitlement or approval; revoked access never causes credential/browser/MCP substitution. |
| PUB-02 | Approve exact text/media digests, destination and time. Only approved variants leave the home through the isolated supported publisher; no premature upload or media staging. |
| PUB-03 | Independently observe the remote object/receipt, actual slot/timezone and lateness. Preparation cron is not publication; a missed time requires a fresh decision. |
| PUB-04 | Changed content/account/time, revoked approval and near-dispatch cancellation cannot reuse stale grants. Report too-late cancellation without promising deletion of an existing post. |
| PUB-05 | Lost acknowledgement, duplicate confirmation, restart and restored clones retain intent and reconcile remote effects. No blind replay or external exactly-once claim. |
| PUB-06 | Partial targets, quota/rejection and missing reconciliation retain per-target sent/held/failed/unknown status. Never duplicate successful or uncertain posts. |

Any media staging is external disclosure and needs the same explicit authorization. Unsupported
platforms stay unsupported, not positively qualified. Manual export does not depend on these
future publishing features, and no live execution is authorized by this draft.

## Open Questions

- Exact scopes for connection administration and editorial publication decisions.
- Scheduler lateness window, timezone changes and approval validity/expiry.
- Isolated posture admission and connection storage exclusion from all generic secret-merging paths.
- Asset retention/reference policy inherited from BAZ-058.

Depends on [BAZ-058](BAZ-058-content-proposals-and-editorial-review.md) and security refinement;
[BAZ-059](../done/BAZ-059-pi-image-generation.md) adds bounded Pi-backed image generation, not
publishing authority or protected web search. Safe research capability for an isolated publishing
Team remains a separate refinement prerequisite.
