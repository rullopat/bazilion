---
id: BAZ-063
title: Scheduled content Team — parent acceptance checklist
status: draft
size: S
created: 2026-09-19
refined: 2026-09-20
note: Parent consolidation only. Composed D/S and live/human execution remain unassigned and not scheduled; no spend or publication authorized.
---

# BAZ-063 — Content Team parent acceptance

## User stories

- As an operator, I want to give a Team a topic, purpose, audience, platform and schedule, review
  its work and retrieve the exact approved content with manual publishing instructions.
- As an evaluator, I want an honest answer about the complete scheduled journey, not a collection
  of unrelated component passes presented as end-to-end acceptance.

## Goal and scope

Review **brief → scheduled research → text/concept approval → images → feedback/rework → final
approval → manual handoff**. Require two distinct briefs, two actual cron preparation cycles and
independent human observation. First-platform scope is **Mastodon manual handoff only**; other
platforms and direct publication remain separate, conditional capabilities.

| Owner | Scope |
| --- | --- |
| [BAZ-064](../in_progress/BAZ-064-content-team-recipe-and-manual-handoff.md) | Recipe and deterministic CT-01–07, CT-14, CT-15, CT-17 work |
| [BAZ-065](../done/BAZ-065-content-team-scheduling-and-recovery.md) | Accepted limited scheduler/process scope; not blanket composed acceptance |
| Remaining execution, unassigned | Composed D/S CT-08–13/16 and outstanding S observations for CT-02/14/15; live/human lanes |
| BAZ-063 | Final reconciliation, not duplicate execution or hidden implementation |
| [BAZ-060](BAZ-060-approved-social-delivery.md) + separately refined adapter | Conditional PUB-01–06, never implied by core acceptance |

No composed pass is claimed. Partial recipe/policy, cron, browser and installed-fixture observations
cannot be combined into a successful scheduled human journey. Keep this story Draft until named
execution/reviewer assignments and prerequisites exist. Size S covers consolidation, not all children.

## Product requirements

- Instantiate a canonical Team Template and speak to one coordinator with researcher, writer and
  designer specialists. Real messaging/Results make handoffs observable; no second roster or workflow.
- Clarify only missing topic priorities, purpose, audience/voice, facts/rights, sources, platform,
  delivery, cadence, timezone, preparation lead time, late behavior and authorized usage limits.
- Confirm the brief before recurring work. Each cycle requires approval of the **current** text/
  visual concept before image generation, then final text/image approval. Brief confirmation,
  silence and a prior cycle's approval are not new consent. Text-only edits need not generate images.
- Use actual admitted discovery plus source reading, not operator-provided URLs passed off as search.
  Distinguish supplied facts, external evidence, inference and unknown rights/claims.
- Handoff contains exact text/assets, alt text, sources, intended slot/timezone and chosen-server
  Mastodon composer guidance. Report handed off, not published. Explain unsupported platforms.
- A conversation instruction is not a hard spending/security boundary. Execution needs separate
  explicit account/attempt/usage limits. No publishing credentials/browser/MCP shortcut in core.
- Cron uses the daemon timezone and matching wall-clock minutes. Do not promise per-trigger zones,
  every missed-slot catch-up, DST guarantees or exactly-once provider effects without evidence.

## Acceptance cases

Lanes are **D** deterministic real daemon/worker integration with synthetic services, **S** actual
scheduler/process observations, **L** separately authorized live core, **H** independent human and
**P** conditional publisher. A D pass never closes an unrun S/L/H/P configuration. D precedes paid L;
synthetic faults and independent counters precede separately approved live fault experiments.

| ID | Required lanes | Action and oracle |
| --- | --- | --- |
| CT-01 | D/L/H | Clarify a partial/conflicting brief, rights, timing and limits; confirm scope before recurring/research/image work. Setup text usage has its own authorization. |
| CT-02 | D/S/L | Instantiate the Team Template and observe real coordinator→specialist messaging, policy holds/denials and outputs; one model claiming delegation is insufficient. |
| CT-03 | D/L | Discover and read actual sources reflecting topic priorities; preserve URL/date/excerpt attribution and handle stale/conflicting/unavailable facts. Supplied URLs alone do not qualify discovery. |
| CT-04 | D/L | Untrusted sources requesting publication, credential disclosure or fabricated facts gain no authority; unknown claims/rights return to the user. |
| CT-05 | D/L/H | Propose sourced text and visual concept; zero image calls before current approval, then bounded generation and immutable text/image references. No image-per-platform or backend attestation assumption. |
| CT-06 | D/L/H | Revise before concept approval and again after image generation; withheld/stale approval cannot generate. Preserve originals and exact final approval; text-only changes need not regenerate. |
| CT-07 | D/L/H | Retrieve exact approved assets, text, alt text, sources and Mastodon instructions with slot/timezone/rights; survive reload/restart. No unsupported-platform substitution or false post receipt. |
| CT-08 | D/S/L/H | Observe two actual due cron occurrences and fresh outputs, correlated dispatch/conversation/message/Result identities; no manual-turn substitute or reused approval. |
| CT-09 | D/S | Check daemon/requested timezone, displayed slots, invalid cron and DST gaps/repeated hours; expose unsupported timing rather than silently convert or duplicate work. |
| CT-10 | D/S | Busy coordinator/workspace, repeated ticks and bounded failures retain occurrence identity/deferral/retry truth; count actual provider effects independently of dispatch deduplication. |
| CT-11 | D/S/H | Disable/resume/change cadence or brief; distinguish future trigger changes from admitted/running work and inspect/cancel it explicitly. No overlapping replacements or stale destination approvals. |
| CT-12 | D/S | Restart before due, after claim and after image effect before settlement; actual leases/counters/retained bytes determine outcomes. Never infer recoverability or retry safety from seeded rows. |
| CT-13 | D/S/H | Late/rejected/missing approval or downtime holds/skips and seeks a new decision; no silent late post, invented missed-slot replay or unsupported timed reminder. |
| CT-14 | D/S/L | Missing credentials, route error, limits/deadline and exhaustion cause no billing fallback or blind retry; count calls across the whole recurring test and report unknown cost. |
| CT-15 | D/S | Deny/hold disclosure, change policy/membership, try alternate reads and restart; no private inline payload/cross-Team leak or confusion between editorial and communication approval. |
| CT-16 | D/S/L | Actual scheduled/inbox protected posture admits only its allowed tools/credentials; missing research stays blocked, not replaced by host/browser/MCP access or supplied search results. |
| CT-17 | D/L | Reuse unchanged recipe with independent topic B, purpose/audience/facts/cadence; no prior brand, approval, destination or topic-specific branch leakage. |
| CT-18 | H | Independent user completes brief, scheduled work, feedback, approval and downloads through normal docs/UI; observe keyboard/narrow-screen recovery, every hint and understanding of charges/timing/manual status. |

### Conditional publication

Mastodon is not an implemented publisher. A separate adapter must be refined before its PUB execution.
Meta/LinkedIn drafts do not qualify Mastodon. Unsupported scope is not positive publishing evidence;
a claimed connector missing access is blocked. Any media staging is external disclosure too.

| ID | Lanes | Action and oracle |
| --- | --- | --- |
| PUB-01 | D/P/H | Exact account, official grants and supported action/format; readiness is not entitlement/approval. Revocation never causes credential/browser/MCP substitution. |
| PUB-02 | D/P/H | Approve exact text/media hashes, destination and time; only approved variants leave home through the isolated supported publisher, with no premature upload/staging. |
| PUB-03 | D/P | Independently observe remote object/receipt, actual slot/timezone and lateness. Preparation cron does not establish publication; missed time needs a fresh decision. |
| PUB-04 | D/P/H | Changed content/account/time, revoked approval and near-dispatch cancellation cannot use stale grants; disclose too-late cancellation without promising deletion. |
| PUB-05 | D/P | Lost ACK, duplicate confirmation, restart and restored clone retain intent and reconcile remote effects; no blind replay or external exactly-once claim. |
| PUB-06 | D/P/H | Partial targets, quota/rejection and missing reconciliation retain per-target sent/held/failed/unknown states; no duplicate successful or uncertain posts. |

## Completion checklist

- [ ] Recipe, scheduler and actual admitted capabilities meet each required case/lane configuration.
- [ ] Candidate/recipe/fixture identities agree; changed inputs receive affected revalidation.
- [ ] Live and independent-user observations include two topics, real scheduling and exact retained
  approved downloads after restart. No unresolved critical/high safety or core-task defect.
- [ ] Original failures and unknowns remain explicit; no old snapshot, assisted walkthrough or
  synthetic pass is relabelled as composed/live/human acceptance.
- [ ] Confirmed brief, amendments, specialist messages, dispatches, Results and approvals trace
  through existing canonical records, not a second transcript or product runs/events engine.
- [ ] Conditional publication is reported independently per implemented connector/author type.
- [ ] Story, operator recipe and readiness decision agree; closure performs no external publication.

## Dependencies and exclusions

Protected discovery exists in [BAZ-067](../done/BAZ-067-protected-web-discovery.md), but actual backend
access/qualification remains separate. BAZ-064 is still incomplete; BAZ-065's limited 0.23 closure
does not waive outstanding composed D/S or live/human work. No execution is scheduled or authorized.

No new editorial storage/UI, generic workflow engine, public daemon exposure, credential-bearing
Agent publishing tool, host fallback or social adapter implementation belongs in this parent.
