---
id: BAZ-064
title: Topic-neutral content Team recipe and manual handoff
status: in_progress
size: M
created: 2026-09-20
refined: 2026-09-20
note: Close-out folded into BAZ-066's 0.23.0 run; remaining composed-journey evidence comes from that live qualification. Initial recipe and management/policy preflight implemented; composed journey blocked on BAZ-067 discovery. No live usage or publication authorized.
---

# BAZ-064 — Content Team recipe and manual handoff

## User stories

- As an operator, I want to provide a topic, purpose and preferences through a short clarification
  conversation so that the same Team can produce useful content for different subjects.
- As an operator, I want to revise text and images, identify the final versions and download them
  with platform-specific instructions, without needing an automatic social publisher.

## Goal

Deliver a reusable canonical Team/Profile/skill recipe and deterministic integration coverage for
**brief → research → text/concept review → images → final text/image review → manual handoff**.
This is the first child
of [BAZ-063](../draft/BAZ-063-content-team-real-world-acceptance.md); topic and purpose are fixture inputs,
never hardcoded product behavior. Real scheduling belongs to BAZ-065; live/human qualification to BAZ-066.

## Why

The full campaign needs a reproducible base with observable specialist work and exact saved bytes.
Build and review that base before adding time/recovery faults or spending on live samples.

## Confirmed operator choices

The operator accepted the recommended interaction defaults during refinement:

- Instantiate a reusable **Team Template**; modifying an arbitrary existing Team is not required.
- Talk to **one coordinator**, which delegates to researcher, writer and visual designer. Specialist
  handoffs remain observable; the user need not manage each Agent directly.
- Describe the goal naturally. The coordinator asks only missing questions and confirms a summary,
  retaining the brief and changes in existing Team context. No new form is required.
- Produce **one post per selected platform per preparation cycle**, adapted from one shared idea;
  alternatives, a batch or a calendar of posts are not required. Text and visuals may be adapted or
  reused appropriately; do not generate a different image merely to satisfy a platform count.
- Use **Mastodon only for the first test**, replacing the earlier three-platform scope to reduce
  access/setup friction. Facebook, Instagram and LinkedIn are deferred. Two topics test reuse on
  this one platform; other platform requests are explained as outside the initial scope, not silently
  substituted. See [the platform decision and sources](../design/content-platform-first-test.md).
  This is manual-handoff scope, not an implemented API integration or permission to publish.
- Discover public-web sources, with optional sources supplied by the user. Retain traceable support
  for factual claims and flag unsupported claims for review. Distinguish user-supplied facts from
  independently retrieved evidence; attribution does not itself prove a claim true.
- Obtain approval of the **current text/concept before generating images**, within separately agreed
  usage limits. Then review the final text and image together. Brief confirmation, previous-cycle
  approval and silence are not concept approval; concept approval is not final publication consent.
- Hand off copy-ready text, downloadable images, source references, intended publication time/timezone
  and platform-specific posting instructions. Do not describe handoff as a successful post.

These are recipe behavior and acceptance requirements, not a new machine-enforced spending/approval
system. A premature image request fails the relevant test; do not claim that conversational instructions
provide a security boundary. The operator has confirmed the initial platform set; remaining
prerequisites are technical and execution-related.

## Scope

- Recipe for researcher, writer, visual designer and coordinator/editor using existing Team Templates,
  Profiles, skills, directed policy, memory, conversations and Results. No second roster or workflow engine.
- Clarify/confirm missing topic priorities, purpose, audience, language/voice, facts, rights, platforms,
  delivery method, usage limits, cadence/timezone, preparation lead time and late-approval behavior.
  Retain the brief and amendments in supported context; do not repeatedly ask for known information.
- Parameterized synthetic briefs A and B with distinct subjects, purposes, audiences and cadence.
  Commit concrete fixture data/seeds for reproducibility without making a domain mandatory. Live topics
  remain operator-selected. Treat supplied facts, external claims and unknowns separately.
- Real daemon/workers and specialist messages with fake provider/search responses and independent
  counters. Use only actually admitted tools: a harness cannot invent a production discovery capability.
- One adapted post per selected platform, with two feedback rounds: review/revise text and visual
  concept before image generation, then review/revise the image and final combination. Preserve
  originals and exact version references. Use existing delivered files; no new editorial packet.
- Manual handoff includes exact downloadable assets, platform instructions, intended time/timezone,
  CTA where applicable and rights caveats. Export is not publication or an API entitlement claim.
- Negative controls for untrusted sources, disabled/missing image access, bounded usage, private/held
  Results and cross-Team leakage. No publishing credentials or generic posting capability in the fixture.

## Out of scope

Real cron lifecycle/recovery, live accounts, independent participant study, social publication,
new search/runtime capabilities, native editorial approval UI/storage or arbitrary per-trigger timezones.
Separate product defects from the recipe/harness PR; never weaken isolation to complete a test.

## Tests and acceptance

Own the **D lane** of **CT-01–07, CT-14, CT-15 and CT-17** in the
[shared protocol](../../testing/beta-readiness/content-team-acceptance.md). The same case IDs may have
other lanes owned by later children; completing D alone does not close their L/H/S observations.

- Actual specialist messages and source references, not one model claiming to delegate.
- Discovery versus retrieval distinction, facts/rights validation and malicious-source refusal.
- Instantiate the reusable template and interact through its coordinator; verify specialist handoffs
  and one post per selected platform without requiring an alternatives/batch workflow.
- Two revision rounds and zero image-generation calls before current text/concept approval. Hold when
  approval is missing/rejected; do not reuse an old cycle's approval. No needless image call for text-only
  edits; exact retained/downloaded hashes through reload/restart, safe names and no accidental overwrite.
- Mastodon manual handoff: appropriate text/image, reviewed alt text, chosen-server format limits
  and composer instructions, with no implied account connection. Explain unsupported-platform requests
  without quietly substituting a destination or claiming multi-platform qualification.
  Explain missing direct integration; no staging/posting or false receipt.
- Reuse unchanged recipe logic with brief B; no prior facts, approvals, destinations or brand leakage.
- Reproducible test entry point, documented fixtures and explicit missing-prerequisite failures.
  No new production fault endpoints, transcript store or fabricated passing result.

Done requires the recipe, documented normal-interface setup, repeatable deterministic checks, exact
case/lane evidence and review. It does not establish scheduler, live research quality or human usability.
Size M assumes existing tools satisfy the admitted path; new capability work is a separate prerequisite.

## First implementation slice — 2026-09-20

Started at the operator's request with the bounded recipe/management preflight, not the blocked full
journey. [Examples and setup](../../../examples/content-team/README.md) now provide four role Profiles,
one selected shared skill, a portable Team Template, eight directed edges and a generic brief worksheet.
The coordinator owns image generation/delivery after concept approval; the designer supplies prompts.
Confirmed project briefs/cycle notes use existing Team memory; actual conversation/Result references
remain canonical. No new runtime, table, publisher or approval engine was added.

`apps/cli/test/content-team-recipe.test.ts` exercises normal import/preview/spawn interfaces, exact
Agent documents/skill attachment, two isolated Teams, 36 policy paths and rejected direct specialist
chat with zero provider requests. Four checks passed; these are partial preflight evidence, **not**
passes for the composed CT cases. See [the evidence and remaining work](../BAZ-064-acceptance.md).

## Dependencies and remaining work

- **Discovery unblocked (2026-09-21):** [BAZ-067](../in_progress/BAZ-067-protected-web-discovery.md) implemented
  bounded protected `web_search` (daemon-owned SearXNG host); the researcher wake now discovers
  sources through a test-owned backend. CT-03's model-level judgment still needs the L lane.
- Actual Agent UUIDs are needed for messaging; no `list_agents`/automatic roster projection exists in
  this path. Initial operator-supplied canonical IDs are documented routing hints, not a new roster.
  Observe this setup in later collaboration/usability checks; do not invent dynamic role discovery.
  The mock router also proves the alternative: routing by inbox-wake marker works, but agent-identity
  routing inside the provider is not a product capability.
- **Fixed 2026-09-21:** the protected wake held its Team workspace lease ~30s after the turn because
  the worker process lingered after its work; `worker/entry.ts` now exits explicitly. The harness
  asserts the lease frees within 5s. See the acceptance record's root-cause and re-verification notes.
- Done deterministically: two-topic reuse across isolated Teams (CT-17 D), restart retention of the
  composed flow, approval sequencing, the image-once oracle and exact handoff delivery. Remaining:
  withheld/stale-approval nuance at D level where meaningful, and the blocked discovery cells
  (CT-03/16 on BAZ-067). Independent reviewer remains unassigned.
- Live composer rehearsal needs a permitted operator-selected Mastodon server/account. Manual export
  requires no API token; neither account selection nor this story authorizes a post or paid calls.

Next: [BAZ-065](../in_progress/BAZ-065-content-team-scheduling-and-recovery.md), then
[BAZ-066](../draft/BAZ-066-content-team-live-and-human-acceptance.md). This story is not Done.
